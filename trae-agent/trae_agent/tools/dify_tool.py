import json
import httpx
import re
from typing import Any
from typing_extensions import override
from trae_agent.tools.base import Tool, ToolParameter, ToolExecResult, ToolCallArguments
from trae_agent.server.db import CustomTool

class DifyTool(Tool):
    def __init__(self, db_tool: CustomTool, model_provider: str | None = None):
        super().__init__(model_provider)
        self.db_tool = db_tool
        self._parameters = self._parse_parameters()

    def _parse_parameters(self) -> list[ToolParameter]:
        if not self.db_tool.parameter_schema:
            return []
        try:
            schema = json.loads(self.db_tool.parameter_schema)
            params = []
            
            # Handle full JSON Schema (look for 'properties')
            properties = schema
            required_list = []
            
            if isinstance(schema, dict):
                if 'required' in schema and isinstance(schema['required'], list):
                    required_list = schema['required']
                    
                if 'properties' in schema and isinstance(schema['properties'], dict):
                    properties = schema['properties']
            
            for name, meta in properties.items():
                if not isinstance(meta, dict):
                    continue
                    
                is_required = True
                if required_list:
                    is_required = name in required_list
                
                params.append(ToolParameter(
                    name=name,
                    type=meta.get("type", "string"),
                    description=meta.get("description", ""),
                    required=is_required,
                    enum=meta.get("enum"),
                    items=meta.get("items"),
                    default=meta.get("default")
                ))
            return params
        except Exception:
            return []

    @override
    def get_name(self) -> str:
        return self.db_tool.name

    @override
    def get_description(self) -> str:
        return self.db_tool.description

    @override
    def get_parameters(self) -> list[ToolParameter]:
        return self._parameters

    def _render_template(self, template_obj: Any, arguments: ToolCallArguments) -> Any:
        if isinstance(template_obj, dict):
            return {k: self._render_template(v, arguments) for k, v in template_obj.items()}
        elif isinstance(template_obj, list):
            return [self._render_template(i, arguments) for i in template_obj]
        elif isinstance(template_obj, str):
            # Check for exact match {{key}} first to preserve types if needed (though JSON keys are strings)
            # But here we are inside a JSON value.
            # If value is exactly "{{key}}", we can replace it with the argument value (which might be int/dict/list)
            for key, value in arguments.items():
                placeholder = f"{{{{{key}}}}}"
                if template_obj == placeholder:
                    return value
                if placeholder in template_obj:
                    template_obj = template_obj.replace(placeholder, str(value))
            
            # Clean up remaining placeholders
            if isinstance(template_obj, str):
                template_obj = re.sub(r"\{\{.*?\}\}", "", template_obj)
                
            return template_obj
        else:
            return template_obj

    @override
    async def execute(self, arguments: ToolCallArguments) -> ToolExecResult:
        try:
            # Merge defaults
            for param in self.parameters:
                if param.name not in arguments and param.default is not None:
                    arguments[param.name] = param.default

            # Parse template string to JSON object
            try:
                # Strip comments from JSON template before parsing
                # Matches strings or comments (//... or /*...*/)
                pattern = r'("(?:\\.|[^"\\])*")|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)'
                def replacer(match):
                    return match.group(1) if match.group(1) else ""
                
                clean_template = re.sub(pattern, replacer, self.db_tool.request_body_template)
                template_data = json.loads(clean_template)
            except json.JSONDecodeError:
                return ToolExecResult(error=f"Invalid JSON template: {self.db_tool.request_body_template}")

            # Render body
            json_body = self._render_template(template_data, arguments)

            headers = {
                "Authorization": f"Bearer {self.db_tool.api_key}",
                "Content-Type": "application/json"
            }
            
            async with httpx.AsyncClient() as client:
                async with client.stream("POST", self.db_tool.api_url, json=json_body, headers=headers, timeout=60.0) as resp:
                    if resp.status_code >= 400:
                        text = await resp.aread()
                        return ToolExecResult(error=f"HTTP {resp.status_code}: {text.decode()}", error_code=resp.status_code)

                    # Check for SSE content type
                    content_type = resp.headers.get("content-type", "")
                    if "text/event-stream" in content_type:
                        full_answer = []
                        workflow_outputs = None
                        conversation_id = None
                        
                        async for line in resp.aiter_lines():
                            if not line.strip():
                                continue
                            if line.startswith("data: "):
                                data_str = line[6:]
                                try:
                                    data_json = json.loads(data_str)
                                    event = data_json.get("event")
                                    
                                    if not conversation_id and data_json.get("conversation_id"):
                                        conversation_id = data_json.get("conversation_id")
                                    
                                    # Chatflow events
                                    if event == "message" or event == "agent_message":
                                        answer = data_json.get("answer", "")
                                        full_answer.append(answer)
                                    elif event == "message_end":
                                        # Usually contains usage info, but we just stop
                                        break
                                        
                                    # Workflow events
                                    elif event == "workflow_finished":
                                        data_content = data_json.get("data", {})
                                        workflow_outputs = data_content.get("outputs")
                                        break
                                        
                                    elif event == "error":
                                        # Continue if error, maybe part of stream? No, usually fatal.
                                        return ToolExecResult(error=f"Dify Error: {data_json.get('message')}")
                                        
                                except json.JSONDecodeError:
                                    continue
                        
                        if workflow_outputs is not None:
                             # If it's a dict, dump it, otherwise str
                            return ToolExecResult(output=json.dumps(workflow_outputs, ensure_ascii=False) if isinstance(workflow_outputs, (dict, list)) else str(workflow_outputs))
                        
                        final_output = "".join(full_answer)
                        if conversation_id:
                            final_output += f"\n\n[Conversation ID: {conversation_id}]"
                        return ToolExecResult(output=final_output)
                    else:
                        # Standard JSON response (blocking mode)
                        try:
                            # Implicit read is not guaranteed in stream context, so we read explicitly
                            content = await resp.aread()
                            data = json.loads(content)
                            
                            result = None
                            conversation_id = data.get("conversation_id")
                            
                            if isinstance(data, dict):
                                if 'answer' in data:
                                    result = data['answer']
                                elif 'data' in data and isinstance(data['data'], dict) and 'outputs' in data['data']:
                                    result = data['data']['outputs']
                            
                            if result is None:
                                result = data
                            
                            output_str = str(result)
                            if conversation_id:
                                output_str += f"\n\n[Conversation ID: {conversation_id}]"
                            
                            return ToolExecResult(output=output_str)
                        except json.JSONDecodeError:
                            # Fallback for non-json response (like html error page)
                            text = await resp.aread()
                            return ToolExecResult(error=f"Invalid JSON response: {text.decode()}", error_code=resp.status_code)
                
        except Exception as e:
            return ToolExecResult(error=f"Execution failed: {str(e)}")
