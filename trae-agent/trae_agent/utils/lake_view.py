import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from trae_agent.agent.agent_basics import AgentStep

from trae_agent.tools.base import ToolCall
from trae_agent.utils.config import LakeviewConfig
from trae_agent.utils.context import trajectory_file_var
from trae_agent.utils.llm_clients.llm_basics import LLMMessage, LLMResponse, LLMUsage
from trae_agent.utils.llm_clients.llm_client import LLMClient

StepType = tuple[
    str,  # content for human (will write into result file)
    str
    | None,  # content for llm, or None if no need to analyze (i.e., minor step), watch out length limit
]


EXTRACTOR_PROMPT = """
Given the preceding excerpt, your job is to determine "what task is the agent performing in <this_step>".
Output your answer in two granularities: <task>...</task><details>...</details>.
In the <task> tag, the answer should be concise and general. It should omit ANY bug-specific details, and contain at most 10 words.
In the <details> tag, the answer should complement the <task> tag by adding bug-specific details. It should be informative and contain at most 30 words.

用中文回答

Examples:

<task>The agent is writing a reproduction test script.</task><details>The agent is writing "test_bug.py" to reproduce the bug in XXX-Project's create_foo method not comparing sizes correctly.</details>
<task>The agent is examining source code.</task><details>The agent is searching for "function_name" in the code repository, that is related to the "foo.py:function_name" line in the stack trace.</details>
<task>The agent is fixing the reproduction test script.</task><details>The agent is fixing "test_bug.py" that forgets to import the function "foo", causing a NameError.</details>

Now, answer the question "what task is the agent performing in <this_step>".
Again, provide only the answer with no other commentary. The format should be "<task>...</task><details>...</details>".
"""

TAGGER_PROMPT = """
Given the trajectory, your job is to determine "what task is the agent performing in the current step".
Output your answer by choosing the applicable tags in the below list for the current step.
If it is performing multiple tasks in one step, choose ALL applicable tags, separated by a comma.

用中文回答

<tags>
WRITE_TEST: It writes a test script to reproduce the bug, or modifies a non-working test script to fix problems found in testing.
VERIFY_TEST: It runs the reproduction test script to verify the testing environment is working.
EXAMINE_CODE: It views, searches, or explores the code repository to understand the cause of the bug.
WRITE_FIX: It modifies the source code to fix the identified bug.
VERIFY_FIX: It runs the reproduction test or existing tests to verify the fix indeed solves the bug.
REPORT: It reports to the user that the job is completed or some progress has been made.
THINK: It analyzes the bug through thinking, but does not perform concrete actions right now.
OUTLIER: A major part in this step does not fit into any tag above, such as running a shell command to install dependencies.
</tags>

<examples>
If the agent is opening a file to examine, output <tags>EXAMINE_CODE</tags>.
If the agent is fixing a known problem in the reproduction test script and then running it again, output <tags>WRITE_TEST,VERIFY_TEST</tags>.
If the agent is merely thinking about the root cause of the bug without other actions, output <tags>THINK</tags>.
</examples>

Output only the tags with no other commentary. The format should be <tags>...</tags>
"""

KNOWN_TAGS = {
    "WRITE_TEST": "☑️",
    "VERIFY_TEST": "✅",
    "EXAMINE_CODE": "👁️",
    "WRITE_FIX": "📝",
    "VERIFY_FIX": "🔥",
    "REPORT": "📣",
    "THINK": "🧠",
    "OUTLIER": "⁉️",
}

tags_re = re.compile(r"<tags>([A-Z_,\s]+)</tags>")


@dataclass
class LakeViewStep:
    desc_task: str
    desc_details: str
    tags_emoji: str


class LakeView:
    def __init__(self, lake_view_config: LakeviewConfig | None):
        # Always initialize steps to avoid attribute errors
        self.steps: list[str] = []
        # Resolve model config. Fallback to global Config when lake_view_config is None
        try:
            if lake_view_config is None:
                from trae_agent.utils.config import Config, LakeviewConfig as LVConf
                cfg = Config.create()
                lv = cfg.lakeview or LVConf(model=(cfg.trae_agent.model if cfg.trae_agent else next(iter(cfg.models.values()))))
                lake_view_config = lv
            self.model_config = lake_view_config.model
            self.lakeview_llm_client: LLMClient = LLMClient(self.model_config)
        except Exception:
            # Defer error reporting to call sites (e.g., summarize_session)
            self.model_config = None  # type: ignore
            self.lakeview_llm_client = None  # type: ignore

    def get_label(self, tags: None | list[str], emoji: bool = True) -> str:
        if not tags:
            return ""

        return " · ".join([KNOWN_TAGS[tag] + tag if emoji else tag for tag in tags])

    async def extract_task_in_step(self, prev_step: str, this_step: str) -> tuple[str, str]:
        llm_messages = [
            LLMMessage(role="system", content="You generate concise structured outputs."),
            LLMMessage(
                role="user",
                content=f"The following is an excerpt of the steps trying to solve a software bug by an AI agent: <previous_step>{prev_step}</previous_step><this_step>{this_step}</this_step>",
            ),
            LLMMessage(role="user", content=EXTRACTOR_PROMPT),
        ]

        self.model_config.temperature = 0.1
        try:
            llm_response = self.lakeview_llm_client.chat(
                model_config=self.model_config,
                messages=llm_messages,
                reuse_history=False,
            )
        except Exception:
            return "", ""

        content = llm_response.content.strip()

        retry = 0
        while retry < 3 and (
            "</task>" not in content or "<details>" not in content or "</details>" not in content
        ):
            retry += 1
            try:
                llm_response = self.lakeview_llm_client.chat(
                    model_config=self.model_config,
                    messages=llm_messages,
                    reuse_history=False,
                )
                content = llm_response.content.strip()
            except Exception:
                break

        if "</task>" not in content or "<details>" not in content or "</details>" not in content:
            return "", ""

        desc_task, _, desc_details = content.rpartition("</task>")
        desc_details = desc_details.replace("<details>", "[italic]").replace(
            "</details>", "[/italic]"
        )
        return desc_task, desc_details

    async def extract_tag_in_step(self, step: str) -> list[str]:
        steps_fmt = "\n\n".join(
            f'<step id="{ind + 1}">\n{s.strip()}\n</step>' for ind, s in enumerate(self.steps)
        )

        if len(steps_fmt) > 300_000:
            # step_fmt is too long, skip tagging
            return []

        llm_messages = [
            LLMMessage(role="system", content="You select applicable tags only."),
            LLMMessage(
                role="user",
                content=f"Below is the trajectory of an AI agent solving a software bug until the current step. Each step is marked within a <step> tag.\n\n{steps_fmt}\n\n<current_step>{step}</current_step>",
            ),
            LLMMessage(role="user", content=TAGGER_PROMPT),
        ]
        self.model_config.temperature = 0.1

        retry = 0
        while retry < 3:
            try:
                llm_response = self.lakeview_llm_client.chat(
                    model_config=self.model_config,
                    messages=llm_messages,
                    reuse_history=False,
                )
            except Exception:
                break

            content = "<tags>" + llm_response.content.lstrip()

            matched_tags: list[str] = tags_re.findall(content)
            if not matched_tags:
                retry += 1
                continue
            tags: list[str] = [tag.strip() for tag in matched_tags[0].split(",")]
            if all(tag in KNOWN_TAGS for tag in tags):
                return tags

            retry += 1

        return []

    def _agent_step_str(self, agent_step: "AgentStep") -> str | None:
        if agent_step.llm_response is None:
            return None

        content = agent_step.llm_response.content.strip()

        tool_calls_content = ""
        if agent_step.llm_response.tool_calls is not None:
            tool_calls_content = "\n".join(
                f"[`{tool_call.name}`] `{tool_call.arguments}`"
                for tool_call in agent_step.llm_response.tool_calls
            )
            tool_calls_content = tool_calls_content.strip()
            content = f"{content}\n\nTool calls:\n{tool_calls_content}"

        return content

    async def create_lakeview_step(self, agent_step: "AgentStep") -> LakeViewStep | None:
        previous_step_str = "(none)"
        if len(self.steps) > 1:
            previous_step_str = self.steps[-1]

        this_step_str = self._agent_step_str(agent_step)

        if this_step_str:
            desc_task, desc_details = await self.extract_task_in_step(
                previous_step_str, this_step_str
            )
            tags = await self.extract_tag_in_step(this_step_str)
            tags_emoji = self.get_label(tags)
            # Append current step to history for subsequent tagging context
            try:
                self.steps.append(this_step_str)
            except Exception:
                pass
            return LakeViewStep(desc_task, desc_details, tags_emoji)

        return None

    async def summarize_session(self) -> str:
        from trae_agent.agent.agent_basics import AgentStep, AgentStepState
        # 1. Resolve trajectory file path
        traj_path = trajectory_file_var.get() or os.environ.get("TRAJECTORY_FILE")
        
        if not traj_path:
            # Fallback to finding latest trajectory file in default directory
            base_dir = Path("/workspace/trajectories")
            latest: Path | None = None
            try:
                if base_dir.exists():
                    files = sorted(base_dir.glob("trajectory_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
                    latest = files[0] if files else None
            except Exception:
                latest = None
            if latest is not None:
                traj_path = str(latest.resolve())
        
        if not traj_path:
            return "Task summary failed: No trajectory file found."

        # 2. Read and parse trajectory
        try:
            body = Path(traj_path).read_text(encoding="utf-8")
            traj = json.loads(body)
        except Exception as e:
            return f"Task summary failed: Read trajectory failed: {e}"

        # 3. Generate summary
        lines: list[str] = ["任务总结："]
        try:
            steps = traj.get("agent_steps") or traj.get("steps") or []
            for idx, step in enumerate(steps, start=1):
                lr = step.get("llm_response") or {}
                content = lr.get("content") or ""
                tcs_raw = lr.get("tool_calls") or []
                if not content and not tcs_raw:
                    continue
                tcs = lr.get("tool_calls") or []
                tool_calls: list[ToolCall] = []
                for j, tc in enumerate(tcs, start=1):
                    name = tc.get("name")
                    args = tc.get("arguments")
                    call_id = tc.get("call_id") or tc.get("id") or f"lc_{idx}_{j}"
                    if name is None:
                        continue
                    tool_calls.append(ToolCall(name=name, call_id=call_id, arguments=args, id=tc.get("id")))
                usage_raw = lr.get("usage") or {}
                usage = LLMUsage(
                    input_tokens=int(usage_raw.get("input_tokens") or usage_raw.get("prompt_tokens") or 0),
                    output_tokens=int(usage_raw.get("output_tokens") or usage_raw.get("completion_tokens") or 0),
                )
                llm_resp = LLMResponse(content=content, tool_calls=tool_calls or None, usage=usage)
                agent_step = AgentStep(
                    step_number=idx,
                    llm_response=llm_resp,
                    tool_calls=tool_calls or None,
                    tool_results=None,
                    state=AgentStepState.CALLING_TOOL,
                )
                lake_step = await self.create_lakeview_step(agent_step)
                if lake_step is None:
                    continue
                lines.append(f"- 第 {idx} 步 [{lake_step.tags_emoji}] {lake_step.desc_task} — {lake_step.desc_details}")
        except Exception as e:
            return f"Task summary failed: LakeView compute failed: {e}"

        summary = "\n".join(lines)
        
        # 4. Write to log file (optional but useful)
        try:
            log_dir = Path("/workspace/.task_done_logs")
            log_dir.mkdir(parents=True, exist_ok=True)
            from datetime import datetime
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            log_file = log_dir / f"summary_{ts}.txt"
            log_file.write_text(summary, encoding="utf-8")
        except Exception:
            pass
            
        return summary
