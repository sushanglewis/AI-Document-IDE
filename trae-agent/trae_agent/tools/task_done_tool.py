# Copyright (c) 2025 ByteDance Ltd. and/or its affiliates
# SPDX-License-Identifier: MIT

from typing_extensions import override

from trae_agent.tools.base import Tool, ToolCallArguments, ToolExecResult, ToolParameter
from trae_agent.utils.config import Config
from trae_agent.utils.lake_view import LakeView


class TaskDoneTool(Tool):
    """Tool to mark a task as done."""

    def __init__(self, model_provider: str | None = None) -> None:
        super().__init__(model_provider)

    @override
    def get_model_provider(self) -> str | None:
        return self._model_provider

    @override
    def get_name(self) -> str:
        return "task_done"

    @override
    def get_description(self) -> str:
        return "Report the completion of the task. Note that you cannot call this tool before any verification is done. You can write reproduce / test script to verify your solution."

    @override
    def get_parameters(self) -> list[ToolParameter]:
        return []

    @override
    async def execute(self, arguments: ToolCallArguments) -> ToolExecResult:
        try:
            try:
                # Config.create() will use config_file_var.get() internally if set
                cfg = Config.create()
                lv = LakeView(cfg.lakeview)
            except Exception as e:
                return ToolExecResult(error=f"LakeView init failed: {e}", error_code=-1)

            summary = await lv.summarize_session()
            return ToolExecResult(output=summary)
        except Exception as e:
            return ToolExecResult(error=f"Task summary failed: {e}", error_code=-1)
