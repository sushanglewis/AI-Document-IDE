const apiBase = "http://localhost:8090";

let session = {
  id: null,
  workingDir: null,
  trajectoryFile: null,
};

let sse = null;
let editorInstance = null;
let workspaceMode = null; // when set, use workspace-only flow without session

function log(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  document.getElementById("chat-history").appendChild(el);
  document.getElementById("chat-history").scrollTop = document.getElementById("chat-history").scrollHeight;
}

function renderFileList(items) {
  const list = document.getElementById("file-list");
  list.innerHTML = "";
  items.forEach((it) => {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = `${it.is_dir ? "📁" : "📄"} ${it.name}`;
    div.onclick = () => {
      if (it.is_dir) {
        let rel;
        if (workspaceMode) {
          rel = it.container_path.replace(workspaceMode, "");
        } else {
          rel = it.container_path.replace("/workspace", "").replace(session.workingDir.replace("/workspace", ""), "");
        }
        loadFiles(rel);
      } else {
        loadFileContent(it.container_path);
      }
    };
    list.appendChild(div);
  });
}

async function loadFiles(relativeDir) {
  const params = new URLSearchParams();
  if (workspaceMode) {
    params.set("workspace", workspaceMode);
  } else {
    if (!session.id) return;
    params.set("session_id", session.id);
  }
  if (relativeDir) params.set("relative_dir", relativeDir);
  const res = await fetch(`${apiBase}/api/files?${params.toString()}`);
  const data = await res.json();
  renderFileList(data.items || []);
}

async function loadFileContent(containerPath) {
  const params = new URLSearchParams({ path: containerPath });
  if (workspaceMode) {
    params.set("workspace", workspaceMode);
  } else {
    params.set("session_id", session.id);
  }
  const res = await fetch(`${apiBase}/files/read?${params.toString()}`);
  const data = await res.json();
  const content = data.content || "";
  if (!editorInstance) {
    editorInstance = editormd("editor", { width: "100%", height: 900, markdown: content, path: "https://pandao.github.io/editor.md/lib/" });
  } else {
    editorInstance.setMarkdown(content);
  }
}

async function startSession() {
  const body = {
    config_file: "file:///app/trae_config.yaml",
    working_dir: "/workspace/project",
    provider: "openrouter",
    model: "Qwen3-32B",
    max_steps: 100,
    console_type: "rich",
  };
  const res = await fetch(`${apiBase}/agent/interactive/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  session.id = data.session_id;
  session.trajectoryFile = data.trajectory_file;
  session.workingDir = data.working_dir.replace(/^[^\/]*\//, "/workspace/");
  await loadFiles("");
  log(`会话启动：${session.id}`);
}

function connectSSE(userText) {
  const req = {
    session_id: session.id,
    task: userText,
    working_dir: session.workingDir,
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify(req)));
      controller.close();
    },
  });
  const sseUrl = `${apiBase}/agent/interactive/task/stream`;
  fetch(sseUrl, { method: "POST", body: stream, headers: { "Content-Type": "application/json" } })
    .then((resp) => {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      document.getElementById("send-btn").disabled = true;
      function read() {
        reader.read().then(({ done, value }) => {
          if (done) {
            document.getElementById("send-btn").disabled = false;
            log("会话流结束");
            return;
          }
          const chunk = decoder.decode(value);
          chunk.split("\n\n").forEach((evt) => {
            const lines = evt.split("\n");
            if (lines[0] && lines[0].startsWith("event:")) {
              const eventName = lines[0].slice(6).trim();
              if (lines[1] && lines[1].startsWith("data:")) {
                const dataStr = lines[1].slice(5).trim();
                try {
                  const payload = JSON.parse(dataStr);
                  if (eventName === "step") {
                    log(`[Step ${payload.step_number}] ${payload.llm_response?.content_excerpt ?? "..."}`);
                  } else if (eventName === "completed") {
                    log(`完成：success=${payload.success} steps=${payload.steps_count}`);
                  } else if (eventName === "error") {
                    log(`错误：${payload.message}`);
                  }
                } catch {}
              }
            }
          });
          read();
        });
      }
      read();
    })
    .catch((err) => log(`SSE 连接失败：${err}`));
}

document.getElementById("start-btn").onclick = startSession;

document.getElementById("chat-form").onsubmit = (e) => {
  e.preventDefault();
  if (!session.id) return;
  const text = document.getElementById("user-input").value.trim();
  if (!text) return;
  log(`用户：${text}`);
  connectSSE(text);
};

document.getElementById("workspace-load").onclick = async () => {
  const input = document.getElementById("workspace-input").value.trim() || "/workspace/project";
  workspaceMode = input;
  await loadFiles("");
};