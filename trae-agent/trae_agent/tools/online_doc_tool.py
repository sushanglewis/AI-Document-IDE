from typing_extensions import override
import json as _json
import asyncio
import urllib.request
import urllib.error
import os

from trae_agent.tools.base import Tool, ToolCallArguments, ToolExecResult, ToolParameter
from trae_agent.tools.run import maybe_truncate, MAX_RESPONSE_LEN


class OnlineDocTool(Tool):
    def __init__(self, model_provider: str | None = None) -> None:
        super().__init__(model_provider)

    @override
    def get_model_provider(self) -> str | None:
        return self._model_provider

    @override
    def get_name(self) -> str:
        return "online_doc_tool"

    @override
    def get_description(self) -> str:
        return (
            "Online（在线文档） 工具：创建、查询详情、编辑三种操作\n"
            "* 通过 `command={create|detail|edit}` 指定操作\n"
            "* 所有请求自动注入 `userId='user'`\n"
            "* 输出为可读摘要；必要时附带 JSON 片段；长内容会标记为 `<response clipped>`\n"
            "* 对上游 HTTP 错误执行退避重试（最多 3 次）；失败不改变本地状态"
        )

    @override
    def get_parameters(self) -> list[ToolParameter]:
        return [
            ToolParameter(
                name="command",
                type="string",
                description="选择操作类型（create/detail/edit）",
                required=True,
                enum=["create", "detail", "edit"],
            ),
            ToolParameter(
                name="document_id",
                type="string",
                description="文档唯一标识，detail/edit 必填",
                required=False,
            ),
            ToolParameter(
                name="title",
                type="string",
                description="文档标题，create 必填；edit 仅在需要修改标题时传",
                required=False,
            ),
            ToolParameter(
                name="content",
                type="string",
                description="文档 HTML 内容，create/edit 必填；需为有效 HTML 字符串",
                required=False,
            ),
            ToolParameter(
                name="description",
                type="string",
                description="文档摘要，create 必填，用于列表与检索展示",
                required=False,
            ),
        ]

    @override
    async def execute(self, arguments: ToolCallArguments) -> ToolExecResult:
        cmd = str(arguments.get("command") or "").lower()
        if cmd not in {"create", "detail", "edit"}:
            return ToolExecResult(error="Invalid command. Allowed: create|detail|edit", error_code=-1)

        # Read base URL from server setting
        base_url = await self._get_online_base_url()
        print(f"[OnlineDocTool] Using base_url: {base_url}", flush=True)
        if not base_url:
            base_url = os.getenv("ONLINE_BASE_URL", "http://10.0.2.34:7876")

        headers = {
            "User-Agent": "trae-agent",
            "Content-Type": "application/json",
            "Connection": "keep-alive",
        }

        try:
            if cmd == "create":
                title = str(arguments.get("title") or "")
                content = str(arguments.get("content") or "")
                description = str(arguments.get("description") or "")
                if not title or not content or not description:
                    return ToolExecResult(error="title/content/description 参数缺失", error_code=-1)
                payload = {
                    "userId": "user",
                    "title": title,
                    "content": content,
                    "description": description,
                }
                res = await self._post_json(f"{base_url}/ai/report/add", payload, headers)
                doc_id = (
                    str(res.get("documentId"))
                    if isinstance(res, dict) and (res.get("documentId") is not None)
                    else ""
                )
                out_obj = {"documentId": doc_id, "title": title, "description": description}
                return ToolExecResult(output=f"Create success: document created\n{_json.dumps(out_obj, ensure_ascii=False)}")

            if cmd == "detail":
                document_id = str(arguments.get("document_id") or "")
                if not document_id:
                    return ToolExecResult(error="document_id 参数缺失", error_code=-1)
                payload = {"userId": "user", "documentId": document_id}
                res = await self._post_json(f"{base_url}/ai/report/detail", payload, headers)
                # Robust field extraction: support top-level or nested wrappers
                def pick(*keys, src=None):
                    src = (res if src is None else src) or {}
                    for k in keys:
                        try:
                            v = src.get(k)
                        except Exception:
                            v = None
                        if isinstance(v, (str, int)):  # accept str/int
                            return str(v)
                        if v is not None and not isinstance(v, (dict, list)):
                            return str(v)
                    return ""

                data = None
                try:
                    data = res.get("data") if isinstance(res, dict) else None
                except Exception:
                    data = None

                title = pick("title", src=res) or pick("title", src=(data or {}))
                content = (
                    pick("content", src=res)
                    or pick("content", src=(data or {}))
                    or pick("htmlContent", src=res)
                    or pick("htmlContent", src=(data or {}))
                )
                updated_at = pick("updatedAt", src=res) or pick("updatedAt", src=(data or {}))
                clipped = maybe_truncate(content, truncate_after=MAX_RESPONSE_LEN)
                out_obj = {
                    "documentId": document_id,
                    "title": title,
                    "content": clipped,
                    "updatedAt": updated_at,
                }
                return ToolExecResult(output=f"Detail success: document fetched\n{_json.dumps(out_obj, ensure_ascii=False)}")

            # edit
            document_id = str(arguments.get("document_id") or "")
            content = str(arguments.get("content") or "")
            title = arguments.get("title")
            if not document_id or not content:
                return ToolExecResult(error="document_id/content 参数缺失", error_code=-1)
            payload = {"userId": "user", "documentId": document_id, "content": content}
            if isinstance(title, str) and title:
                payload["title"] = title
            await self._post_json(f"{base_url}/ai/report/edit", payload, headers)
            out_obj = {"documentId": document_id, "success": True, "titleChanged": bool(title)}
            return ToolExecResult(output=f"Edit success: document updated\n{_json.dumps(out_obj, ensure_ascii=False)}")

        except urllib.error.HTTPError as e:
            status = getattr(e, "code", 500)
            detail = None
            try:
                detail = e.read().decode("utf-8")
            except Exception:
                detail = str(e)
            endpoint = (
                "/ai/report/add" if cmd == "create" else "/ai/report/detail" if cmd == "detail" else "/ai/report/edit"
            )
            if 500 <= status < 600:
                return ToolExecResult(error=f"HTTP {status} at {endpoint}（重试3次后失败）", error_code=-1)
            return ToolExecResult(error=f"HTTP {status} at {endpoint}: {detail}", error_code=-1)
        except Exception as e:
            endpoint = (
                "/ai/report/add" if cmd == "create" else "/ai/report/detail" if cmd == "detail" else "/ai/report/edit"
            )
            return ToolExecResult(error=f"Error calling {endpoint}: {str(e)}", error_code=-1)

    async def _get_online_base_url(self) -> str | None:
        try:
            req = urllib.request.Request("http://localhost:8090/online/base-url", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = resp.read().decode("utf-8")
                data = _json.loads(body)
                return str(data.get("base_url")) if isinstance(data, dict) else None
        except Exception:
            return None

    async def _post_json(self, url: str, payload: dict, headers: dict, retries: int = 3) -> dict:
        backoff = 0.5
        last_err: Exception | None = None
        for i in range(max(1, retries)):
            try:
                data = _json.dumps(payload).encode("utf-8")
                print(f"[OnlineDocTool] Posting to {url} with payload: {payload}", flush=True)
                r = urllib.request.Request(url, data=data, headers=headers, method="POST")
                with urllib.request.urlopen(r, timeout=10) as resp:
                    body = resp.read().decode("utf-8")
                    print(f"[OnlineDocTool] Response from {url}: {body}", flush=True)
                    return _json.loads(body)
            except urllib.error.HTTPError as e:
                code = getattr(e, "code", 500)
                if 500 <= code < 600 and i < retries - 1:
                    last_err = e
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 4.0)
                    continue
                raise
            except Exception as e:
                last_err = e
                if i < retries - 1:
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 4.0)
                    continue
                raise last_err
