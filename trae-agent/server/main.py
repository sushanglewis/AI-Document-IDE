import asyncio
import contextlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Body, WebSocket
from uuid import uuid4
from fastapi.responses import Response
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import yaml
import subprocess
import shlex
import urllib.request
import urllib.error
import json as _json

from trae_agent.agent import Agent
from trae_agent.agent.agent_basics import AgentStep, AgentStepState
# from trae_agent.cli import resolve_config_file
from trae_agent.tools import tools_registry
from trae_agent.tools.base import ToolCall
from trae_agent.utils.config import Config
from trae_agent.utils.lake_view import LakeView
from trae_agent.utils.trajectory_recorder import TrajectoryRecorder
from trae_agent.utils.llm_clients.llm_basics import LLMResponse, LLMUsage
from trae_agent.utils.task_summary_hub import TaskSummaryHub
from trae_agent.prompt.agent_prompt import TRAE_AGENT_SYSTEM_PROMPT, DOCUMENT_AGENT_SYSTEM_PROMPT
import openai
from .db import SessionLocal, init_db, Prompt as PromptModel, ModelConfigStore


class RunRequest(BaseModel):
    task: Optional[str] = None
    file_path: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    model_base_url: Optional[str] = None
    api_key: Optional[str] = None
    max_steps: Optional[int] = None
    working_dir: Optional[str] = None
    must_patch: Optional[bool] = False
    config_file: Optional[str] = "trae_config.yaml"
    trajectory_file: Optional[str] = None
    patch_path: Optional[str] = None
    docker_image: Optional[str] = None
    docker_container_id: Optional[str] = None
    dockerfile_path: Optional[str] = None
    docker_image_file: Optional[str] = None
    docker_keep: Optional[bool] = True
    agent_type: Optional[str] = "trae_agent"
    console_type: Optional[str] = "simple"
    prompt: Optional[str] = None


class AgentModeConfig(BaseModel):
    mode_name: Optional[str] = None
    system_prompt: Optional[str] = None


class InteractiveStartRequest(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    model_base_url: Optional[str] = None
    api_key: Optional[str] = None
    config_file: Optional[str] = "trae_config.yaml"
    max_steps: Optional[int] = None
    trajectory_file: Optional[str] = None
    working_dir: Optional[str] = None
    console_type: Optional[str] = "simple"
    agent_type: Optional[str] = "trae_agent"
    docker_image: Optional[str] = None
    docker_container_id: Optional[str] = None
    dockerfile_path: Optional[str] = None
    docker_image_file: Optional[str] = None
    docker_keep: Optional[bool] = True
    prompt: Optional[str] = None
    model_config_name: Optional[str] = None
    agent_mode_config: Optional[AgentModeConfig] = None
    enable_quality_review: Optional[bool] = None
    quality_review_rules: Optional[str] = None
    use_online_mode: Optional[bool] = None


class InteractiveTaskRequest(BaseModel):
    session_id: str
    task: Optional[str] = None
    file_path: Optional[str] = None
    working_dir: Optional[str] = None
    must_patch: Optional[bool] = False
    patch_path: Optional[str] = None
    prompt: Optional[str] = None
    model_config_name: Optional[str] = None
    agent_mode_config: Optional[AgentModeConfig] = None
    enable_quality_review: Optional[bool] = None
    quality_review_rules: Optional[str] = None


class OnlineDocsSearchRequest(BaseModel):
    pageNum: int = 1
    pageSize: int = 100
    orderBy: str = "updateTime"
    order: str = "desc"
    userId: str = "user"
    keyword: Optional[str] = ""
    documentId: Optional[str] = ""
    filterType: Optional[str] = "all"
    startTime: Optional[str] = ""
    endTime: Optional[str] = ""


class OnlineDocDetailRequest(BaseModel):
    userId: str
    documentId: str

# Duplicate removed


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="Trae Agent API", version="0.1.0", lifespan=lifespan)
_sessions: dict[str, Agent] = {}
_session_working_dirs: dict[str, str] = {}
_session_configs: dict[str, Config] = {}
Path("/workspace").mkdir(parents=True, exist_ok=True)


class TrajectoryEventHub:
    def __init__(self):
        self._subscribers: dict[str, set[asyncio.Queue]] = {}
    def subscribe(self, path: str) -> asyncio.Queue:
        key = str(Path(path).resolve())
        q: asyncio.Queue = asyncio.Queue()
        s = self._subscribers.get(key) or set()
        s.add(q)
        self._subscribers[key] = s
        return q
    def unsubscribe(self, path: str, q: asyncio.Queue) -> None:
        key = str(Path(path).resolve())
        s = self._subscribers.get(key)
        if not s:
            return
        s.discard(q)
        if not s:
            del self._subscribers[key]
    def publish(self, path: str, data: dict) -> None:
        key = str(Path(path).resolve())
        for q in list(self._subscribers.get(key, set())):
            with contextlib.suppress(Exception):
                q.put_nowait(data)


_traj_event_hub = TrajectoryEventHub()


def _safe_resolve_config_file(config_file: str) -> str:
    # Avoid calling CLI resolver that may sys.exit; do a safe existence check only
    path = config_file.replace("file://", "") if config_file.startswith("file://") else config_file
    p = Path(path)
    if p.exists():
        return str(p.resolve())
    raise HTTPException(status_code=400, detail="Config file not found.")


DEFAULT_MINIMAL_CONFIG_YAML = """
agents:
  trae_agent:
    enable_lakeview: true
    model: default_model
    max_steps: 50
    tools:
      - bash
      - str_replace_based_edit_tool
      - sequentialthinking
      - task_done
"""

# Static frontend mounting moved to end of file to avoid intercepting API routes

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/health")
def health_post():
    return {"status": "ok"}


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/openapi/apifox-trae-agent.yaml")
def get_apifox_yaml():
    yaml_path = Path("/app/openapi/trae-agent.yaml")
    try:
        content = yaml_path.read_text(encoding="utf-8")
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="OpenAPI YAML not found.") from e
    return Response(content=content, media_type="text/yaml")


@app.get("/agent/prompt")
def get_prompt(name: str = Query(...)):
    if name == "DOCUMENT_AGENT_SYSTEM_PROMPT":
        return {"prompt": DOCUMENT_AGENT_SYSTEM_PROMPT}
    if name == "TRAE_AGENT_SYSTEM_PROMPT":
        return {"prompt": TRAE_AGENT_SYSTEM_PROMPT}
    raise HTTPException(status_code=400, detail="Unknown prompt name")





@app.get("/agent/tools")
def list_tools():
    res = []
    for name in tools_registry:
        try:
            tool = tools_registry[name]()
            res.append({"name": tool.name, "description": tool.description})
        except Exception as e:
            res.append({"name": name, "description": f"Error loading: {e}"})
    return {"tools": res}


@app.get("/agent/config")
def show_config(
    config_file: str = Query("trae_config.yaml"),
    provider: Optional[str] = None,
    model: Optional[str] = None,
    model_base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    max_steps: Optional[int] = None,
):
    base_cfg = DEFAULT_MINIMAL_CONFIG_YAML
    config = Config.create(config_string=base_cfg).resolve_config_values(
        provider=provider,
        model=model,
        model_base_url=model_base_url,
        api_key=api_key,
        max_steps=max_steps,
    )
    if not config.trae_agent:
        raise HTTPException(status_code=400, detail="trae_agent configuration is required")
    ta = config.trae_agent
    provider_cfg = ta.model.model_provider
    res = {
        "general": {
            "default_provider": provider_cfg.provider,
            "max_steps": ta.max_steps,
        },
        "provider": {
            "model": ta.model.model,
            "base_url": provider_cfg.base_url,
            "api_version": provider_cfg.api_version,
            "api_key_set": bool(provider_cfg.api_key),
            "max_tokens": ta.model.get_max_tokens_param(),
            "temperature": ta.model.temperature,
            "top_p": ta.model.top_p,
            "top_k": ta.model.top_k,
        },
        "tools": ta.tools,
        "enable_lakeview": ta.enable_lakeview,
    }
    if ta.enable_lakeview and config.lakeview:
        lv_provider = config.lakeview.model.model_provider
        res["lakeview"] = {
            "model": config.lakeview.model.model,
            "provider": lv_provider.provider,
            "base_url": lv_provider.base_url,
        }
    return res


@app.post("/online/docs/search")
def online_docs_search(req: OnlineDocsSearchRequest):
    base = _get_online_base_url()
    url = f"{base}/ai/report/search"
    data = _json.dumps(req.model_dump()).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    r = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            return _json.loads(body)
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            detail = str(e)
        raise HTTPException(status_code=e.code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/online/docs/detail")
def online_doc_detail(req: OnlineDocDetailRequest):
    base = _get_online_base_url()
    url = f"{base}/ai/report/detail"
    payload = {"userId": req.userId, "documentId": req.documentId}
    data = _json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    r = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            return _json.loads(body)
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            detail = str(e)
        raise HTTPException(status_code=e.code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/online/docs/create")
def online_doc_create(payload: dict):
    base = _get_online_base_url()
    url = f"{base}/ai/report/add"
    data = _json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    r = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            return _json.loads(body)
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            detail = str(e)
        raise HTTPException(status_code=e.code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/agent/run")
async def run_agent(
    req: RunRequest = Body(...),
    config_file_file: UploadFile | None = File(None),
):
    if req.file_path and req.task:
        raise HTTPException(status_code=400, detail="Provide either task or file_path, not both.")
    if not req.file_path and not req.task:
        raise HTTPException(status_code=400, detail="Missing task.")
    if sum(
        [
            bool(req.docker_image),
            bool(req.docker_container_id),
            bool(req.dockerfile_path),
            bool(req.docker_image_file),
        ]
    ) > 1:
        raise HTTPException(status_code=400, detail="Docker options are mutually exclusive.")

    task = req.task
    if req.file_path:
        try:
            with open(req.file_path, "r") as f:
                task = f.read()
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail="Task file not found.") from e

    if config_file_file is not None:
        base_dir = Path(req.working_dir) if req.working_dir else Path(os.getcwd())
        base_dir.mkdir(parents=True, exist_ok=True)
        suffix = ".yaml" if config_file_file.filename and config_file_file.filename.endswith((".yaml", ".yml")) else ".yaml"
        dest = base_dir / f"trae_config.uploaded.{uuid4().hex}{suffix}"
        content = config_file_file.file.read()
        dest.write_bytes(content)
        cf = str(dest)
    else:
        cf = req.config_file or "trae_config.yaml"
    try:
        cf_resolved = _safe_resolve_config_file(cf)
        config = Config.create(config_file=cf_resolved).resolve_config_values(
            provider=req.provider,
            model=req.model,
            model_base_url=req.model_base_url,
            api_key=req.api_key,
            max_steps=req.max_steps,
        )
    except Exception:
        config = Config.create(config_string=DEFAULT_MINIMAL_CONFIG_YAML).resolve_config_values(
            provider=req.provider,
            model=req.model,
            model_base_url=req.model_base_url,
            api_key=req.api_key,
            max_steps=req.max_steps,
        )

    if not req.agent_type:
        raise HTTPException(status_code=400, detail="agent_type is required.")

    docker_config = None
    if req.dockerfile_path:
        docker_config = {"dockerfile_path": req.dockerfile_path}
    elif req.docker_image_file:
        docker_config = {"docker_image_file": req.docker_image_file}
    elif req.docker_container_id:
        docker_config = {"container_id": req.docker_container_id}
    elif req.docker_image:
        docker_config = {"image": req.docker_image}

    if req.working_dir:
        p = Path(req.working_dir)
        p.mkdir(parents=True, exist_ok=True)
        working_dir = str(p.resolve())
    else:
        working_dir = os.getcwd()

    if not Path(working_dir).is_absolute():
        raise HTTPException(status_code=400, detail="working_dir must be absolute.")

    if docker_config is not None:
        docker_config["workspace_dir"] = working_dir

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    host_default_traj = str(Path(working_dir) / "trajectories" / f"trajectory_{timestamp}.json")
    container_default_traj = f"/workspace/trajectories/trajectory_{timestamp}.json"
    traj_file = req.trajectory_file or host_default_traj

    agent = Agent(
        req.agent_type,
        config,
        (container_default_traj if docker_config is not None else traj_file),
        None,
        docker_config=docker_config,
        docker_keep=bool(req.docker_keep),
    )
    with contextlib.suppress(Exception):
        prompt_val = (req.agent_mode_config.system_prompt if getattr(req, "agent_mode_config", None) and req.agent_mode_config and req.agent_mode_config.system_prompt else req.prompt)
        if prompt_val == "DOCUMENT_AGENT_SYSTEM_PROMPT":
            prompt_val = DOCUMENT_AGENT_SYSTEM_PROMPT
        elif prompt_val == "TRAE_AGENT_SYSTEM_PROMPT":
            prompt_val = TRAE_AGENT_SYSTEM_PROMPT
        if prompt_val:
            agent.agent.set_system_prompt(prompt_val)

    if not docker_config:
        os.chdir(working_dir)

    task_args = {
        "project_path": working_dir,
        "issue": task,
        "must_patch": "true" if req.must_patch else "false",
        "patch_path": req.patch_path,
    }

    execution = await agent.run(task, task_args)
    traj_out = agent.trajectory_file.replace("/workspace", working_dir) if docker_config is not None else agent.trajectory_file
    return {
        "trajectory_file": traj_out,
        "working_dir": working_dir,
        "success": execution.success,
        "final_result": execution.final_result,
        "agent_state": execution.agent_state.value,
        "execution_time": execution.execution_time,
        "steps_count": len(execution.steps),
    }

 
async def _ws_run(websocket: WebSocket, agent: Agent, task: str, task_args: dict[str, str]):
    run_task = asyncio.create_task(agent.run(task, task_args))
    last_emitted_step = 0
    working_dir = task_args.get("project_path")
    traj_out = (
        agent.trajectory_file.replace("/workspace", working_dir)
        if getattr(agent.agent, "docker_manager", None)
        else agent.trajectory_file
    )
    tools_def_ws = []
    try:
        if hasattr(agent.agent, "tools") and agent.agent.tools:
            for t in agent.agent.tools:
                with contextlib.suppress(Exception):
                    tools_def_ws.append({
                        "name": getattr(t, "name", None),
                        "description": getattr(t, "description", None),
                        "parameters": t.get_input_schema() if hasattr(t, "get_input_schema") else None,
                    })
    except Exception:
        pass
    await websocket.send_json({"type": "start", "data": {"trajectory_file": traj_out, "working_dir": working_dir, "tools": (tools_def_ws if tools_def_ws else None)}})
    q = _traj_event_hub.subscribe(agent.trajectory_file)
    last_step_payloads = {}
    try:
        while True:
            if run_task.done() and q.empty():
                break
            try:
                data = await asyncio.wait_for(q.get(), timeout=0.1)
            except asyncio.TimeoutError:
                continue
            steps = data.get("agent_steps", [])
            new_steps = len(steps)
            if new_steps < last_emitted_step:
                continue

            start_sn = last_emitted_step + 1
            if new_steps == last_emitted_step and new_steps > 0:
                # Re-emit the last step as it might have changed
                start_sn = new_steps

            for sn in range(start_sn, new_steps + 1):
                idx = sn - 1
                if idx < 0 or idx >= new_steps:
                    continue
                s = steps[idx]
                lr = s.get("llm_response") if s else None
                usage = lr.get("usage") if lr else None
                tool_calls = s.get("tool_calls") or [] if s else []
                tool_results = s.get("tool_results") or [] if s else []
                content = (lr.get("content") if lr else None) or ""
                content_excerpt = content[:400] if isinstance(content, str) else None
                lr_tool_calls = None
                try:
                    lr_tool_calls = lr.get("tool_calls") if lr else None
                except Exception:
                    lr_tool_calls = None
                state_val = s.get("state") if s else None
                
                # --- Construct Payload ---
                payload = {
                    "steps_count": new_steps,
                    "step_number": s.get("step_number") if s else None,
                    "timestamp": s.get("timestamp") if s else None,
                    "state": (str(state_val).lower() if state_val else None),
                    "phase": (str(state_val) if state_val else None),
                    "error": s.get("error") if s else None,
                    "reflection": s.get("reflection") if s else None,
                    "lakeview_summary": s.get("lakeview_summary") if s else None,
                    "llm_response": (
                        {
                            "model": lr.get("model"),
                            "finish_reason": lr.get("finish_reason"),
                            "usage": usage if usage else None,
                            "content": content,
                            "content_excerpt": content_excerpt,
                            "tool_calls": (
                                [
                                    {
                                        "name": tc.get("name"),
                                        "call_id": tc.get("call_id"),
                                        "arguments": tc.get("arguments"),
                                        "id": tc.get("id"),
                                    }
                                    for tc in (lr_tool_calls or [])
                                ]
                                if lr_tool_calls
                                else None
                            ),
                        }
                        if lr
                        else None
                    ),
                    "tool_calls": (
                        [
                            {
                                "name": tc.get("name"),
                                "call_id": tc.get("call_id"),
                                "arguments": tc.get("arguments"),
                                "id": tc.get("id"),
                            }
                            for tc in tool_calls
                        ]
                        if tool_calls
                        else None
                    ),
                    "tool_results_summary": (
                        {
                            "count": len(tool_results),
                            "success_count": sum(1 for tr in tool_results if bool(tr.get("success")) is True),
                            "error_count": sum(1 for tr in tool_results if tr.get("error")),
                        }
                        if tool_results is not None
                        else None
                    ),
                    "tool_results": (
                        [
                            {
                                "name": tr.get("name"),
                                "call_id": tr.get("call_id"),
                                "success": tr.get("success"),
                                "result": tr.get("result"),
                                "error": tr.get("error"),
                                "summary": (str(tr.get("result") or "").splitlines()[0][:200] if tr.get("result") else None),
                            }
                            for tr in (tool_results or [])
                        ]
                        if tool_results is not None
                        else None
                    ),
                }
                
                # --- Message Units ---
                try:
                    mus: list[dict] = []
                    refl = s.get("reflection")
                    if isinstance(refl, str) and refl.strip() != "":
                        mus.append({"type": "think", "content": refl})
                    for tc in tool_calls:
                        mus.append({"type": "tool_call", "call_id": tc.get("call_id"), "name": tc.get("name"), "arguments": tc.get("arguments")})
                    for tr in tool_results:
                        mus.append({"type": "tool_result", "call_id": tr.get("call_id"), "success": tr.get("success")})
                    if isinstance(content, str) and content.strip() != "":
                        mus.append({"type": "agent_output", "markdown": content})
                    payload["message_units"] = mus if mus else None
                except Exception:
                    pass

                # --- Deduplication ---
                import json
                try:
                    payload_str = json.dumps(payload, sort_keys=True, default=str)
                    if last_step_payloads.get(sn) == payload_str:
                        continue
                    last_step_payloads[sn] = payload_str
                except Exception:
                    pass

                # --- Send Step ---
                await websocket.send_json({"type": "step", "data": payload})
                
                # --- Send Bubbles (Toasts) ---
                try:
                    sn_int = int(s.get("step_number") or 0)
                except Exception:
                    sn_int = 0
                
                try:
                    # 1. Content (Thinking)
                    if isinstance(content, str) and content.strip() != "":
                        is_done = bool(state_val and state_val.lower() != 'thinking')
                        formatted_think = f"🧠 sequentialthinking {sn_int}：{content.strip()}"
                        if is_done:
                            formatted_think += " ✅"
                        
                        await websocket.send_json({
                            "type": "bubble",
                            "data": {
                                "id": f"seq-{sn_int}",
                                "role": "agent",
                                "content": formatted_think,
                                "timestamp": datetime.now().isoformat(),
                            },
                        })
                    
                    # 2. Reflection
                    refl = s.get("reflection")
                    if isinstance(refl, str) and refl.strip() != "":
                        is_done = bool(state_val and state_val.lower() != 'thinking')
                        formatted_refl = f"🧠 sequentialthinking {sn_int}：{refl.strip()}"
                        if is_done:
                            formatted_refl += " ✅"
                        
                        await websocket.send_json({
                            "type": "bubble",
                            "data": {
                                "id": f"seq-reflect-{sn_int}",
                                "role": "agent",
                                "content": formatted_refl,
                                "timestamp": datetime.now().isoformat(),
                            },
                        })

                    # 3. Tool Calls (merged with results)
                    for tc in tool_calls:
                        cid = str(tc.get("call_id") or f"{sn}_{tc.get('name', '')}")
                        tool_name = tc.get('name', '')
                        args = tc.get("arguments")
                        
                        content_tc = ""

                        # Helper to parse args
                        local_args = args
                        if isinstance(local_args, str):
                            try:
                                local_args = json.loads(local_args)
                            except:
                                pass
                        if not isinstance(local_args, dict):
                            local_args = {}

                        # 1. Sequential Thinking
                        if tool_name == "sequentialthinking":
                            thought = local_args.get("thought", "")
                            content_tc = f"🧠sequentialthinking：{thought}"

                        # 2. String Replace Tool
                        elif tool_name == "str_replace_based_edit_tool":
                            cmd = local_args.get("command", "")
                            path = local_args.get("path", "")
                            file_text = local_args.get("file_text", "")
                            
                            # Truncate file_text if too long
                            if len(file_text) > 500:
                                file_text = file_text[:500] + "\n...(truncated)..."
                            
                            content_tc = f"🔧str_replace_based_edit_tool {cmd}：{path}\n{file_text}"

                        # 3. CKG Optimization
                        elif tool_name == 'ckg':
                            cmd = local_args.get('command')
                            ident = local_args.get('identifier')
                            if cmd and ident:
                                content_tc = f"🔧ckg {cmd}: {ident}"
                            else:
                                arg_str = ""
                                try:
                                    arg_str = json.dumps(args, ensure_ascii=False)
                                except:
                                    arg_str = str(args)
                                content_tc = f"🔧ckg {arg_str}".strip()

                        # 4. Default Formatting
                        else:
                            arg_str = ""
                            try:
                                arg_str = json.dumps(args, ensure_ascii=False)
                            except:
                                arg_str = str(args)
                            content_tc = f"🔧{tool_name} {arg_str}".strip()
                        
                        # Check result
                        res = next((tr for tr in tool_results if str(tr.get("call_id")) == cid), None)
                        if res:
                            success = bool(res.get("success"))
                            content_tc += " ✅" if success else " ❌"
                        
                        await websocket.send_json({
                            "type": "bubble",
                            "data": {
                                "id": f"tc-{sn}-{cid}",
                                "role": "agent",
                                "content": content_tc,
                                "timestamp": datetime.now().isoformat(),
                                "call_id": cid,
                            },
                        })
                        
                    # 4. Tool Results (Suppressed as merged above)
                    
                except Exception:
                    pass
            last_emitted_step = new_steps
        execution = await run_task
    except Exception as e:
        await websocket.send_json({"type": "error", "data": {"message": str(e)}})
        await websocket.send_json({"type": "end", "data": "done"})
        return
    finally:
        with contextlib.suppress(Exception):
            _traj_event_hub.unsubscribe(agent.trajectory_file, q)
    final_result = execution.final_result
    payload = {
        "trajectory_file": traj_out,
        "working_dir": working_dir,
        "success": execution.success,
        "final_result": final_result,
        "agent_state": execution.agent_state.value,
        "execution_time": execution.execution_time,
        "steps_count": len(execution.steps),
    }
    await websocket.send_json({"type": "completed", "data": payload})
    await websocket.send_json({"type": "end", "data": "done"})

@app.websocket("/ws/agent/run/stream")
async def ws_run_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        raw = await websocket.receive_text()
        parsed = json.loads(raw)
        req = RunRequest(**parsed)
    except Exception:
        await websocket.close(code=1003)
        return
    if req.file_path and req.task:
        await websocket.send_json({"type": "error", "data": {"message": "Provide either task or file_path, not both."}})
        await websocket.close(code=1003)
        return
    if not req.file_path and not req.task:
        await websocket.send_json({"type": "error", "data": {"message": "Missing task."}})
        await websocket.close(code=1003)
        return
    if sum([
        bool(req.docker_image),
        bool(req.docker_container_id),
        bool(req.dockerfile_path),
        bool(req.docker_image_file),
    ]) > 1:
        await websocket.send_json({"type": "error", "data": {"message": "Docker options are mutually exclusive."}})
        await websocket.close(code=1003)
        return
    task = req.task
    if req.file_path:
        try:
            with open(req.file_path, "r") as f:
                task = f.read()
        except FileNotFoundError:
            await websocket.send_json({"type": "error", "data": {"message": "Task file not found."}})
            await websocket.close(code=1003)
            return
    cf = req.config_file or "trae_config.yaml"
    try:
        cf_resolved = _safe_resolve_config_file(cf)
        config = Config.create(config_file=cf_resolved).resolve_config_values(
            provider=req.provider,
            model=req.model,
            model_base_url=req.model_base_url,
            api_key=req.api_key,
            max_steps=req.max_steps,
        )
    except Exception:
        config = Config.create(config_string=DEFAULT_MINIMAL_CONFIG_YAML).resolve_config_values(
            provider=req.provider,
            model=req.model,
            model_base_url=req.model_base_url,
            api_key=req.api_key,
            max_steps=req.max_steps,
        )
    if not req.agent_type:
        await websocket.send_json({"type": "error", "data": {"message": "agent_type is required."}})
        await websocket.close(code=1003)
        return
    docker_config = None
    if req.dockerfile_path:
        docker_config = {"dockerfile_path": req.dockerfile_path}
    elif req.docker_image_file:
        docker_config = {"docker_image_file": req.docker_image_file}
    elif req.docker_container_id:
        docker_config = {"container_id": req.docker_container_id}
    elif req.docker_image:
        docker_config = {"image": req.docker_image}
    if req.working_dir:
        p = Path(req.working_dir)
        p.mkdir(parents=True, exist_ok=True)
        working_dir = str(p.resolve())
    else:
        working_dir = os.getcwd()
    if not Path(working_dir).is_absolute():
        await websocket.send_json({"type": "error", "data": {"message": "working_dir must be absolute."}})
        await websocket.close(code=1003)
        return
    if docker_config is not None:
        docker_config["workspace_dir"] = working_dir

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    host_default_traj = str(Path(working_dir) / "trajectories" / f"trajectory_{timestamp}.json")
    container_default_traj = f"/workspace/trajectories/trajectory_{timestamp}.json"
    traj_file = req.trajectory_file or host_default_traj

    agent = Agent(
        req.agent_type,
        config,
        (container_default_traj if docker_config is not None else traj_file),
        None,
        docker_config=docker_config,
        docker_keep=bool(req.docker_keep),
    )
    with contextlib.suppress(Exception):
        from trae_agent.utils.trajectory_recorder import TrajectoryRecorder
        def _cb(data: dict):
            _traj_event_hub.publish(agent.trajectory_file, data)
        TrajectoryRecorder.add_global_listener(agent.trajectory_file, _cb)
    with contextlib.suppress(Exception):
        agent.agent.set_system_prompt(req.prompt)
    if not docker_config:
        os.chdir(working_dir)
    task_args = {
        "project_path": working_dir,
        "issue": task,
        "must_patch": "true" if req.must_patch else "false",
        "patch_path": req.patch_path,
    }
    await _ws_run(websocket, agent, task, task_args)


@app.post("/agent/interactive/start")
def interactive_start(
    req: InteractiveStartRequest = Body(...),
):
    try:
        cf = _safe_resolve_config_file(req.config_file or "trae_config.yaml")
        config = Config.create(config_file=cf).resolve_config_values(
            provider=req.provider,
            model=req.model,
            model_base_url=req.model_base_url,
            api_key=req.api_key,
            max_steps=req.max_steps,
        )
    except Exception:
        config = Config.create(config_string=DEFAULT_MINIMAL_CONFIG_YAML).resolve_config_values(
            provider=req.provider,
            model=req.model,
            model_base_url=req.model_base_url,
            api_key=req.api_key,
            max_steps=req.max_steps,
        )
    if req.model_config_name:
        db = SessionLocal()
        try:
            mc = db.query(ModelConfigStore).filter(ModelConfigStore.name == req.model_config_name).first()
            if mc:
                config = config.resolve_config_values(
                    provider=mc.provider,
                    model=mc.model,
                    model_base_url=mc.base_url,
                    api_key=mc.api_key,
                    max_steps=req.max_steps,
                )
        finally:
            db.close()
    if not req.agent_type:
        raise HTTPException(status_code=400, detail="agent_type is required.")
    if not config.trae_agent:
        raise HTTPException(status_code=400, detail="trae_agent configuration is required")
    if sum(
        [
            bool(req.docker_image),
            bool(req.docker_container_id),
            bool(req.dockerfile_path),
            bool(req.docker_image_file),
        ]
    ) > 1:
        raise HTTPException(status_code=400, detail="Docker options are mutually exclusive.")
    docker_config = None
    if req.working_dir:
        p = Path(req.working_dir)
        p.mkdir(parents=True, exist_ok=True)
        working_dir = str(p.resolve())
    else:
        working_dir = os.getcwd()
    if not Path(working_dir).is_absolute():
        raise HTTPException(status_code=400, detail="working_dir must be absolute.")
    if req.dockerfile_path:
        docker_config = {"dockerfile_path": req.dockerfile_path}
    elif req.docker_image_file:
        docker_config = {"docker_image_file": req.docker_image_file}
    elif req.docker_container_id:
        docker_config = {"container_id": req.docker_container_id}
    elif req.docker_image:
        docker_config = {"image": req.docker_image}
    session_id = str(uuid4())
    _session_working_dirs[session_id] = working_dir

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    host_default_traj = str(Path(working_dir) / "trajectories" / f"trajectory_{timestamp}.json")
    container_default_traj = f"/workspace/trajectories/trajectory_{timestamp}.json"
    traj_file = req.trajectory_file or (container_default_traj if docker_config is not None else host_default_traj)

    if docker_config is not None:
        docker_config["workspace_dir"] = working_dir

    try:
        if bool(getattr(req, "use_online_mode", False)) and config and config.trae_agent:
            base_tools = list(config.trae_agent.tools or [])
            if "online_doc_tool" not in base_tools:
                base_tools.append("online_doc_tool")
            config.trae_agent.tools = base_tools
    except Exception:
        pass

    agent = Agent(
        req.agent_type,
        config,
        traj_file,
        None,
        docker_config=docker_config,
        docker_keep=bool(req.docker_keep),
    )
    # Sync environment for tools that rely on env-based model configuration
    try:
        if config and config.trae_agent and config.trae_agent.model:
            prov = config.trae_agent.model.model_provider
            model_name = config.trae_agent.model.model
            if prov and prov.provider:
                os.environ["DEFAULT_PROVIDER"] = str(prov.provider)
            if model_name:
                os.environ["DEFAULT_MODEL"] = str(model_name)
            if prov and prov.api_key:
                os.environ[str(prov.provider).upper() + "_API_KEY"] = str(prov.api_key)
            if prov and prov.base_url:
                os.environ[str(prov.provider).upper() + "_BASE_URL"] = str(prov.base_url)
        if getattr(agent, "trajectory_file", None):
            os.environ["TRAJECTORY_FILE"] = str(agent.trajectory_file)
    except Exception:
        pass
    # Enable quality review strictly by toggle
    try:
        if req.enable_quality_review is True:
            agent.agent.enable_quality_review = True
            if req.quality_review_rules is not None:
                agent.agent.quality_review_rules = req.quality_review_rules
            with contextlib.suppress(Exception):
                agent.agent._model_config.parallel_tool_calls = False
            with contextlib.suppress(Exception):
                if _session_configs.get(session_id) and _session_configs[session_id].trae_agent:
                    _session_configs[session_id].trae_agent.model.parallel_tool_calls = False
            with contextlib.suppress(Exception):
                agent.agent.ensure_quality_review_tool()
        elif req.enable_quality_review is False:
            agent.agent.enable_quality_review = False
            agent.agent.quality_review_rules = None
    except Exception:
        pass
    # Resolve prompt: accept name or raw text; prefer agent_mode_config.system_prompt
    with contextlib.suppress(Exception):
        prompt_val = (req.agent_mode_config.system_prompt if getattr(req, "agent_mode_config", None) and req.agent_mode_config and req.agent_mode_config.system_prompt else req.prompt)
        if prompt_val == "DOCUMENT_AGENT_SYSTEM_PROMPT":
            prompt_val = DOCUMENT_AGENT_SYSTEM_PROMPT
        elif prompt_val == "TRAE_AGENT_SYSTEM_PROMPT":
            prompt_val = TRAE_AGENT_SYSTEM_PROMPT
        if prompt_val:
            agent.agent.set_system_prompt(prompt_val)
    _sessions[session_id] = agent
    _session_configs[session_id] = config
    _session_configs[session_id] = config
    traj_out = agent.trajectory_file.replace("/workspace", working_dir) if docker_config is not None else agent.trajectory_file
    with contextlib.suppress(Exception):
        from trae_agent.utils.trajectory_recorder import TrajectoryRecorder
        def _cb(data: dict):
            _traj_event_hub.publish(agent.trajectory_file, data)
        TrajectoryRecorder.add_global_listener(agent.trajectory_file, _cb)
    return {"session_id": session_id, "trajectory_file": traj_out, "working_dir": working_dir}


@app.get("/workspace")
def get_workspace():
    return {"workspace": "/workspace"}


@app.get("/workspaces")
def list_workspaces():
    return ["/workspace"]


@app.get("/workspaces/files")
def workspaces_files(
    workspace: str = Query(...),
    relative_dir: str | None = Query(None),
):
    data = list_files(session_id=None, relative_dir=relative_dir, workspace=workspace)
    base = Path(workspace).resolve()
    files = []
    for item in data.get("items", []):
        host_path = Path(item.get("host_path") or "").resolve()
        try:
            rel = host_path.relative_to(base)
            files.append({
                "name": item.get("name"),
                "relative_path": str(rel),
                "is_dir": item.get("is_dir"),
            })
        except Exception:
            files.append({
                "name": item.get("name"),
                "relative_path": item.get("container_path", ""),
                "is_dir": item.get("is_dir"),
            })
    return {"files": files}


@app.websocket("/ws/agent/interactive/task")
async def ws_interactive_task(websocket: WebSocket):
    await websocket.accept()
    async def listener(data: dict):
        try:
            await websocket.send_json(data)
        except Exception:
            pass
    TaskSummaryHub.add_listener(listener)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        pass


@app.post("/agent/interactive/task")
async def interactive_task(req: InteractiveTaskRequest):
    if req.session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    if req.file_path and req.task:
        raise HTTPException(status_code=400, detail="Provide either task or file_path, not both.")
    if not req.file_path and not req.task:
        raise HTTPException(status_code=400, detail="Missing task.")
    task = req.task
    if req.file_path:
        try:
            with open(req.file_path, "r") as f:
                task = f.read()
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail="Task file not found.") from e
    if req.working_dir:
        p = Path(req.working_dir)
        p.mkdir(parents=True, exist_ok=True)
        working_dir = str(p.resolve())
    else:
        working_dir = os.getcwd()
    if not Path(working_dir).is_absolute():
        raise HTTPException(status_code=400, detail="working_dir must be absolute.")
    _session_working_dirs[req.session_id] = working_dir
    agent = _sessions[req.session_id]
    # Ensure env remains aligned with session config for tools
    try:
        cfg = _session_configs.get(req.session_id)
        if cfg and cfg.trae_agent and cfg.trae_agent.model:
            prov = cfg.trae_agent.model.model_provider
            model_name = cfg.trae_agent.model.model
            if prov and prov.provider:
                os.environ["DEFAULT_PROVIDER"] = str(prov.provider)
            if model_name:
                os.environ["DEFAULT_MODEL"] = str(model_name)
            if prov and prov.api_key:
                os.environ[str(prov.provider).upper() + "_API_KEY"] = str(prov.api_key)
            if prov and prov.base_url:
                os.environ[str(prov.provider).upper() + "_BASE_URL"] = str(prov.base_url)
        if getattr(agent, "trajectory_file", None):
            os.environ["TRAJECTORY_FILE"] = str(agent.trajectory_file)
    except Exception:
        pass
    # Enable quality review if explicitly requested or rules are provided
    try:
        if req.enable_quality_review is True:
            agent.agent.enable_quality_review = True
            if req.quality_review_rules:
                agent.agent.quality_review_rules = req.quality_review_rules
            with contextlib.suppress(Exception):
                agent.agent._model_config.parallel_tool_calls = False
            with contextlib.suppress(Exception):
                if _session_configs.get(req.session_id) and _session_configs[req.session_id].trae_agent:
                    _session_configs[req.session_id].trae_agent.model.parallel_tool_calls = False
            with contextlib.suppress(Exception):
                agent.agent.ensure_quality_review_tool()
        elif req.enable_quality_review is False:
            agent.agent.enable_quality_review = False
            agent.agent.quality_review_rules = None
    except Exception:
        pass
    # Resolve prompt during task as well; prefer agent_mode_config.system_prompt
    try:
        prompt_val = (req.agent_mode_config.system_prompt if getattr(req, "agent_mode_config", None) and req.agent_mode_config and req.agent_mode_config.system_prompt else req.prompt)
        if prompt_val == "DOCUMENT_AGENT_SYSTEM_PROMPT":
            prompt_val = DOCUMENT_AGENT_SYSTEM_PROMPT
        elif prompt_val == "TRAE_AGENT_SYSTEM_PROMPT":
            prompt_val = TRAE_AGENT_SYSTEM_PROMPT
        if prompt_val:
            agent.agent.set_system_prompt(prompt_val)
    except Exception:
        pass
    if getattr(agent.agent, "docker_config", None):
        prev_dir = agent.agent.docker_manager.workspace_dir if agent.agent.docker_manager else None
        agent.agent.set_docker_workspace_dir(working_dir)
        if agent.agent.docker_manager and agent.agent.docker_manager.container and prev_dir and os.path.abspath(prev_dir) != os.path.abspath(working_dir):
            agent.agent.docker_manager.stop()
    else:
        os.chdir(working_dir)
    task_args = {
        "project_path": working_dir,
        "issue": task,
        "must_patch": "true" if req.must_patch else "false",
        "patch_path": req.patch_path,
    }
    execution = await agent.run(task, task_args)
    return {
        "trajectory_file": agent.trajectory_file,
        "working_dir": working_dir,
        "success": execution.success,
        "final_result": execution.final_result,
        "agent_state": execution.agent_state.value,
        "execution_time": execution.execution_time,
        "steps_count": len(execution.steps),
    }





@app.websocket("/ws/agent/interactive/task")
async def ws_interactive_task(websocket: WebSocket):
    await websocket.accept()
    try:
        raw = await websocket.receive_text()
        parsed = json.loads(raw)
        req = InteractiveTaskRequest(**parsed)
    except Exception:
        await websocket.close(code=1003)
        return
    if req.session_id not in _sessions:
        await websocket.send_json({"type": "error", "data": {"message": "Session not found."}})
        await websocket.close(code=1008)
        return
    if req.file_path and req.task:
        await websocket.send_json({"type": "error", "data": {"message": "Provide either task or file_path, not both."}})
        await websocket.close(code=1003)
        return
    if not req.file_path and not req.task:
        await websocket.send_json({"type": "error", "data": {"message": "Missing task."}})
        await websocket.close(code=1003)
        return
    task = req.task
    if req.file_path:
        try:
            with open(req.file_path, "r") as f:
                task = f.read()
        except FileNotFoundError:
            await websocket.send_json({"type": "error", "data": {"message": "Task file not found."}})
            await websocket.close(code=1003)
            return
    if req.working_dir:
        p = Path(req.working_dir)
        working_dir = str(p.resolve())
    else:
        working_dir = os.getcwd()
    if not Path(working_dir).is_absolute():
        await websocket.send_json({"type": "error", "data": {"message": "working_dir must be absolute."}})
        await websocket.close(code=1003)
        return
    if not Path(working_dir).exists():
        await websocket.send_json({"type": "error", "data": {"message": "Working directory not found."}})
        await websocket.close(code=1003)
        return
    _session_working_dirs[req.session_id] = working_dir
    agent = _sessions[req.session_id]
    try:
        if req.enable_quality_review is True:
            agent.agent.enable_quality_review = True
            if req.quality_review_rules:
                agent.agent.quality_review_rules = req.quality_review_rules
            with contextlib.suppress(Exception):
                agent.agent._model_config.parallel_tool_calls = False
            with contextlib.suppress(Exception):
                if _session_configs.get(req.session_id) and _session_configs[req.session_id].trae_agent:
                    _session_configs[req.session_id].trae_agent.model.parallel_tool_calls = False
            with contextlib.suppress(Exception):
                agent.agent.ensure_quality_review_tool()
        elif req.enable_quality_review is False:
            agent.agent.enable_quality_review = False
            agent.agent.quality_review_rules = None
    except Exception:
        pass
    with contextlib.suppress(Exception):
        prompt_val = (req.agent_mode_config.system_prompt if getattr(req, "agent_mode_config", None) and req.agent_mode_config and req.agent_mode_config.system_prompt else req.prompt)
        if prompt_val == "DOCUMENT_AGENT_SYSTEM_PROMPT":
            prompt_val = DOCUMENT_AGENT_SYSTEM_PROMPT
        elif prompt_val == "TRAE_AGENT_SYSTEM_PROMPT":
            prompt_val = TRAE_AGENT_SYSTEM_PROMPT
        if prompt_val:
            agent.agent.set_system_prompt(prompt_val)
    if req.model_config_name:
        db = SessionLocal()
        try:
            mc = db.query(ModelConfigStore).filter(ModelConfigStore.name == req.model_config_name).first()
            if mc:
                cfg = Config.create(config_string=DEFAULT_MINIMAL_CONFIG_YAML).resolve_config_values(
                    provider=mc.provider,
                    model=mc.model,
                    model_base_url=mc.base_url,
                    api_key=mc.api_key,
                    max_steps=None,
                )
                _session_configs[req.session_id] = cfg
        finally:
            db.close()
    if getattr(agent.agent, "docker_config", None):
        prev_dir = agent.agent.docker_manager.workspace_dir if agent.agent.docker_manager else None
        agent.agent.set_docker_workspace_dir(working_dir)
        if agent.agent.docker_manager and agent.agent.docker_manager.container and prev_dir and os.path.abspath(prev_dir) != os.path.abspath(working_dir):
            agent.agent.docker_manager.stop()
    else:
        os.chdir(working_dir)
    task_args = {
        "project_path": working_dir,
        "issue": task,
        "must_patch": "true" if req.must_patch else "false",
        "patch_path": req.patch_path,
    }

    class WSConsole:
        def __init__(self, ws: WebSocket, session_id: str):
            self.ws = ws
            self.session_id = session_id
            self._emitted_steps: set[int] = set()
            self._emitted_calls: set[str] = set()
            self._emitted_results: set[str] = set()
            self._queue: asyncio.Queue[dict] = asyncio.Queue()
            self._sender_task: asyncio.Task | None = None

        async def start(self):
            async def _sender():
                while True:
                    item = await self._queue.get()
                    try:
                        await self.ws.send_json(item)
                    except Exception:
                        pass
                    finally:
                        self._queue.task_done()
            if self._sender_task is None:
                self._sender_task = asyncio.create_task(_sender())
            return None

        async def flush(self):
            try:
                await self._queue.join()
            except Exception:
                pass

        def update_status(self, step: AgentStep | None = None, agent_execution=None):
            if step is None:
                return
            try:
                lr = step.llm_response
                usage = lr.usage if lr else None
                content = (lr.content if lr and isinstance(lr.content, str) else "")
                content_excerpt = content[:400] if isinstance(content, str) else None
                lr_tool_calls = lr.tool_calls if lr else None
                tool_calls = step.tool_calls or []
                tool_results = step.tool_results or []
                payload = {
                    "steps_count": None,
                    "step_number": step.step_number,
                    "timestamp": datetime.now().isoformat(),
                    "state": step.state.value,
                    "phase": step.state.value,
                    "error": None,
                    "reflection": step.reflection,
                    "lakeview_summary": None,
                    "llm_response": (
                        {
                            "model": lr.model,
                            "finish_reason": lr.finish_reason,
                            "usage": (
                                {
                                    "input_tokens": getattr(usage, "input_tokens", None),
                                    "output_tokens": getattr(usage, "output_tokens", None),
                                }
                                if usage
                                else None
                            ),
                            "content": content,
                            "content_excerpt": content_excerpt,
                            "tool_calls": (
                                [
                                    {
                                        "name": tc.name,
                                        "call_id": tc.call_id,
                                        "arguments": tc.arguments,
                                        "id": getattr(tc, "id", None),
                                    }
                                    for tc in (lr_tool_calls or [])
                                ]
                                if lr_tool_calls
                                else None
                            ),
                        }
                        if lr
                        else None
                    ),
                    "tool_calls": (
                        [
                            {
                                "name": tc.name,
                                "call_id": tc.call_id,
                                "arguments": tc.arguments,
                                "id": getattr(tc, "id", None),
                            }
                            for tc in tool_calls
                        ]
                        if tool_calls
                        else None
                    ),
                    "tool_results_summary": (
                        {
                            "count": len(tool_results),
                            "success_count": sum(1 for tr in tool_results if bool(getattr(tr, "success", False)) is True),
                            "error_count": sum(1 for tr in tool_results if getattr(tr, "error", None)),
                        }
                        if tool_results is not None
                        else None
                    ),
                    "tool_results": (
                        [
                            {
                                "name": getattr(tr, "name", None),
                                "call_id": getattr(tr, "call_id", None),
                                "success": getattr(tr, "success", None),
                                "result": getattr(tr, "result", None),
                                "error": getattr(tr, "error", None),
                                "summary": (str(getattr(tr, "result", "")).splitlines()[0][:200] if getattr(tr, "result", None) else None),
                            }
                            for tr in (tool_results or [])
                        ]
                        if tool_results is not None
                        else None
                    ),
                }
                mus: list[dict] = []
                if isinstance(step.reflection, str) and step.reflection.strip() != "":
                    mus.append({"type": "think", "content": step.reflection})
                for tc in tool_calls:
                    mus.append({"type": "tool_call", "call_id": getattr(tc, "call_id", None), "name": getattr(tc, "name", None), "arguments": getattr(tc, "arguments", None)})
                for tr in tool_results:
                    mus.append({"type": "tool_result", "call_id": getattr(tr, "call_id", None), "success": getattr(tr, "success", None)})
                if isinstance(content, str) and content.strip() != "":
                    mus.append({"type": "agent_output", "markdown": content})
                payload["message_units"] = mus if mus else None

                self._queue.put_nowait({"type": "step", "data": payload})

                sn = int(step.step_number or 0)
                if sn not in self._emitted_steps:
                    seq_texts: list[str] = []
                    if lr and isinstance(content, str) and content.strip() != "":
                        seq_texts.append(f"🧠 sequentialthinking {sn}：{content.strip()}")
                    if isinstance(step.reflection, str) and step.reflection.strip() != "":
                        seq_texts.append(f"🧠 sequentialthinking {sn}：{step.reflection.strip()}")
                    for t in seq_texts:
                        self._queue.put_nowait({"type": "bubble", "data": {"id": f"seq-{sn}", "role": "agent", "content": t, "timestamp": datetime.now().isoformat()}})
                    self._emitted_steps.add(sn)

                for tc in tool_calls:
                    cid = str(getattr(tc, "call_id", None) or f"{sn}_{getattr(tc, 'name', '')}")
                    if cid in self._emitted_calls:
                        continue
                    args = getattr(tc, "arguments", None)
                    tool_name = getattr(tc, "name", "")
                    
                    content_tc = ""
                    
                    # 1. Sequential Thinking Formatting
                    if tool_name == "sequentialthinking":
                        thought = ""
                        if isinstance(args, dict):
                            thought = args.get("thought", "")
                        elif isinstance(args, str):
                            try:
                                parsed = json.loads(args)
                                thought = parsed.get("thought", "")
                            except:
                                pass
                        content_tc = f"🧠sequentialthinking：{thought}"

                    # 2. String Replace Tool Formatting
                    elif tool_name == "str_replace_based_edit_tool":
                        cmd = ""
                        path = ""
                        file_text = ""
                        if isinstance(args, dict):
                            cmd = args.get("command", "")
                            path = args.get("path", "")
                            file_text = args.get("file_text", "")
                        elif isinstance(args, str):
                            try:
                                parsed = json.loads(args)
                                cmd = parsed.get("command", "")
                                path = parsed.get("path", "")
                                file_text = parsed.get("file_text", "")
                            except:
                                pass
                        
                        # Truncate file_text if too long, but keep it visible as requested
                        # User asked for: 🔧str_replace_based_edit_tool create：/workspace/file.md \n # Content...
                        # We'll truncate to 500 chars to avoid massive bubbles
                        if len(file_text) > 500:
                            file_text = file_text[:500] + "\n...(truncated)..."
                            
                        content_tc = f"🔧str_replace_based_edit_tool {cmd}：{path}\n{file_text}"

                    # 3. Default Formatting
                    else:
                        arg_excerpt = None
                        if isinstance(args, dict):
                            keys = list(args.keys())
                            preview = {k: args.get(k) for k in keys[:3]}
                            arg_excerpt = json.dumps(preview, ensure_ascii=False)
                        else:
                            arg_excerpt = str(args)
                        content_tc = f"🔧 {tool_name} {arg_excerpt or ''}".strip()

                    self._queue.put_nowait({"type": "bubble", "data": {"id": f"tc-{sn}-{cid}", "role": "agent", "content": content_tc.strip(), "timestamp": datetime.now().isoformat(), "call_id": cid}})
                    self._emitted_calls.add(cid)

                for tr in tool_results:
                    cid = str(getattr(tr, "call_id", None) or f"{sn}_result")
                    if cid in self._emitted_results:
                        continue
                    ok = bool(getattr(tr, "success", False))
                    res = getattr(tr, "result", None)
                    err = getattr(tr, "error", None)
                    icon = "✅" if ok else "❌"
                    text = str(res if res is not None else (err or ""))
                    self._queue.put_nowait({"type": "bubble", "data": {"id": f"tr-{sn}-{cid}", "role": ("agent" if ok else "error"), "content": f"{icon} {text}", "timestamp": datetime.now().isoformat(), "call_id": cid, "details": text}})
                    self._emitted_results.add(cid)
            except Exception:
                pass

    await _ws_run(websocket, agent, task, task_args)


class LakeviewSummarizeRequest(BaseModel):
    trajectory_file: str
    config_file: Optional[str] = "trae_config.yaml"
    step_numbers: Optional[list[int]] = None
    update_trajectory: Optional[bool] = True


@app.post("/lakeview/summary")
async def lakeview_summary(req: LakeviewSummarizeRequest):
    if not Path(req.trajectory_file).is_absolute():
        raise HTTPException(status_code=400, detail="trajectory_file must be absolute.")
    try:
        with open(req.trajectory_file, "r") as f:
            data = json.load(f)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="Trajectory file not found.") from e
    cf = _safe_resolve_config_file(req.config_file or "trae_config.yaml")
    config = Config.create(config_file=cf)
    if not config.trae_agent:
        raise HTTPException(status_code=400, detail="trae_agent configuration is required")
    if not config.trae_agent.enable_lakeview or not config.lakeview:
        raise HTTPException(status_code=400, detail="Lakeview is disabled or not configured.")
    lv = LakeView(config.lakeview)
    agent_steps = data.get("agent_steps", [])
    summaries: list[dict[str, object]] = []
    selected = set(req.step_numbers or [])
    for step in agent_steps:
        sn = int(step.get("step_number", 0))
        if selected and sn not in selected:
            continue
        lr = step.get("llm_response")
        if not lr or not lr.get("content"):
            continue
        usage = lr.get("usage")
        llm_usage = None
        if usage and (usage.get("input_tokens") is not None or usage.get("output_tokens") is not None):
            llm_usage = LLMUsage(
                input_tokens=int(usage.get("input_tokens") or 0),
                output_tokens=int(usage.get("output_tokens") or 0),
                cache_creation_input_tokens=int(usage.get("cache_creation_input_tokens") or 0)
                if usage.get("cache_creation_input_tokens") is not None
                else 0,
                cache_read_input_tokens=int(usage.get("cache_read_input_tokens") or 0)
                if usage.get("cache_read_input_tokens") is not None
                else 0,
                reasoning_tokens=int(usage.get("reasoning_tokens") or 0)
                if usage.get("reasoning_tokens") is not None
                else 0,
            )
        tool_calls_data = lr.get("tool_calls") or []
        tool_calls: list[ToolCall] = []
        for tc in tool_calls_data:
            with contextlib.suppress(Exception):
                tool_calls.append(
                    ToolCall(
                        name=str(tc.get("name")),
                        call_id=str(tc.get("call_id")),
                        arguments=tc.get("arguments") or {},
                        id=tc.get("id"),
                    )
                )
        llm_resp = LLMResponse(
            content=str(lr.get("content")),
            usage=llm_usage,
            model=lr.get("model"),
            finish_reason=lr.get("finish_reason"),
            tool_calls=tool_calls if tool_calls else None,
        )
        agent_step = AgentStep(step_number=sn, state=AgentStepState.COMPLETED, llm_response=llm_resp)
        lv_step = await lv.create_lakeview_step(agent_step)
        if lv_step:
            summaries.append(
                {
                    "step_number": sn,
                    "task": lv_step.desc_task,
                    "details": lv_step.desc_details,
                    "tags": lv_step.tags_emoji,
                }
            )
            if req.update_trajectory:
                for s in data["agent_steps"]:
                    if int(s.get("step_number", 0)) == sn:
                        s["lakeview_summary"] = f"[{lv_step.tags_emoji}] {lv_step.desc_task} — {lv_step.desc_details}"
                        break
    if req.update_trajectory:
        try:
            with open(req.trajectory_file, "w") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            with contextlib.suppress(Exception):
                TrajectoryRecorder.notify_ws_update(req.trajectory_file, data)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to update trajectory: {e}") from e
    return {"summaries": summaries, "count": len(summaries)}


@app.post("/lakeview/summary/stream")
async def lakeview_summary_stream(req: LakeviewSummarizeRequest):
    async def gen():
        if not Path(req.trajectory_file).is_absolute():
            yield "event: error\n" + "data: trajectory_file must be absolute.\n\n"
            return
        try:
            with open(req.trajectory_file, "r") as f:
                data = json.load(f)
        except FileNotFoundError:
            yield "event: error\n" + "data: Trajectory file not found.\n\n"
            return
        cf = _safe_resolve_config_file(req.config_file or "trae_config.yaml")
        config = Config.create(config_file=cf)
        if not config.trae_agent or not config.trae_agent.enable_lakeview or not config.lakeview:
            yield "event: error\n" + "data: Lakeview is disabled or not configured.\n\n"
            return
        lv = LakeView(config.lakeview)
        agent_steps = data.get("agent_steps", [])
        selected = set(req.step_numbers or [])
        yield "event: start\n" + "data: begin\n\n"
        for step in agent_steps:
            sn = int(step.get("step_number", 0))
            if selected and sn not in selected:
                continue
            lr = step.get("llm_response")
            if not lr or not lr.get("content"):
                continue
            usage = lr.get("usage")
            llm_usage = None
            if usage and (usage.get("input_tokens") is not None or usage.get("output_tokens") is not None):
                llm_usage = LLMUsage(
                    input_tokens=int(usage.get("input_tokens") or 0),
                    output_tokens=int(usage.get("output_tokens") or 0),
                    cache_creation_input_tokens=int(usage.get("cache_creation_input_tokens") or 0)
                    if usage.get("cache_creation_input_tokens") is not None
                    else 0,
                    cache_read_input_tokens=int(usage.get("cache_read_input_tokens") or 0)
                    if usage.get("cache_read_input_tokens") is not None
                    else 0,
                    reasoning_tokens=int(usage.get("reasoning_tokens") or 0)
                    if usage.get("reasoning_tokens") is not None
                    else 0,
                )
            tool_calls_data = lr.get("tool_calls") or []
            tool_calls: list[ToolCall] = []
            for tc in tool_calls_data:
                with contextlib.suppress(Exception):
                    tool_calls.append(
                        ToolCall(
                            name=str(tc.get("name")),
                            call_id=str(tc.get("call_id")),
                            arguments=tc.get("arguments") or {},
                            id=tc.get("id"),
                        )
                    )
            llm_resp = LLMResponse(
                content=str(lr.get("content")),
                usage=llm_usage,
                model=lr.get("model"),
                finish_reason=lr.get("finish_reason"),
                tool_calls=tool_calls if tool_calls else None,
            )
            agent_step = AgentStep(step_number=sn, state=AgentStepState.COMPLETED, llm_response=llm_resp)
            lv_step = await lv.create_lakeview_step(agent_step)
            if lv_step:
                payload = {
                    "step_number": sn,
                    "task": lv_step.desc_task,
                    "details": lv_step.desc_details,
                    "tags": lv_step.tags_emoji,
                }
                if req.update_trajectory:
                    for s in data["agent_steps"]:
                        if int(s.get("step_number", 0)) == sn:
                            s["lakeview_summary"] = f"[{lv_step.tags_emoji}] {lv_step.desc_task} — {lv_step.desc_details}"
                            break
                yield "event: lakeview_step\n" + "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"
                await asyncio.sleep(0.05)
        if req.update_trajectory:
            try:
                with open(req.trajectory_file, "w") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                with contextlib.suppress(Exception):
                    TrajectoryRecorder.notify_ws_update(req.trajectory_file, data)
            except Exception:
                yield "event: error\n" + "data: Failed to update trajectory.\n\n"
        yield "event: end\n" + "data: done\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")




class CreateConfigRequest(BaseModel):
    name: str
    default_provider: Optional[str] = "openrouter"
    model: Optional[str] = "Qwen3-32B"
    base_url: Optional[str] = "http://host.docker.internal:9997/v1"
    api_key: Optional[str] = ""
    max_steps: Optional[int] = 50
    enable_lakeview: Optional[bool] = True
    max_tokens: Optional[int] = 4096
    temperature: Optional[float] = 0.5
    top_p: Optional[float] = 1.0
    top_k: Optional[int] = 0
    parallel_tool_calls: Optional[bool] = True
    max_retries: Optional[int] = 1


# Deprecated upload endpoint removed


@app.post("/config/create")
def create_config_file(req: CreateConfigRequest):
    base_dir = Path("/app/configs")
    base_dir.mkdir(parents=True, exist_ok=True)

    # sanitize name
    name = "".join([c for c in req.name if c.isalnum() or c in ["-", "_"]]) or uuid4().hex
    dest = base_dir / f"{name}.yaml"

    # build YAML
    cfg = {
        "model_providers": {
            req.default_provider or "openrouter": {
                "api_key": req.api_key or "",
                "provider": req.default_provider or "openrouter",
                "base_url": req.base_url,
                "api_version": None,
            }
        },
        "models": {
            "default_model": {
                "model": req.model or "Qwen3-32B",
                "model_provider": req.default_provider or "openrouter",
                "temperature": float(req.temperature or 0.5),
                "top_p": float(req.top_p or 1.0),
                "top_k": int(req.top_k or 0),
                "parallel_tool_calls": bool(req.parallel_tool_calls if req.parallel_tool_calls is not None else True),
                "max_retries": int(req.max_retries or 1),
                "max_tokens": int(req.max_tokens or 4096),
                "supports_tool_calling": True,
            }
        },
        "agents": {
            "trae_agent": {
                "max_steps": int(req.max_steps or 50),
                "model": "default_model",
                "tools": [
                    "bash",
                    "str_replace_based_edit_tool",
                    "sequentialthinking",
                    "task_done",
                ],
                "enable_lakeview": bool(req.enable_lakeview if req.enable_lakeview is not None else True),
            }
        },
        "lakeview": (
            {"model": "default_model"} if (req.enable_lakeview if req.enable_lakeview is not None else True) else None
        ),
        "allow_mcp_servers": [],
        "mcp_servers": {},
    }

    # remove None lakeview if disabled
    if cfg["lakeview"] is None:
        del cfg["lakeview"]

    import yaml

    dest.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")
    container_path = str(dest)
    return {"container_path": container_path, "url": f"file://{container_path}"}


@app.post("/agent/interactive/close")
def interactive_close(session_id: str = Query(...)):
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    del _sessions[session_id]
    return {"session_id": session_id, "closed": True}


class PromptRequest(BaseModel):
    name: str
    content: str
    enable_review: Optional[bool] = None
    review_rules: Optional[str] = None

class PromptQuery(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None

class ModelConfigRequest(BaseModel):
    name: str
    provider: str
    model: str
    base_url: str
    api_key: str
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    top_k: Optional[int] = None
    max_tokens: Optional[int] = None

class ModelConfigQuery(BaseModel):
    name: str

@app.post("/storage/prompt/write")
def write_prompt(req: PromptRequest):
    db = SessionLocal()
    try:
        obj = db.query(PromptModel).filter(PromptModel.name == req.name).first()
        if obj:
            obj.content = req.content
            if req.enable_review is not None:
                obj.enable_review = bool(req.enable_review)
            if req.review_rules is not None:
                obj.review_rules = req.review_rules
        else:
            obj = PromptModel(
                name=req.name,
                content=req.content,
                enable_review=bool(req.enable_review) if req.enable_review is not None else False,
                review_rules=req.review_rules,
            )
            db.add(obj)
        db.commit()
        db.refresh(obj)
        return {
            "id": obj.id,
            "name": obj.name,
            "content": obj.content,
            "enable_review": obj.enable_review,
            "review_rules": obj.review_rules,
        }
    finally:
        db.close()

@app.post("/storage/prompt/get")
def get_prompt_storage(req: PromptQuery):
    db = SessionLocal()
    try:
        obj = None
        if req.id is not None:
            obj = db.query(PromptModel).filter(PromptModel.id == int(req.id)).first()
        elif req.name is not None:
            obj = db.query(PromptModel).filter(PromptModel.name == req.name).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Prompt not found")
        return {
            "id": obj.id,
            "name": obj.name,
            "content": obj.content,
            "enable_review": obj.enable_review,
            "review_rules": obj.review_rules,
        }
    finally:
        db.close()

@app.get("/storage/prompt/list")
def list_prompts():
    db = SessionLocal()
    try:
        items = db.query(PromptModel).order_by(PromptModel.updated_at.desc()).all()
        return {
            "prompts": [
                {
                    "id": p.id,
                    "name": p.name,
                    "enable_review": p.enable_review,
                    "review_rules": p.review_rules,
                }
                for p in items
            ]
        }
    finally:
        db.close()

@app.post("/storage/model-config/write")
def write_model_config(req: ModelConfigRequest):
    db = SessionLocal()
    try:
        obj = db.query(ModelConfigStore).filter(ModelConfigStore.name == req.name).first()
        if obj:
            obj.provider = req.provider
            obj.model = req.model
            obj.base_url = req.base_url
            obj.api_key = req.api_key
            obj.temperature = str(req.temperature) if req.temperature is not None else obj.temperature
            obj.top_p = str(req.top_p) if req.top_p is not None else obj.top_p
            obj.top_k = str(req.top_k) if req.top_k is not None else obj.top_k
            obj.max_tokens = str(req.max_tokens) if req.max_tokens is not None else obj.max_tokens
        else:
            obj = ModelConfigStore(
                name=req.name,
                provider=req.provider,
                model=req.model,
                base_url=req.base_url,
                api_key=req.api_key,
                temperature=str(req.temperature) if req.temperature is not None else None,
                top_p=str(req.top_p) if req.top_p is not None else None,
                top_k=str(req.top_k) if req.top_k is not None else None,
                max_tokens=str(req.max_tokens) if req.max_tokens is not None else None,
            )
            db.add(obj)
        db.commit()
        db.refresh(obj)
        return {"id": obj.id, "name": obj.name}
    finally:
        db.close()

@app.post("/storage/model-config/get")
def get_model_config(req: ModelConfigQuery):
    db = SessionLocal()
    try:
        obj = db.query(ModelConfigStore).filter(ModelConfigStore.name == req.name).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Model config not found")
        return {
            "id": obj.id,
            "name": obj.name,
            "provider": obj.provider,
            "model": obj.model,
            "base_url": obj.base_url,
            "api_key": obj.api_key,
            "temperature": obj.temperature,
            "top_p": obj.top_p,
            "top_k": obj.top_k,
            "max_tokens": obj.max_tokens,
        }
    finally:
        db.close()


@app.get("/agent/interactive/status")
def interactive_status(session_id: str = Query(...)):
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    agent = _sessions[session_id]
    agent_config = agent.agent_config
    provider_cfg = agent_config.model.model_provider
    return {
        "provider": provider_cfg.provider,
        "model": agent_config.model.model,
        "max_steps": agent_config.max_steps,
        "tools": [t.name for t in agent.agent.tools],
        "working_dir": _session_working_dirs.get(session_id),
        "trajectory_file": agent.trajectory_file,
    }


def _read_file_impl(path: str, session_id: str | None = None, workspace: str | None = None):
    if not Path(path).is_absolute():
        raise HTTPException(status_code=400, detail="path must be absolute.")
    abs_path = os.path.abspath(path)
    wd: str | None = None
    if session_id:
        wd = _session_working_dirs.get(session_id)
        if not wd:
            raise HTTPException(status_code=404, detail="Session not found or working_dir unknown.")
    elif workspace:
        if not Path(workspace).is_absolute():
            raise HTTPException(status_code=400, detail="workspace must be absolute.")
        wd = os.path.abspath(workspace)
    # Map /workspace to host working_dir if known
    if wd:
        if abs_path.startswith("/workspace"):
            mapped = abs_path.replace("/workspace", os.path.abspath(wd), 1)
            abs_path = os.path.abspath(mapped)
        try:
            common = os.path.commonpath([abs_path, os.path.abspath(wd)])
        except Exception:
            common = ""
        if common != os.path.abspath(wd):
            raise HTTPException(status_code=403, detail="Access denied: path not under working_dir.")
        path = abs_path
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="File not found.") from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}") from e
    return {"path": path, "content": content}


@app.get("/files/read")
def read_file(
    path: str = Query(...),
    session_id: str | None = Query(None),
    workspace: str | None = Query(None),
):
    return _read_file_impl(path=path, session_id=session_id, workspace=workspace)


@app.get("/files/list")
def list_files(
    session_id: str | None = Query(None),
    relative_dir: str | None = Query(None),
    workspace: str | None = Query(None),
):
    wd: str | None = None
    if session_id:
        wd = _session_working_dirs.get(session_id)
        if not wd:
            raise HTTPException(status_code=404, detail="Session not found or working_dir unknown.")
    elif workspace:
        if not Path(workspace).is_absolute():
            raise HTTPException(status_code=400, detail="workspace must be absolute.")
        wd = os.path.abspath(workspace)
    else:
        raise HTTPException(status_code=400, detail="Missing session_id or workspace.")
    base = Path(wd)
    target = base / (relative_dir or "")
    try:
        target = target.resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid relative_dir: {e}") from e
    # Ensure target under working_dir
    if os.path.commonpath([str(target), str(base.resolve())]) != str(base.resolve()):
        raise HTTPException(status_code=403, detail="Access denied: directory not under working_dir.")
    if not target.exists() or not target.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found.")
    items = []
    try:
        for entry in target.iterdir():
            item = {
                "name": entry.name,
                "is_dir": entry.is_dir(),
                "host_path": str(entry.resolve()),
                "container_path": str(entry.resolve()).replace(str(base.resolve()), "/workspace"),
            }
            items.append(item)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list files: {e}") from e
    return {
        "directory": str(target),
        "container_directory": str(target).replace(str(base.resolve()), "/workspace"),
        "items": items,
        "count": len(items),
    }


# Alias to match frontend expectation
@app.get("/api/files")
def api_files(
    session_id: str | None = Query(None),
    relative_dir: str | None = Query(None),
    workspace: str | None = Query(None),
):
    return list_files(session_id=session_id, relative_dir=relative_dir, workspace=workspace)


@app.get("/api/file")
def api_file_read(
    workspace: str = Query(...),
    file: str = Query(...),
):
    if not Path(workspace).is_absolute():
        raise HTTPException(status_code=400, detail="workspace must be absolute.")
    fp = Path(file)
    if not fp.is_absolute():
        fp = Path(workspace) / fp
    return _read_file_impl(path=str(fp.resolve()), workspace=workspace)


class FileWriteRequest(BaseModel):
    file: str
    content: str


@app.post("/api/file")
def api_file_write(
    req: FileWriteRequest = Body(...),
):
    dest = Path(req.file)
    if not dest.is_absolute():
        raise HTTPException(status_code=400, detail="file must be absolute.")
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(str(dest.resolve()), "w", encoding="utf-8") as f:
            f.write(req.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {e}") from e
    return {"success": True}


@app.post("/api/agent/run")
async def api_agent_run(
    req: RunRequest = Body(...),
):
    return await run_agent(req=req, config_file_file=None)


class AgentCliRequest(BaseModel):
    workspace: str
    command: str


@app.post("/api/agent/cli")
def api_agent_cli(
    req: AgentCliRequest = Body(...),
):
    if not Path(req.workspace).is_absolute():
        raise HTTPException(status_code=400, detail="workspace must be absolute.")
    try:
        args = shlex.split(req.command)
        p = subprocess.Popen([
            "python",
            "-m",
            "trae_agent.cli",
            *args,
        ], cwd=str(Path(req.workspace).resolve()))
        return {"success": True, "pid": p.pid}
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"Failed to start CLI: {e}") from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CLI error: {e}") from e


@app.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    session_id: str | None = Query(None),
    relative_path: str | None = Query(None),
    workspace: str | None = Query(None),
):
    working_dir: str | None = None
    if session_id:
        working_dir = _session_working_dirs.get(session_id)
    if not working_dir and workspace:
        if not Path(workspace).is_absolute():
            raise HTTPException(status_code=400, detail="workspace must be absolute.")
        working_dir = os.path.abspath(workspace)
    if not working_dir:
        raise HTTPException(status_code=404, detail="Session not found or working_dir unknown.")
    if not working_dir:
        raise HTTPException(status_code=404, detail="Working directory not found.")

    if relative_path:
        rp = Path(relative_path)
        if rp.is_absolute():
            raise HTTPException(status_code=400, detail="relative_path must be relative.")
        dest = Path(working_dir) / rp
    else:
        dest = Path(working_dir) / "private" / (file.filename or "uploaded.bin")

    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create directories: {e}") from e

    abs_working = os.path.abspath(working_dir)
    abs_dest = os.path.abspath(str(dest))
    try:
        common = os.path.commonpath([abs_dest, abs_working])
    except Exception:
        common = ""
    if common != abs_working:
        raise HTTPException(status_code=403, detail="Access denied: destination not under working_dir.")

    try:
        content = await file.read()
        with open(abs_dest, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {e}") from e

    container_path = abs_dest.replace(abs_working, "/workspace")
    return {
        "path": abs_dest,
        "container_path": container_path,
        "filename": file.filename,
        "size": len(content) if content is not None else None,
    }

WEB_ROOT = Path("/app/static")
ASSETS_DIR = WEB_ROOT / "assets"
if WEB_ROOT.exists():
    if ASSETS_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")
    @app.get("/")
    def serve_index():
        idx = WEB_ROOT / "index.html"
        if idx.exists():
            return Response(idx.read_text(encoding="utf-8"), media_type="text/html")
        raise HTTPException(status_code=404, detail="index.html not found")

    @app.get("/vite.svg")
    def serve_vite_svg():
        f = WEB_ROOT / "vite.svg"
        if f.exists():
            return Response(f.read_text(encoding="utf-8"), media_type="image/svg+xml")
        raise HTTPException(status_code=404, detail="vite.svg not found")

@app.get("/openapi.yaml")
def serve_openapi_yaml():
    spec = app.openapi()
    text = yaml.safe_dump(spec, allow_unicode=True, sort_keys=False)
    return Response(text, media_type="application/yaml")
@app.get("/agent/test-model")
def test_model(
    provider: Optional[str] = Query(None),
    model_base_url: Optional[str] = Query(None),
    api_key: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
):
    if name:
        db = SessionLocal()
        try:
            mc = db.query(ModelConfigStore).filter(ModelConfigStore.name == name).first()
            if not mc:
                raise HTTPException(status_code=404, detail="Model config not found")
            provider = mc.provider
            model_base_url = mc.base_url
            api_key = mc.api_key
        finally:
            db.close()
    if not provider:
        raise HTTPException(status_code=400, detail="provider is required")
    prov = (provider or "").lower()
    try:
        if prov in ["openrouter", "openai"]:
            client = openai.OpenAI(api_key=str(api_key or ""), base_url=model_base_url)
            _ = client.models.list()
            return {"ok": True}
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connectivity failed: {e}") from e
class PromptDeleteRequest(BaseModel):
    name: str

@app.post("/storage/prompt/delete")
def delete_prompt(req: PromptDeleteRequest):
    db = SessionLocal()
    try:
        row = db.query(PromptModel).filter(PromptModel.name == req.name).first()
        if not row:
            return {"deleted": False}
        db.delete(row)
        db.commit()
        return {"deleted": True}
    finally:
        db.close()
# Online service base URL management
class OnlineBaseUrlSetRequest(BaseModel):
    base_url: str

def _get_online_base_url() -> str:
    try:
        with SessionLocal() as db:
            rec = db.execute(
                "SELECT value FROM public.settings WHERE name='online_base_url' LIMIT 1"
            ).fetchone()
            if rec and rec[0]:
                return str(rec[0])
            default = "http://10.0.2.34:7876"
            db.execute(
                "INSERT INTO public.settings(name, value) VALUES('online_base_url', :v) ON CONFLICT (name) DO UPDATE SET value=excluded.value",
                {"v": default},
            )
            db.commit()
            return default
    except Exception:
        return "http://10.0.2.34:7876"

@app.get("/online/base-url")
def get_online_base_url():
    return {"base_url": _get_online_base_url()}

@app.post("/online/base-url")
def set_online_base_url(req: OnlineBaseUrlSetRequest):
    try:
        with SessionLocal() as db:
            db.execute(
                "INSERT INTO public.settings(name, value) VALUES('online_base_url', :v) ON CONFLICT (name) DO UPDATE SET value=excluded.value",
                {"v": req.base_url},
            )
            db.commit()
        return {"base_url": req.base_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
