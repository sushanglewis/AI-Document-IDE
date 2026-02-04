# Copyright (c) 2023 Anthropic
# Copyright (c) 2025 ByteDance Ltd. and/or its affiliates.
# SPDX-License-Identifier: MIT
#
# This file has been modified by ByteDance Ltd. and/or its affiliates. on 13 June 2025
#
# Original file was released under MIT License, with the full license text
# available at https://github.com/anthropics/anthropic-quickstarts/blob/main/LICENSE
#
# This modified file is released under the same license.

import json
import uuid
from pathlib import Path
from typing_extensions import override

from trae_agent.tools.base import Tool, ToolCallArguments, ToolError, ToolExecResult, ToolParameter
from trae_agent.tools.run import maybe_truncate, run

EditToolSubCommands = [
    "view",
    "create",
    "str_replace",
    "insert",
]
SNIPPET_LINES: int = 4


class TextEditorTool(Tool):
    """Tool to replace a string in a file."""

    def __init__(self, model_provider: str | None = None) -> None:
        super().__init__(model_provider)
        self._context_store = {}

    def set_context_store(self, store: dict):
        self._context_store = store

    @override
    def get_model_provider(self) -> str | None:
        return self._model_provider

    @override
    def get_name(self) -> str:
        return "str_replace_based_edit_tool"

    @override
    def get_description(self) -> str:
        return """Custom editing tool for viewing, creating and editing files
* State is persistent across command calls and discussions with the user
* If `path` is a file, `view` displays the result of applying `cat -n`. If `path` is a directory, `view` lists non-hidden files and directories up to 2 levels deep
* The `create` command cannot be used if the specified `path` already exists as a file !!! If you know that the `path` already exists, please remove it first and then perform the `create` operation!
* If a `command` generates a long output, it will be truncated and marked with `<response clipped>`

Notes for using the `str_replace` command:
* The `str_replace` command is the MOST ROBUST and PREFERRED method for modifying existing files (including replacements, insertions, and deletions).
* The `old_str` parameter must match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
* If the `old_str` parameter is not unique in the file, the replacement will not be performed. Include enough context in `old_str` to make it unique.
* Usage strategies:
  - REPLACE: Set `old_str` to the original content and `new_str` to the new content.
  - DELETE: Set `old_str` to the content you want to remove and set `new_str` to an empty string.
  - INSERT: Find a unique anchor string (context) in the file. Set `old_str` to this anchor. Set `new_str` to `anchor + new_content` (to insert after) or `new_content + anchor` (to insert before).
"""

    @override
    def get_parameters(self) -> list[ToolParameter]:
        """Get the parameters for the str_replace_based_edit_tool."""
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
                description="Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.",
                items={"type": "integer"},
            ),
        ]

    def _sanitize_arg(self, val):
        if isinstance(val, str):
            try:
                # Heuristic: if it contains escaped unicode sequences, try to decode
                if "\\u" in val or "\\x" in val:
                    return val.encode('utf-8').decode('unicode_escape')
            except Exception:
                pass
        return val

    @override
    async def execute(self, arguments: ToolCallArguments) -> ToolExecResult:
        """Execute the str_replace_editor tool."""
        # Sanitize arguments
        for k, v in arguments.items():
            arguments[k] = self._sanitize_arg(v)

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
        _path = Path(path)
        try:
            self.validate_path(command, _path)
            if command == "view":
                return await self._view_handler(arguments, _path)
            elif command == "create":
                return self._create_handler(arguments, _path)
            elif command == "str_replace":
                return self._str_replace_handler(arguments, _path)
            elif command == "insert":
                return self._insert_handler(arguments, _path)
            else:
                return ToolExecResult(
                    error=f"Unrecognized command {command}. The allowed commands for the {self.name} tool are: {', '.join(EditToolSubCommands)}",
                    error_code=-1,
                )
        except ToolError as e:
            return ToolExecResult(error=str(e), error_code=-1)

    def validate_path(self, command: str, path: Path):
        """Validate the path for the str_replace_editor tool."""
        if not path.is_absolute():
            suggested_path = Path("/") / path
            raise ToolError(
                f"The path {path} is not an absolute path, it should start with `/`. Maybe you meant {suggested_path}?"
            )
        # Check if path exists
        if not path.exists() and command != "create":
            raise ToolError(f"The path {path} does not exist. Please provide a valid path.")
        if path.exists() and command == "create":
            raise ToolError(
                f"File already exists at: {path}. Cannot overwrite files using command `create`."
            )
        # Check if the path points to a directory
        if path.is_dir() and command != "view":
            raise ToolError(
                f"The path {path} is a directory and only the `view` command can be used on directories"
            )

    async def _view(self, path: Path, view_range: list[int] | None = None) -> ToolExecResult:
        """Implement the view command"""
        if path.is_dir():
            if view_range:
                raise ToolError(
                    "The `view_range` parameter is not allowed when `path` points to a directory."
                )

            return_code, stdout, stderr = await run(rf"find {path} -maxdepth 2 -not -path '*/\.*'")
            if not stderr:
                stdout = f"Here's the files and directories up to 2 levels deep in {path}, excluding hidden items:\n{stdout}\n"
            return ToolExecResult(error_code=return_code, output=stdout, error=stderr)

        file_content = self.read_file(path)
        init_line = 1
        if view_range:
            if len(view_range) != 2 or not all(isinstance(i, int) for i in view_range):  # pyright: ignore[reportUnnecessaryIsInstance]
                raise ToolError("Invalid `view_range`. It should be a list of two integers.")
            file_lines = file_content.split("\n")
            n_lines_file = len(file_lines)
            init_line, final_line = view_range
            if init_line < 1 or init_line > n_lines_file:
                raise ToolError(
                    f"Invalid `view_range`: {view_range}. Its first element `{init_line}` should be within the range of lines of the file: {[1, n_lines_file]}"
                )
            if final_line > n_lines_file:
                raise ToolError(
                    f"Invalid `view_range`: {view_range}. Its second element `{final_line}` should be smaller than the number of lines in the file: `{n_lines_file}`"
                )
            if final_line != -1 and final_line < init_line:
                raise ToolError(
                    f"Invalid `view_range`: {view_range}. Its second element `{final_line}` should be larger or equal than its first `{init_line}`"
                )

            if final_line == -1:
                file_content = "\n".join(file_lines[init_line - 1 :])
            else:
                file_content = "\n".join(file_lines[init_line - 1 : final_line])

        return ToolExecResult(
            output=self._make_output(file_content, str(path), init_line=init_line)
        )

    def _build_xml_response(self, path, command, start, end, old_content, new_content):
        xml_output = f"""```{{type=context, description=这是用户引用的文档片段}}
<paragraph_capsule>
  <paragraph path="{path}">
    <command>{command}</command>
    <content>{old_content}</content>
    <new_content>{new_content}</new_content>
  </paragraph>
</paragraph_capsule>
```"""
        msg = {
            "type": "str_replace",
            "task_id": str(uuid.uuid4()),
            "xml_content": xml_output,
            "old_str": old_content,
            "new_str": new_content,
            "start": start,
            "end": end
        }
        return ToolExecResult(output=json.dumps(msg))

    def str_replace(self, path: Path, old_str: str, new_str: str | None, start_line: int | None = None, end_line: int | None = None) -> ToolExecResult:
        import re
        
        file_content = self.read_file(path).expandtabs()
        old_str = old_str.expandtabs()
        new_str = new_str.expandtabs() if new_str is not None else ""
        
        actual_old_str = old_str

        if new_str.strip() == old_str.strip():
            raise ToolError("new_str内容不可相同于old_str")

        # Strategy A: Exact Match
        occurrences = file_content.count(old_str)
        if occurrences == 1:
            # Unique match found
            new_file_content = file_content.replace(old_str, new_str)
            exact_index = file_content.find(old_str)
            replacement_line = file_content[:exact_index].count("\n")
        elif occurrences > 1:
            # If paragraph_id is used, we should ideally have unique content.
            # If not, we assume the content provided is sufficient context.
            # But wait, if the LLM didn't provide start/end, and content is duplicated, we are stuck.
            # However, if we retrieved old_str from the Context Store, it SHOULD be the exact chunk we want.
            # BUT the file might contain duplicates of that chunk.
            # In that case, without start_line/end_line, we can't disambiguate.
            # User Requirement: "Use string matching... ensure fault tolerance...".
            # If paragraph_id gives us the content, and it appears multiple times, we might pick the first one or fail.
            # Since user removed start/end from capsule, we have no position info.
            # BUT, if the tool inferred old_str from paragraph_id, maybe we can also infer position?
            # The ParagraphContext DOES NOT have start/end (I removed it from main.py parsing logic).
            # Wait, I removed start/end parsing in main.py, but the user said "Remove start/end from capsule".
            # So the context store only has CONTENT.
            # If content is duplicated, we have ambiguity.
            # Let's try to match the first occurrence for now, or use fuzzy match if exact fails.
            
            if start_line is not None:
                # Existing disambiguation logic...
                indices = [m.start() for m in re.finditer(re.escape(old_str), file_content)]
                lines = [file_content[:idx].count("\n") + 1 for idx in indices]
                
                closest_line_diff = float('inf')
                best_index = -1
                
                for idx, line_num in zip(indices, lines):
                    diff = abs(line_num - start_line)
                    if diff < closest_line_diff:
                        closest_line_diff = diff
                        best_index = idx
                
                if best_index != -1:
                     new_file_content = file_content[:best_index] + new_str + file_content[best_index + len(old_str):]
                     replacement_line = file_content[:best_index].count("\n")
                else:
                    raise ToolError(f"Multiple occurrences of old_str found, but failed to select one near line {start_line}.")
            else:
                # Fallback: Replace the FIRST occurrence if no line info provided
                # This is risky but consistent with "Context Store has content".
                # If the content is large enough (paragraph), uniqueness is likely.
                print(f"Warning: Multiple occurrences of old_str found ({occurrences}), replacing the first one as no start_line provided.")
                new_file_content = file_content.replace(old_str, new_str, 1)
                exact_index = file_content.find(old_str)
                replacement_line = file_content[:exact_index].count("\n")

        else:
            # occurrences == 0
            # Strategy B: Fallback with Line Numbers (if provided) or Fuzzy Match
            # ... existing fallback logic ...
            if start_line is not None and end_line is not None:
                file_lines = file_content.split("\n")
                # Extract lines from file (convert 1-based to 0-based)
                # Ensure indices are within bounds
                s_idx = max(0, start_line - 1)
                e_idx = min(len(file_lines), end_line)
                
                target_lines = file_lines[s_idx:e_idx]
                target_text = "\n".join(target_lines)
                
                # Compare normalized (strip whitespace)
                def normalize(s): return "".join(s.split())
                
                if normalize(target_text) == normalize(old_str):
                    # Match found via loose comparison
                    # Replace the lines
                    
                    # Construct new content
                    pre_content = "\n".join(file_lines[:s_idx])
                    post_content = "\n".join(file_lines[e_idx:])
                    
                    # Handle joining carefully to preserve newlines of surrounding
                    if s_idx > 0: pre_content += "\n"
                    # post_content will be joined with \n if it's not empty
                    
                    new_file_content = pre_content + new_str + ("\n" + post_content if post_content else "")
                    
                    replacement_line = s_idx
                    actual_old_str = target_text
                else:
                     # Last resort: Super loose fallback if text is long enough
                     if len(old_str) > 20: # Only for substantial content
                         norm_file = normalize(file_content)
                         norm_old = normalize(old_str)
                         if norm_old in norm_file:
                             # Found it! But where?
                             # Mapping back is hard. We can try to locate using regex with aggressive whitespace
                             # Or we just trust the line numbers if the content is somewhat similar?
                             # Let's assume line numbers are roughly correct if content similarity is high.
                             # Calculate similarity ratio
                             from difflib import SequenceMatcher
                             ratio = SequenceMatcher(None, target_text, old_str).ratio()
                             if ratio > 0.8: # 80% similar
                                 # Assume this is the block
                                 pre_content = "\n".join(file_lines[:s_idx])
                                 post_content = "\n".join(file_lines[e_idx:])
                                 if s_idx > 0: pre_content += "\n"
                                 new_file_content = pre_content + new_str + ("\n" + post_content if post_content else "")
                                 replacement_line = s_idx
                                 actual_old_str = target_text
                             else:
                                 raise ToolError(f"No replacement performed. old_str not found exact match. Fallback to lines {start_line}-{end_line} failed (content mismatch, similarity={ratio:.2f}).\nFile content at lines:\n{target_text}\nWanted:\n{old_str}")
                         else:
                             raise ToolError(f"No replacement performed. old_str not found exact match. Fallback to lines {start_line}-{end_line} failed (content mismatch).\nFile content at lines:\n{target_text}\nWanted:\n{old_str}")
                     else:
                         raise ToolError(f"No replacement performed. old_str not found exact match. Fallback to lines {start_line}-{end_line} failed (content mismatch).\nFile content at lines:\n{target_text}\nWanted:\n{old_str}")
            else:
                # Try regex fuzzy match as last resort (existing logic)
                def _flex_regex(s: str) -> str:
                    parts: list[str] = []
                    i = 0
                    while i < len(s):
                        ch = s[i]
                        if ch.isspace():
                            j = i + 1
                            while j < len(s) and s[j].isspace():
                                j += 1
                            parts.append(r"\s+")
                            i = j
                        else:
                            parts.append(re.escape(ch))
                            i += 1
                    return "".join(parts)
    
                pattern = _flex_regex(old_str)
                matches = list(re.finditer(pattern, file_content, flags=re.DOTALL))
                if len(matches) == 0:
                    raise ToolError(
                        f"No replacement was performed, old_str `{old_str}` did not appear verbatim or with whitespace variations in {path}."
                    )
                if len(matches) > 1:
                    # Use start_line for regex matches too if available
                    if start_line is not None:
                        positions = [m.start() for m in matches]
                        lines = [file_content[:pos].count("\n") + 1 for pos in positions]
                         # Find closest
                        closest_diff = float('inf')
                        best_m = None
                        for m, line_num in zip(matches, lines):
                            diff = abs(line_num - start_line)
                            if diff < closest_diff:
                                closest_diff = diff
                                best_m = m
                        
                        start, end = best_m.span()
                        new_file_content = file_content[:start] + new_str + file_content[end:]
                        replacement_line = file_content[:start].count("\n")
                        actual_old_str = best_m.group(0)
                    else:
                        file_content_lines = file_content.split("\n")
                        positions = [m.start() for m in matches]
                        lines = [file_content[:pos].count("\n") + 1 for pos in positions]
                        raise ToolError(
                            f"No replacement was performed. Multiple approximate occurrences of old_str `{old_str}` in lines {lines}. Please ensure it is unique"
                        )
                else:
                    m = matches[0]
                    start, end = m.span()
                    new_file_content = file_content[:start] + new_str + file_content[end:]
                    replacement_line = file_content[:start].count("\n")
                    actual_old_str = m.group(0)

        self.write_file(path, new_file_content)
        
        # Calculate actual start and end lines for the XML response
        final_start = replacement_line + 1
        final_end = replacement_line + actual_old_str.count("\n") + 1
        
        command = "replace"
        if not new_str and old_str:
            command = "delete"
        
        return self._build_xml_response(path, command, final_start, final_end, actual_old_str, new_str)

    def _insert(self, path: Path, insert_line: int, new_str: str) -> ToolExecResult:
        """Implement the insert command, which inserts new_str at the specified line in the file content."""
        file_text = self.read_file(path).expandtabs()
        new_str = new_str.expandtabs()
        file_text_lines = file_text.split("\n")
        n_lines_file = len(file_text_lines)

        if insert_line < 0 or insert_line > n_lines_file:
            raise ToolError(
                f"Invalid `insert_line` parameter: {insert_line}. It should be within the range of lines of the file: {[0, n_lines_file]}"
            )

        new_str_lines = new_str.split("\n")
        new_file_text_lines = (
            file_text_lines[:insert_line] + new_str_lines + file_text_lines[insert_line:]
        )
        snippet_lines = (
            file_text_lines[max(0, insert_line - SNIPPET_LINES) : insert_line]
            + new_str_lines
            + file_text_lines[insert_line : insert_line + SNIPPET_LINES]
        )

        new_file_text = "\n".join(new_file_text_lines)
        snippet = "\n".join(snippet_lines)

        self.write_file(path, new_file_text)
        
        return self._build_xml_response(path, "insert", insert_line, insert_line, "", new_str)

    # Note: undo_edit method is not implemented in this version as it was removed

    def read_file(self, path: Path):
        """Read the content of a file from a given path; raise a ToolError if an error occurs."""
        try:
            return path.read_text()
        except Exception as e:
            raise ToolError(f"Ran into {e} while trying to read {path}") from None

    def write_file(self, path: Path, file: str):
        """Write the content of a file to a given path; raise a ToolError if an error occurs."""
        try:
            _ = path.write_text(file)
        except Exception as e:
            raise ToolError(f"Ran into {e} while trying to write to {path}") from None

    def _make_output(
        self,
        file_content: str,
        file_descriptor: str,
        init_line: int = 1,
        expand_tabs: bool = True,
    ):
        """Generate output for the CLI based on the content of a file."""
        file_content = maybe_truncate(file_content)
        if expand_tabs:
            file_content = file_content.expandtabs()
        file_content = "\n".join(
            [f"{i + init_line:6}\t{line}" for i, line in enumerate(file_content.split("\n"))]
        )
        return (
            f"Here's the result of running `cat -n` on {file_descriptor}:\n" + file_content + "\n"
        )

    async def _view_handler(self, arguments: ToolCallArguments, _path: Path) -> ToolExecResult:
        view_range = arguments.get("view_range", None)
        if view_range is None:
            return await self._view(_path, None)
        if not (isinstance(view_range, list) and all(isinstance(i, int) for i in view_range)):
            return ToolExecResult(
                error="Parameter `view_range` should be a list of integers.",
                error_code=-1,
            )
        view_range_int: list[int] = [i for i in view_range if isinstance(i, int)]
        return await self._view(_path, view_range_int)

    def _create_handler(self, arguments: ToolCallArguments, _path: Path) -> ToolExecResult:
        file_text = arguments.get("file_text", None)
        if not isinstance(file_text, str):
            return ToolExecResult(
                error="Parameter `file_text` is required and must be a string for command: create",
                error_code=-1,
            )
        self.write_file(_path, file_text)
        return ToolExecResult(output=f"File created successfully at: {_path}")

    def _str_replace_handler(self, arguments: ToolCallArguments, _path: Path) -> ToolExecResult:
        old_str = arguments.get("old_str") if "old_str" in arguments else None
        start_line = None
        end_line = None
        
        if not isinstance(old_str, str):
            return ToolExecResult(
                error="Parameter `old_str` is required and should be a string for command: str_replace",
                error_code=-1,
            )
            
        new_str = arguments.get("new_str") if "new_str" in arguments else None
        if not (new_str is None or isinstance(new_str, str)):
            return ToolExecResult(
                error="Parameter `new_str` should be a string or null for command: str_replace",
                error_code=-1,
            )
            
        if start_line is None:
            start_line = arguments.get("start_line")
        if end_line is None:
            end_line = arguments.get("end_line")
        
        return self.str_replace(_path, old_str, new_str, start_line, end_line)

    def _insert_handler(self, arguments: ToolCallArguments, _path: Path) -> ToolExecResult:
        insert_line = arguments.get("insert_line") if "insert_line" in arguments else None
        if not isinstance(insert_line, int):
            return ToolExecResult(
                error="Parameter `insert_line` is required and should be integer for command: insert",
                error_code=-1,
            )
        new_str_to_insert = arguments.get("new_str") if "new_str" in arguments else None
        if not isinstance(new_str_to_insert, str):
            return ToolExecResult(
                error="Parameter `new_str` is required for command: insert",
                error_code=-1,
            )
        return self._insert(_path, insert_line, new_str_to_insert)
