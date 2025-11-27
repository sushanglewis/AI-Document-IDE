# 工具调用 Bubble 消息方案

目标：当以下 9 个工具被调用并产生结果时，统一生成可读、简洁的 Bubble（前端 toast），确保用户能够快速感知工具执行状态与关键信息。

覆盖工具：`bash_tool`、`json_edit_tool`、`quality_review_tool`、`mcp_tool`、`edit_tool`、`edit_tool_cli`、`json_edit_tool_cli`、`docker_tool_executor`、`online_doc_tool`

---

## 通用规则
- 触发时机：每个 Agent 步的 `tool_calls` 到达时即时发送；若有对应 `tool_results`，合并成功/失败标记。
- 消息结构：
  - `type`: `bubble`
  - `data.id`: `tc-{step_number}-{call_id}`
  - `data.role`: `agent`
  - `data.content`: 人类可读的摘要内容
  - `data.timestamp`: ISO 时间
  - `data.call_id`: 与工具调用一致
- 成功/失败标记：当存在对应 `tool_results` 时，在 `content` 末尾追加 `✅`（成功）或 `❌`（失败）。
- 参数展示：`arguments` 默认序列化为 JSON（`ensure_ascii=False`）。对部分工具进行语义化提炼（见下文）。
- 截断策略：避免超长内容充斥 Bubble，只展示关键摘要；必要时以 `…`/`<response clipped>` 标识。

---

## 各工具消息定义

### 1）bash_tool
- 触发：执行命令（`arguments.command`）。
- 内容：`🔧bash {"command":"<cmd>"}`，合并结果标记。
- 取值来源：`arguments.command`；`tool_results.success`。
- 示例：`🔧bash {"command":"ls -l /workspace"} ✅`

### 2）json_edit_tool
- 触发：JSONPath 修改（add/remove/update）。
- 内容：`🔧json_edit_tool {"path":"<file>","json_path":"<$.expr>","op":"<add|remove|update>"}`，合并结果标记。
- 取值来源：工具入参；结果 `success` 与错误信息由后续详情面板展示。
- 示例：`🔧json_edit_tool {"path":"/repo/trae.yaml","json_path":"$.agents.trae_agent.tools[0]","op":"add"} ✅`

### 3）quality_review_tool
- 触发：质量审查（启用开关后执行）。
- 内容：`🔧quality_review {"rules":"<brief>","target":"<file|repo>"}`，合并结果标记。
- 取值来源：审查规则与目标由调用参数；审查结论详见运行日志面板。
- 示例：`🔧quality_review {"target":"/workspace","rules":"required README"} ❌`

### 4）mcp_tool
- 触发：远程 MCP 工具调用。
- 内容：`🔧mcp_tool {"name":"<tool_name>","args":{…}}`，合并结果标记。
- 取值来源：`MCPTool.get_name()` 与入参；成功返回文本由详情展示。
- 示例：`🔧mcp_tool {"name":"search","args":{"q":"docker compose"}} ✅`

### 5）edit_tool
- 触发：文件视图/插入/替换/创建等编辑操作。
- 内容：`🔧edit_tool {"command":"<view|insert|replace|create>","path":"<abs>"}`，可能补充关键参数（如 `insert_line`）。合并结果标记。
- 取值来源：工具入参；成功提示文本在结果中保留。
- 示例：`🔧edit_tool {"command":"insert","path":"/repo/app.py","insert_line":42} ✅`

### 6）edit_tool_cli
- 触发：同 `edit_tool` 的 CLI 版本。
- 内容：`🔧edit_tool_cli {"command":"<view|insert|replace|create>","path":"<abs>"}`，合并结果标记。
- 示例：`🔧edit_tool_cli {"command":"view","path":"/repo/app.py","view_range":[1,50]} ✅`

### 7）json_edit_tool_cli
- 触发：JSON 编辑 CLI 版本（remove/add 等）。
- 内容：`🔧json_edit_tool_cli {"path":"<file>","json_path":"<$.expr>","op":"<remove|add>"}`，合并结果标记。
- 示例：`🔧json_edit_tool_cli {"path":"/repo/trae.json","json_path":"$.agents.trae_agent.tools[2]","op":"remove"} ✅`

### 8）docker_tool_executor
- 触发：将工具路由到容器环境执行（非用户直接调用，但对可视化有价值）。
- 内容：`🔧docker_tool_executor {"workspace":"/workspace","routed":true}`，合并结果标记（若有）。
- 取值来源：`working_dir`/容器映射信息。
- 示例：`🔧docker_tool_executor {"workspace":"/workspace","routed":true} ✅`

### 9）online_doc_tool
- 触发：在线文档的创建/详情/编辑。
- 语义化规则：
  - `create`：`🔧online_doc_tool create: <title>`
  - `detail`：`🔧online_doc_tool detail: <documentId>`
  - `edit`：`🔧online_doc_tool edit: <documentId>`（若修改标题，追加 ` title=<new>`）
- 合并结果标记：按 `tool_results.success`。
- 长内容：详情返回的 HTML 内容由工具内部裁剪（`maybe_truncate`），Bubble 仅出摘要行。
- 示例：
  - `🔧online_doc_tool create: 项目周报 ✅`
  - `🔧online_doc_tool detail: 123456 ✅`
  - `🔧online_doc_tool edit: 123456 title=新标题 ✅`

---

## 辅助约定
- 参数裁剪：对超长 JSON 参数仅保留关键键（例如 `command`、`path`、`json_path`、`document_id` 等）。
- 安全过滤：不展示敏感信息（密钥、Cookie、凭证）。
- 一致风格：所有工具均以 `🔧<tool_name> …` 开头；结尾成功/失败标识统一。
- 任务完成：`task_done` 的成功摘要另起一条 Bubble（已在服务端实现），错误则以 `role=error` 发送。

---

## 与服务端实现的对齐
- 发送点：服务端在 `ai-ide` WebSocket 会话中遍历 `tool_calls` 并拼接结果（`main.py:673–719`）。
- 已有特例：`ckg` 的 `command/identifier` 会进行语义化（`main.py:689–703`）。本方案对 `online_doc_tool` 建议同样的语义化（标题/文档 ID 优先展示）。
- 任务完成 Bubble：`task_done` 成功与错误均有独立 Bubble（`main.py:723–751`）。

---

## 前端展示建议
- 单行摘要：避免换行；必要时在详情面板展示完整输出。
- 点击展开：为每条 Bubble 提供“查看详情”交互，定位到对应 `step` 的详细 `tool_results`。
- 颜色与图标：成功绿色、失败红色，统一使用 `🔧` 前缀，`🧠` 用于思考/反思（已实现）。

