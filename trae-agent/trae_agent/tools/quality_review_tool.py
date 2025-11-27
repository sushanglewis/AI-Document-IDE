from typing_extensions import override
import os
from pathlib import Path

from trae_agent.tools.base import Tool, ToolCallArguments, ToolExecResult, ToolParameter
from trae_agent.utils.config import ModelConfig, ModelProvider
from trae_agent.utils.llm_clients.llm_basics import LLMMessage
from trae_agent.utils.llm_clients.llm_client import LLMClient
from trae_agent.utils.trajectory_recorder import TrajectoryRecorder


class QualityReviewTool(Tool):
    @override
    def get_name(self) -> str:
        return "quality_review"

    @override
    def get_description(self) -> str:
        return "进行文档质量审查，根据用户自定义的审查规则。每次对文档进行重新编辑后，都必须调用此工具进行审查."

    @override
    def get_parameters(self) -> list[ToolParameter]:
        return [
            ToolParameter(name="file_path", type="string", description="Target file path", required=True),
            ToolParameter(name="edited_snippet", type="string", description="Edited content snippet", required=True),
            ToolParameter(name="tool_calls_file_text", type="string", description="Full file text from view command", required=False),
            ToolParameter(name="tool_results_result", type="string", description="Previous tool result text", required=False),
            ToolParameter(name="quality_review_rules", type="string", description="Quality review rules (plain text)", required=True),
        ]

    def _prepare_model(self) -> ModelConfig:
        provider = str(self.model_provider or os.getenv("DEFAULT_PROVIDER", "openrouter"))
        api_key = os.getenv(provider.upper() + "_API_KEY", "")
        base_url = os.getenv(provider.upper() + "_BASE_URL", None)
        model_name = os.getenv("DEFAULT_MODEL", "Qwen3-32B")
        return ModelConfig(
            model=model_name,
            model_provider=ModelProvider(api_key=api_key, provider=provider, base_url=base_url),
            temperature=0.2,
            top_p=1.0,
            top_k=0,
            parallel_tool_calls=False,
            max_retries=2,
            max_tokens=4096,
        )

    def _prepare_recorder(self) -> TrajectoryRecorder | None:
        try:
            traj_path = os.getenv("TRAJECTORY_FILE")
            if isinstance(traj_path, str) and traj_path.strip():
                return TrajectoryRecorder(trajectory_path=traj_path)
        except Exception:
            return None
        return None

    @override
    async def execute(self, arguments: ToolCallArguments) -> ToolExecResult:
        file_path = arguments.get("file_path")
        edited_snippet = arguments.get("edited_snippet")
        rules = arguments.get("quality_review_rules")
        file_text = arguments.get("tool_calls_file_text")
        prev_result = arguments.get("tool_results_result")

        if not isinstance(file_path, str) or not isinstance(edited_snippet, str) or not isinstance(rules, str):
            return ToolExecResult(error="Invalid parameters for quality_review", error_code=-1)

        ft = file_text if isinstance(file_text, str) else ""
        if ft.strip() == "" and isinstance(file_path, str):
            try:
                p = Path(file_path)
                if p.exists():
                    ft = p.read_text()
            except Exception:
                ft = ""

        pr = prev_result if isinstance(prev_result, str) else ""

        model_config = self._prepare_model()
        llm_client = LLMClient(model_config)
        # Attach recorder to the LLM client so interactions are captured in the same trajectory
        try:
            recorder = self._prepare_recorder()
            if recorder:
                llm_client.set_trajectory_recorder(recorder)
        except Exception:
            pass

        sys_prefix = (
            "你是文档质量审查助手。请仅依据用户提供的审查规则进行评估，并以中文输出结论。"
            "章节的定义以 Markdown 标题为准：`##` 或 `###` 为章节，请基于此进行判断。"
            "输出必须包含定位点（标题锚点或行号区间）与操作方法（replace/insert 等）。"
        )
        system_message = LLMMessage(
            role="system",
            content=(sys_prefix + "\n\n" + "# 审查规则\n" + rules),
        )

        user_payload = (
            "# 文件元信息\n"
            + f"file_path: {file_path}\n"
            + "\n# 最近编辑片段\n"
            + (edited_snippet or "")
            + "\n\n# 文件全文/视图\n"
            + (ft or "")
            + "\n\n# 任务上下文\n"
            + (pr or "")
        )

        messages = [
            system_message,
            LLMMessage(role="user", content=user_payload),
            LLMMessage(
                role="user",
                content=(
                    "请直接以自然语言输出：\n"
                    "- 审查结果：通过 或 不通过\n"
                    "- 若不通过：给出关键原因与可执行的修改建议\n"
                    "- 必须给出定位点（标题锚点或行号区间）与操作方法（replace/insert 等）\n"
                    "不要输出任何 JSON 或代码块，只输出中文结论。"
                ),
            ),
        ]

        try:
            resp = llm_client.chat(messages=messages, model_config=model_config, tools=None, reuse_history=False)
            content = str(resp.content).strip()
            if not content:
                return ToolExecResult(error="LLM returned empty content for quality_review", error_code=-1)
            return ToolExecResult(output=content, error_code=0)
        except Exception as e:
            return ToolExecResult(error=f"LLM error during quality_review: {e}", error_code=-1)
