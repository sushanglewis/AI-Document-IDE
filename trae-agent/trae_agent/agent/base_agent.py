# Copyright (c) 2025 ByteDance Ltd. and/or its affiliates
# SPDX-License-Identifier: MIT

"""Base Agent class for LLM-based agents."""

import asyncio
import contextlib
import re
import os
from abc import ABC, abstractmethod
from typing import Union

from trae_agent.agent.agent_basics import AgentExecution, AgentState, AgentStep, AgentStepState
from trae_agent.agent.docker_manager import DockerManager
from trae_agent.tools import tools_registry
from trae_agent.tools.base import Tool, ToolCall, ToolExecutor, ToolResult
from trae_agent.tools.ckg.ckg_database import clear_older_ckg
from trae_agent.tools.docker_tool_executor import DockerToolExecutor
from trae_agent.utils.cli import CLIConsole
from trae_agent.utils.config import AgentConfig, ModelConfig
from trae_agent.utils.llm_clients.llm_basics import LLMMessage, LLMResponse
from trae_agent.utils.llm_clients.llm_client import LLMClient
from trae_agent.utils.trajectory_recorder import TrajectoryRecorder


class BaseAgent(ABC):
    """Base class for LLM-based agents."""

    _tool_caller: Union[ToolExecutor, DockerToolExecutor]

    def __init__(
        self, agent_config: AgentConfig, docker_config: dict | None = None, docker_keep: bool = True
    ):
        """Initialize the agent.
        Args:
            agent_config: Configuration object containing model parameters and other settings.
            docker_config: Configuration for running in a Docker environment.
        """
        self._llm_client = LLMClient(agent_config.model)
        self._model_config = agent_config.model
        self._max_steps = agent_config.max_steps
        self._initial_messages: list[LLMMessage] = []
        self._task: str = ""
        self._tools: list[Tool] = [
            tools_registry[tool_name](model_provider=self._model_config.model_provider.provider)
            for tool_name in agent_config.tools
        ]

        # Inject LLM Client into tools that need it
        for tool in self._tools:
            if hasattr(tool, "set_llm_client"):
                tool.set_llm_client(self._llm_client)

        self.docker_keep = docker_keep
        self.docker_manager: DockerManager | None = None
        original_tool_executor = ToolExecutor(self._tools)
        if docker_config:
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            # tools_dir = os.path.join(project_root, 'tools')

            tools_dir = os.path.join(project_root, "dist")

            is_interactive_mode = False
            self.docker_manager = DockerManager(
                image=docker_config.get("image"),
                container_id=docker_config.get("container_id"),
                dockerfile_path=docker_config.get("dockerfile_path"),
                docker_image_file=docker_config.get("docker_image_file"),
                workspace_dir=docker_config.get("workspace_dir"),
                tools_dir=tools_dir,
                interactive=is_interactive_mode,
            )
            self._tool_caller = DockerToolExecutor(
                original_executor=original_tool_executor,
                docker_manager=self.docker_manager,
                docker_tools=["bash", "str_replace_based_edit_tool", "json_edit_tool"],
                host_workspace_dir=docker_config.get("workspace_dir"),
                container_workspace_dir=self.docker_manager.container_workspace,
            )
        else:
            self._tool_caller = original_tool_executor

        self._cli_console: CLIConsole | None = None

        # Trajectory recorder
        self._trajectory_recorder: TrajectoryRecorder | None = None

        # CKG tool-specific: clear the older CKG databases
        clear_older_ckg()

    def set_docker_workspace_dir(self, workspace_dir: str | None) -> None:
        if not self.docker_manager:
            return
        self.docker_manager.workspace_dir = workspace_dir
        if isinstance(self._tool_caller, DockerToolExecutor):
            self._tool_caller.set_host_workspace_dir(workspace_dir)

    @property
    def llm_client(self) -> LLMClient:
        return self._llm_client

    @property
    def trajectory_recorder(self) -> TrajectoryRecorder | None:
        """Get the trajectory recorder for this agent."""
        return self._trajectory_recorder

    def set_trajectory_recorder(self, recorder: TrajectoryRecorder | None) -> None:
        """Set the trajectory recorder for this agent."""
        self._trajectory_recorder = recorder
        # Also set it on the LLM client
        self._llm_client.set_trajectory_recorder(recorder)

    @property
    def cli_console(self) -> CLIConsole | None:
        """Get the CLI console for this agent."""
        return self._cli_console

    def set_cli_console(self, cli_console: CLIConsole | None) -> None:
        """Set the CLI console for this agent."""
        self._cli_console = cli_console

    def ensure_quality_review_tool(self) -> None:
        provider = self._model_config.model_provider.provider
        has_qr = any(t.name == "quality_review" for t in self._tools)
        if not has_qr:
            self._tools.append(tools_registry["quality_review"](model_provider=provider))
            if isinstance(self._tool_caller, DockerToolExecutor):
                original = ToolExecutor(self._tools)
                self._tool_caller = DockerToolExecutor(
                    original_executor=original,
                    docker_manager=self.docker_manager,  # type: ignore[arg-type]
                    docker_tools=["bash", "str_replace_based_edit_tool", "json_edit_tool"],
                    host_workspace_dir=getattr(self.docker_manager, "workspace_dir", None) if self.docker_manager else None,
                    container_workspace_dir=self.docker_manager.container_workspace if self.docker_manager else "",
                )
            else:
                self._tool_caller = ToolExecutor(self._tools)

    @property
    def tools(self) -> list[Tool]:
        """Get the tools available to this agent."""
        return self._tools

    @property
    def task(self) -> str:
        """Get the current task of the agent."""
        return self._task

    @task.setter
    def task(self, value: str):
        """Set the current task of the agent."""
        self._task = value

    @property
    def initial_messages(self) -> list[LLMMessage]:
        """Get the initial messages for the agent."""
        return self._initial_messages

    @property
    def model_config(self) -> ModelConfig:
        """Get the model config for the agent."""
        return self._model_config

    @property
    def max_steps(self) -> int:
        """Get the maximum number of steps for the agent."""
        return self._max_steps

    @abstractmethod
    def new_task(
        self,
        task: str,
        extra_args: dict[str, str] | None = None,
        tool_names: list[str] | None = None,
    ):
        """Create a new task."""
        pass

    async def execute_task(self) -> AgentExecution:
        """Execute a task using the agent."""
        import time

        if self.docker_manager:
            self.docker_manager.start()

        start_time = time.time()
        execution = AgentExecution(task=self._task, steps=[])
        step: AgentStep | None = None

        try:
            messages = self._initial_messages
            step_number = 1
            execution.agent_state = AgentState.RUNNING

            while step_number <= self._max_steps:
                step = AgentStep(step_number=step_number, state=AgentStepState.THINKING)
                try:
                    messages = await self._run_llm_step(step, messages, execution)
                    await self._finalize_step(
                        step, messages, execution
                    )  # record trajectory for this step and update the CLI console
                    try:
                        trs = step.tool_results or []
                        td = next((tr for tr in trs if str(getattr(tr, "name", "")) == "task_done" and bool(getattr(tr, "success", False)) is True), None)
                        if td:
                            execution.agent_state = AgentState.COMPLETED
                            execution.success = True
                            if getattr(td, "result", None):
                                execution.final_result = str(td.result)
                    except Exception:
                        pass
                    if execution.agent_state == AgentState.COMPLETED:
                        break
                    step_number += 1
                except Exception as error:
                    execution.agent_state = AgentState.ERROR
                    step.state = AgentStepState.ERROR
                    step.error = str(error)
                    await self._finalize_step(step, messages, execution)
                    break
            if step_number > self._max_steps and not execution.success:
                execution.final_result = "Task execution exceeded maximum steps without completion."
                execution.agent_state = AgentState.ERROR

        except Exception as e:
            execution.final_result = f"Agent execution failed: {str(e)}"

        finally:
            if self.docker_manager and not self.docker_keep:
                self.docker_manager.stop()

        # Ensure tool resources are released whether an exception occurs or not.
        await self._close_tools()

        execution.execution_time = time.time() - start_time

        # Clean up any MCP clients
        with contextlib.suppress(Exception):
            await self.cleanup_mcp_clients()

        self._update_cli_console(step, execution)
        return execution

    async def _close_tools(self):
        """Release tool resources, mainly about BashTool object."""
        if self._tool_caller:
            # Ensure all tool resources are properly released.
            res = await self._tool_caller.close_tools()
            return res

    async def _run_llm_step(
        self, step: "AgentStep", messages: list["LLMMessage"], execution: "AgentExecution"
    ) -> list["LLMMessage"]:
        # Display thinking state
        step.state = AgentStepState.THINKING
        self._update_cli_console(step, execution)
        # Get LLM response
        loop = asyncio.get_running_loop()
        llm_response = await loop.run_in_executor(
            None,
            self._llm_client.chat,
            messages,
            self._model_config,
            self._tools
        )
        step.llm_response = llm_response

        # Display step with LLM response
        self._update_cli_console(step, execution)

        # Update token usage
        self._update_llm_usage(llm_response, execution)

        # Always execute tools (including task_done) before marking completion
        tool_calls = llm_response.tool_calls
        if tool_calls and len(tool_calls) > 0:
            return await self._tool_call_handler(tool_calls, step)

        if self.llm_indicates_task_completed(llm_response) and self._is_task_completed(llm_response):
            execution.agent_state = AgentState.COMPLETED
            execution.final_result = llm_response.content
            execution.success = True
            return messages

        execution.agent_state = AgentState.RUNNING
        return [LLMMessage(role="user", content=self.task_incomplete_message())]

    async def _finalize_step(
        self, step: "AgentStep", messages: list["LLMMessage"], execution: "AgentExecution"
    ) -> None:
        step.state = AgentStepState.COMPLETED
        self._record_handler(step, messages)
        self._update_cli_console(step, execution)
        execution.steps.append(step)

    def reflect_on_result(self, tool_results: list[ToolResult]) -> str | None:
        """Reflect on tool execution result. Override for custom reflection logic."""
        if len(tool_results) == 0:
            return None

        reflection = "\n".join(
            f"The tool execution failed with error: {tool_result.error}. Consider trying a different approach or fixing the parameters."
            for tool_result in tool_results
            if not tool_result.success
        )

        return reflection

    def llm_indicates_task_completed(self, llm_response: LLMResponse) -> bool:
        """Check if the LLM indicates that the task is completed. Override for custom logic."""
        # Fallback to textual completion indicators in the content
        completion_indicators = [
            "task completed",
            "task finished",
            "done",
            "completed successfully",
            "finished successfully",
        ]

        response_lower = llm_response.content.lower()
        return any(indicator in response_lower for indicator in completion_indicators)

    def _is_task_completed(self, llm_response: LLMResponse) -> bool:  # pyright: ignore[reportUnusedParameter]
        """Check if the task is completed based on the response. Override for custom logic."""
        # If the response includes tool calls (e.g., `task_done`), do NOT mark completed yet.
        # Execute tools first, then allow completion.
        try:
            if llm_response.tool_calls and len(llm_response.tool_calls) > 0:
                return False
        except Exception:
            pass
        return True

    def task_incomplete_message(self) -> str:
        """Return a message indicating that the task is incomplete. Override for custom logic."""
        return "The task is incomplete. Please try again."

    @abstractmethod
    async def cleanup_mcp_clients(self) -> None:
        """Clean up MCP clients. Override in subclasses that use MCP."""
        pass

    def _update_cli_console(
        self, step: AgentStep | None = None, agent_execution: AgentExecution | None = None
    ) -> None:
        if self.cli_console:
            self.cli_console.update_status(step, agent_execution)

        if self.trajectory_recorder and step:
            self.trajectory_recorder.record_agent_step(
                step_number=step.step_number,
                state=step.state.value,
                llm_messages=None,
                llm_response=step.llm_response,
                tool_calls=step.tool_calls,
                tool_results=step.tool_results,
                reflection=step.reflection,
                error=step.error,
            )

    def _update_llm_usage(self, llm_response: LLMResponse, execution: AgentExecution):
        if not llm_response.usage:
            return
        # if execution.total_tokens is None then set it to be llm_response.usage else sum it up
        # execution.total_tokens is not None
        if not execution.total_tokens:
            execution.total_tokens = llm_response.usage
        else:
            execution.total_tokens += llm_response.usage

    def _record_handler(self, step: AgentStep, messages: list[LLMMessage]) -> None:
        if self.trajectory_recorder:
            self.trajectory_recorder.record_agent_step(
                step_number=step.step_number,
                state=step.state.value,
                llm_messages=messages,
                llm_response=step.llm_response,
                tool_calls=step.tool_calls,
                tool_results=step.tool_results,
                reflection=step.reflection,
                error=step.error,
            )

    def _build_follow_up_prompt(self, reflection: str | None) -> str:
        text = ""
        if reflection:
            text = (
                "Based on the reflection above, continue the task: apply necessary edits, "
                "address the issues raised, use available tools to modify files, and then proceed. "
                "When you believe the task is complete, call `task_done`."
            )
        else:
            text = (
                "Please continue the task based on the latest tool outputs. "
                "If edits are required, perform them using the editing tools and progress the work. "
                "When finished, call `task_done`."
            )
        return text

    async def _tool_call_handler(
        self, tool_calls: list[ToolCall] | None, step: AgentStep
    ) -> list[LLMMessage]:
        messages: list[LLMMessage] = []
        if not tool_calls or len(tool_calls) <= 0:
            messages = [
                LLMMessage(
                    role="user",
                    content="It seems that you have not completed the task.",
                )
            ]
            return messages

        step.state = AgentStepState.CALLING_TOOL
        step.tool_calls = tool_calls
        self._update_cli_console(step)

        enable_qr = bool(getattr(self, "enable_quality_review", False))

        if not enable_qr:
            if self._model_config.parallel_tool_calls:
                tool_results = await self._tool_caller.parallel_tool_call(tool_calls)
            else:
                tool_results = await self._tool_caller.sequential_tool_call(tool_calls)
            step.tool_results = tool_results
            self._update_cli_console(step)
            for tool_result in tool_results:
                message = LLMMessage(role="user", tool_result=tool_result)
                messages.append(message)

            reflection = self.reflect_on_result(tool_results)
            if reflection:
                step.state = AgentStepState.REFLECTING
                step.reflection = reflection
                self._update_cli_console(step)
                messages.append(LLMMessage(role="assistant", content=reflection))
            follow_up = self._build_follow_up_prompt(step.reflection)
            if follow_up:
                messages.append(LLMMessage(role="user", content=follow_up))
            return messages

        review_results: list[ToolResult] = []
        aggregated_tool_results: list[ToolResult] = []
        rules: str | None = getattr(self, "quality_review_rules", None)

        for tc in tool_calls:
            tr_list = await self._tool_caller.sequential_tool_call([tc])
            tr = tr_list[0]
            aggregated_tool_results.append(tr)
            self._update_cli_console(step)
            messages.append(LLMMessage(role="user", tool_result=tr))

            is_edit = str(tc.name) in ["str_replace_based_edit_tool", "json_edit_tool"]
            # Skip quality review when str_replace_based_edit_tool is a pure 'view' command
            cmd = None
            try:
                if isinstance(tc.arguments, dict):
                    cmd = str(tc.arguments.get("command") or "").lower()
            except Exception:
                cmd = None
            if is_edit and bool(tr.success):
                if str(tc.name) == "str_replace_based_edit_tool" and cmd == "view":
                    continue
                file_path: str | None = None
                edited_snippet: str | None = None
                file_text: str | None = None
                if tr.result:
                    m = re.search(r"The file\s+(.+?)\s+has been edited\.", tr.result)
                    if m:
                        file_path = m.group(1).strip()
                    idx = tr.result.find("Here's the result of running `cat -n`")
                    if idx >= 0:
                        edited_snippet = tr.result[idx:]
                if not file_path and isinstance(tc.arguments, dict) and isinstance(tc.arguments.get("path"), str):
                    file_path = str(tc.arguments.get("path"))

                if file_path and cmd != "view":
                    view_tc = ToolCall(
                        name="str_replace_based_edit_tool",
                        call_id=f"view_{tc.call_id}",
                        arguments={
                            "command": "view",
                            "path": file_path,
                        },
                    )
                    view_res_list = await self._tool_caller.sequential_tool_call([view_tc])
                    view_res = view_res_list[0]
                    if bool(view_res.success) and isinstance(view_res.result, str):
                        file_text = view_res.result

                qc = ToolCall(
                    name="quality_review",
                    call_id=f"quality_review_{tc.call_id}",
                    arguments={
                        "file_path": file_path or "",
                        "edited_snippet": edited_snippet or (tr.result or ""),
                        "tool_calls_file_text": file_text or "",
                        "tool_results_result": tr.result or "",
                        "quality_review_rules": rules or "",
                    },
                )
                messages.append(LLMMessage(role="user", tool_call=qc))
                rr_list = await self._tool_caller.sequential_tool_call([qc])
                rr = rr_list[0]
                review_results.append(rr)
                messages.append(LLMMessage(role="user", tool_result=rr))

                if self.docker_manager and rr.result:
                    log_file = "/workspace/.qr_logs/quality_review.jsonl"
                    safe_json = str(rr.result)
                    bash_cmd = (
                        "mkdir -p /workspace/.qr_logs"  # ensure dir
                        + " ; "
                        + f"cat > {log_file} <<'EOF'\n" + safe_json + "\nEOF"  # write full json
                        + " ; "
                        + f"echo 'QUALITY_REVIEW_LOG -> {log_file}'"  # print pointer
                    )
                    log_tc = ToolCall(
                        name="bash",
                        call_id=f"qrlog_{tc.call_id}",
                        arguments={"command": bash_cmd},
                    )
                    messages.append(LLMMessage(role="user", tool_call=log_tc))
                    _ = await self._tool_caller.sequential_tool_call([log_tc])

        step.tool_results = aggregated_tool_results + review_results
        self._update_cli_console(step)

        reflection = self.reflect_on_result(review_results)
        if reflection:
            step.state = AgentStepState.REFLECTING
            step.reflection = reflection
            self._update_cli_console(step)
            messages.append(LLMMessage(role="assistant", content=reflection))

        follow_up = self._build_follow_up_prompt(step.reflection)
        if follow_up:
            messages.append(LLMMessage(role="user", content=follow_up))

        return messages
