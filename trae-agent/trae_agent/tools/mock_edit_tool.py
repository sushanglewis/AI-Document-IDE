
from pathlib import Path
from typing_extensions import override
import json
import uuid

from trae_agent.tools.base import Tool, ToolCallArguments, ToolError, ToolExecResult, ToolParameter

EditToolSubCommands = [
    "view",
    "create",
    "str_replace",
    "insert",
]
SNIPPET_LINES: int = 4


class MockTextEditorTool(Tool):
    """Mock Tool to generate WS messages instead of editing files."""

    def __init__(self, model_provider: str | None = None) -> None:
        super().__init__(model_provider)
        self._context_store: dict[str, dict] | None = None

    def set_context_store(self, store: dict[str, dict]):
        """Inject context store for metadata lookup."""
        self._context_store = store

    @override
    def get_model_provider(self) -> str | None:
        return self._model_provider

    @override
    def get_name(self) -> str:
        return "mock_edit_tool"

    @override
    def get_description(self) -> str:
        return """Mock editing tool for testing document diff features.
* Generates WebSocket messages for frontend diff visualization instead of real file operations.
"""

    @override
    def get_parameters(self) -> list[ToolParameter]:
        """Get the parameters for the mock_edit_tool."""
        return [
            ToolParameter(
                name="command",
                type="string",
                description=f"The commands to run. Allowed options are: {', '.join(EditToolSubCommands)}.",
                required=True,
                enum=EditToolSubCommands,
            ),
            ToolParameter(
                name="file_text",
                type="string",
                description="Required parameter of `create` command, with the content of the file to be created.",
            ),
            ToolParameter(
                name="insert_line",
                type="integer",
                description="Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.",
            ),
            ToolParameter(
                name="new_str",
                type="string",
                description="Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert.",
            ),
            ToolParameter(
                name="old_str",
                type="string",
                description="Required parameter of `str_replace` command containing the string in `path` to replace.",
            ),
            ToolParameter(
                name="path",
                type="string",
                description="Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`.",
                required=True,
            ),
            ToolParameter(
                name="view_range",
                type="array",
                description="Optional parameter of `view` command.",
                items={"type": "integer"},
            ),
        ]

    @override
    async def execute(self, arguments: ToolCallArguments) -> ToolExecResult:
        """Execute the mock_edit_tool."""
        command = str(arguments["command"]) if "command" in arguments else None
        if command is None:
            return ToolExecResult(
                error=f"No command provided for the {self.get_name()} tool",
                error_code=-1,
            )
        path = arguments.get("path")
        if path is None:
            path = arguments.get("file_path")
            
        path = str(path) if path is not None else None

        if path is None:
            return ToolExecResult(
                error=f"No path provided for the {self.get_name()} tool", error_code=-1
            )
        
        # We skip path validation since we are mocking
        
        try:
            if command == "view":
                return ToolExecResult(output=f"Mock view of {path}")
            elif command == "create":
                return self._create_handler(arguments, path)
            elif command == "str_replace":
                return self._str_replace_handler(arguments, path)
            elif command == "insert":
                return self._insert_handler(arguments, path)
            else:
                return ToolExecResult(
                    error=f"Unrecognized command {command}.",
                    error_code=-1,
                )
        except ToolError as e:
            return ToolExecResult(error=str(e), error_code=-1)

    def _extract_metadata(self, text: str) -> dict:
        """Extract metadata from text including id, path, start, end, content."""
        import re
        metadata = {}
        
        # Try to match XML structure first
        id_match = re.search(r'id="([^"]+)"', text)
        path_match = re.search(r'path="([^"]+)"', text)
        start_match = re.search(r"<start>(\d+)</start>", text)
        end_match = re.search(r"<end>(\d+)</end>", text)
        content_match = re.search(r"<content>([\s\S]*?)</content>", text)
        
        if id_match: metadata['id'] = id_match.group(1)
        if path_match: metadata['path'] = path_match.group(1)
        if start_match: metadata['start'] = int(start_match.group(1))
        if end_match: metadata['end'] = int(end_match.group(1))
        if content_match: metadata['content'] = content_match.group(1)
        
        return metadata

    def _create_handler(self, arguments: ToolCallArguments, path: str) -> ToolExecResult:
        file_text = arguments.get("file_text", "")
        
        msg = {
            "type": "str_replace",
            "old_str": "",
            "new_str": file_text,
            "task_id": str(uuid.uuid4())
        }
        return ToolExecResult(output=json.dumps(msg))

    def _str_replace_handler(self, arguments: ToolCallArguments, path: str) -> ToolExecResult:
        old_str = arguments.get("old_str", "")
        new_str = arguments.get("new_str", "")
        
        # Extract metadata from old_str (if present)
        metadata = self._extract_metadata(old_str)
        paragraph_id = metadata.get('id', 'unknown')
        
        start = metadata.get('start')
        end = metadata.get('end')
        
        # Metadata Recovery Strategy:
        # If start/end are missing in LLM output (old_str), try to recover from context store using paragraph_id
        # or try to match content if available.
        
        if (start is None or end is None) and self._context_store:
            # Try lookup by ID first
            if paragraph_id != 'unknown' and paragraph_id in self._context_store:
                ctx = self._context_store[paragraph_id]
                start = ctx.get('start')
                end = ctx.get('end')
                # Also recover path if missing? Path usually comes from arg.
            
            # If still missing, maybe try to find by content hash? (Not implemented yet)
        
        # If path is in metadata, prefer it? Or prefer argument? 
        # Argument path is usually reliable for the file being edited.
        # Metadata path might be where the snippet came from.
        
        # Determine command type
        command = "replace"
        if not new_str and old_str:
            command = "delete"
        elif new_str and not old_str:
            # Should be insert handler but str_replace can do it too
            command = "insert"
        
        # Construct XML output
        # Note: We wrap it in JSON with type="str_replace" to ensure frontend receives the event,
        # BUT the content of the event will be this XML structure (in a field).
        
        xml_output = f"""```{{胶囊类型=段落}}
<paragraph_capsule>
  <paragraph id="{paragraph_id}" path="{path}">
    <command>{command}</command>
    <start>{start if start is not None else ''}</start>
    <end>{end if end is not None else ''}</end>
    <content>{metadata.get('content', old_str)}</content>
    <new_content>{new_str}</new_content>
  </paragraph>
</paragraph_capsule>
```"""
        
        msg = {
            "type": "str_replace",
            "task_id": str(uuid.uuid4()),
            "xml_content": xml_output,
            # Legacy fields for backward compatibility if frontend fails to parse XML
            "old_str": old_str,
            "new_str": new_str,
            "start": start,
            "end": end
        }
        
        return ToolExecResult(output=json.dumps(msg))

    def _insert_handler(self, arguments: ToolCallArguments, path: str) -> ToolExecResult:
        new_str = arguments.get("new_str", "")
        insert_line = arguments.get("insert_line")
        
        # For insert, we might not have paragraph ID unless passed in some way.
        # Assuming insert_line is used as start/end
        
        xml_output = f"""```{{胶囊类型=段落}}
<paragraph_capsule>
  <paragraph id="unknown" path="{path}">
    <command>insert</command>
    <start>{insert_line}</start>
    <end>{insert_line}</end>
    <content></content>
    <new_content>{new_str}</new_content>
  </paragraph>
</paragraph_capsule>
```"""

        msg = {
            "type": "str_replace",
            "task_id": str(uuid.uuid4()),
            "xml_content": xml_output,
            "insert_line": insert_line,
            "new_str": new_str
        }
        
        return ToolExecResult(output=json.dumps(msg))
