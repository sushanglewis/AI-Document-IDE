import json
import httpx
from typing import Optional, Dict, Any
from typing_extensions import override
from trae_agent.tools.base import Tool, ToolParameter, ToolExecResult, ToolCallArguments

class KnowledgeRetrievalTool(Tool):
    """
    A tool to retrieve information from a Dify Knowledge Base.
    """
    def __init__(self, model_provider: str | None = None, api_url: str = None, api_key: str = None, dataset_id: str = None, retrieval_model: Dict[str, Any] = None):
        super().__init__(model_provider)
        self._api_url = api_url
        self._api_key = api_key
        self._dataset_id = dataset_id
        self._retrieval_model = retrieval_model

    @override
    def get_name(self) -> str:
        return "knowledge_retrieval"

    @override
    def get_description(self) -> str:
        return "Retrieve information from a knowledge base using Dify API."

    @override
    def get_parameters(self) -> list[ToolParameter]:
        return [
            ToolParameter(
                name="query",
                type="string",
                description="The query string to search in the knowledge base.",
                required=True
            ),
            ToolParameter(
                name="dataset_id",
                type="string",
                description="The ID of the Dify dataset/knowledge base.",
                required=True
            ),
            ToolParameter(
                name="api_key",
                type="string",
                description="The API key for accessing the Dify knowledge base.",
                required=True
            ),
            ToolParameter(
                name="api_url",
                type="string",
                description="The base URL of the Dify API.",
                required=True
            )
        ]

    @override
    async def execute(self, arguments: ToolCallArguments) -> ToolExecResult:
        query = arguments.get("query")
        dataset_id = arguments.get("dataset_id")
        api_key = arguments.get("api_key")
        api_url = arguments.get("api_url")

        # Fallback to init params if not provided in args (though args should take precedence or be required)
        # But since this tool is designed to be generic, args are expected.
        # However, for test endpoint usage, we might initialize with values.
        
        if not query:
            return ToolExecResult(error="Missing query parameter")
        
        # If called from agent, these should be in arguments.
        if not dataset_id: dataset_id = self._dataset_id
        if not api_key: api_key = self._api_key
        if not api_url: api_url = self._api_url
        
        if not dataset_id or not api_key or not api_url:
             return ToolExecResult(error="Missing dataset_id, api_key, or api_url")

        # Construct the full URL
        # api_url usually ends with /v1, so we append /datasets/{dataset_id}/retrieve
        # Ensure api_url doesn't end with slash
        api_url = api_url.rstrip("/")
        url = f"{api_url}/datasets/{dataset_id}/retrieve"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        retrieval_model = arguments.get("retrieval_model")
        if not retrieval_model:
            retrieval_model = self._retrieval_model
        
        # Default fallback if not provided
        if not retrieval_model:
            retrieval_model = {
                "search_method": "hybrid_search",
                "reranking_enable": True,
                "reranking_mode": {
                    "reranking_provider_name": "",
                    "reranking_model_name": ""
                },
                "top_k": 3,
                "score_threshold_enabled": False
            }

        payload = {
            "query": query,
            "retrieval_model": retrieval_model
        }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=60.0)
                
                if resp.status_code >= 400:
                    return ToolExecResult(error=f"HTTP {resp.status_code}: {resp.text}", error_code=resp.status_code)
                
                data = resp.json()
                # Usually data['records'] contains the segments
                # Let's format the output
                
                if 'records' in data:
                    records = data['records']
                    segments = []
                    for record in records:
                        segment = record.get('segment', {})
                        # Ensure we capture the whole segment as requested
                        segments.append(segment)
                    
                    # Return the JSON structure with success flag and result segments
                    result_data = {
                        "success": True if segments else False,
                        "result": segments
                    }
                    
                    output = json.dumps(result_data, ensure_ascii=False, indent=2)
                         
                    return ToolExecResult(output=output)
                
                return ToolExecResult(output=json.dumps(data, ensure_ascii=False, indent=2))

        except Exception as e:
            return ToolExecResult(error=f"Execution failed: {str(e)}")
