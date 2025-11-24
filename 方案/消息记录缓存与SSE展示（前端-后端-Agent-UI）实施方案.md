# 消息记录缓存与SSE展示（前端-后端-Agent-UI）实施方案

## 目标
- 进入页面后自动创建一个交互会话（session），无重复提示。
- 将消息及步骤信息通过浏览器缓存进行持久化存储，支持刷新后仍可查看完整记录。
- 优化消息记录可视化：明确展示用户需求、SSE步骤信息、工具调用与结果，并为用户与助手信息生成哈希UUID避免冲突。

---

## 数据与缓存设计
- 前端持久化：采用 `zustand` 的 `persist`（现已使用）将 `sessions`、`messages`、`currentSessionId`、`fileTree` 等关键状态持久化至 `localStorage`。
  - 参考：`ai-ide/src/lib/store.ts:81` 中 `persist(devtools(create(...)))` 已存在，可拓展 `messages` 结构持久化。
- 消息结构（示例）：
  - `id`: 哈希UUID（基于内容+时间戳），避免冲突
  - `type`: `user` | `agent` | `system` | `error`
  - `content`: 文本正文（用户需求只保留“需求+引用文件名”）
  - `attachments`: 文件定位信息（workspace/online）的简述，便于Agent定位
  - `sse_step`: 结构化步骤信息（见下）
  - `timestamp`: ISO字符串
- SSE步骤结构：
  - `step_number`: number
  - `error`: string | null
  - `reflection`: string | null
  - `lakeview_summary`: string | null
  - `content`: string | null（模型内容摘录或完整）
  - `tool_calls`: 数组，元素包含 `{name: string, icon: string}`，映射规则见下
  - `tool_results`: 数组，元素包含 `{success: boolean, result?: string, error?: string}`

---

## 哈希UUID生成
- 需求：为用户信息与助手信息生成稳定的哈希UUID，避免名称或并发带来的冲突。
- 前端实现：提供 `makeHashedId(input: string) -> string`，对 `input`（如 `user:userId` / `agent:modelName` / `message:content+timestamp`）进行哈希（例如 `SHA-256` 或简化的 `murmurhash`），取前 16-24 位作为短UUID。
- 集成位置：
  - 新建消息时（`ai-ide/src/App.tsx` 的消息追加与SSE事件处理处），为 `id`、`user_id`、`agent_id` 使用哈希函数生成。

---

## 工具图标映射规则
- 映射目标：将工具调用 `tool_calls.name` 映射到统一的类别与图标，便于阅读。
- 建议映射表（可在前端常量中定义）：
  - `sequentialthinking` → `THINK` → `🧠`
  - `outlier_detection` / `anomaly_check` → `OUTLIER` → `❓`
  - `str_replace_based_edit_tool` / `text_editor` → `WRITE_FIX` → `📝`
  - `report_generator` / `summary` → `REPORT` → `📣`
  - 若无命中规则，则以 `name.toUpperCase()` + `🔧` 默认图标。

---

## 前端实现计划
1) 默认创建会话 & 去重吐司
- 现状：页面初始化时执行 `initializeApp()` 会创建会话；命令输入 `-create session` 也会触发创建并吐司，造成重复提示。
  - 参考：`ai-ide/src/App.tsx:94-162`（初始化）、`ai-ide/src/App.tsx:319-339`（命令处理）
- 改法：
  - 将 `createNewSession()` 内部的提示移交给调用者；初始化路径只在首次无会话时创建且不重复吐司。
  - 命令路径保留一次吐司，判断当前是否已有活动会话，避免重复。

2) 消息记录缓存
- 在 `useAppStore` 增加 `messages` 的持久化存储；`updateSession` 时将新消息拼接并持久化。
- 在 `runInteractiveTaskStream`（`ai-ide/src/lib/api.ts:260-330`）的流式处理回调中，构造 `sse_step` 结构并写入消息。

3) 用户需求与文件引用的采集
- 当用户提交命令或需求时（顶栏下方新输入栏），将文本与拖拽的文件生成 `attachments`：
  - workspace：`[workspace:/workspace/<relative>]`
  - online：`[online:documentId=<id> path=/Online/<id>.md]`
- 用户需求消息仅保留自然语言需求与引用文件名（不含冗余系统信息），前端生成一条 `type=user` 的消息。

4) SSE步骤渲染与持久化
- 在 `App.tsx` 的流式处理中，将事件解析为统一的 `sse_step`，并根据映射表赋予 `tool_calls.icon`。
- 将 `error/reflection/lakeview_summary/content` 均作为可选字段渲染；渲染时若为null则隐藏。

5) 顶栏命令输入控件（Cmd+Shift+K）
- 已移植至顶栏下方 80px 输入栏（参考现有改动），支持拖拽生成 `attachments`。
- 合并 `attachments.token` 与命令文本后提交；提交后清理输入栏与附件列表。

---

## 后端实现计划（API/SSE）
- 接口保持不变：
  - 健康：`GET /health`（`trae-agent/trae_agent/server/main.py:150-158`）
  - 在线文档列表：`POST /online/docs/search`
  - 在线文档详情：`POST /online/docs/detail`（已修复参数键名，`main.py:274-281`）
- SSE事件载荷增强（如需在后端侧直接组织）：
  - 增加 `step_number`、`reflection`、`lakeview_summary`、`tool_calls` 与 `tool_results` 字段；确保与前端消费结构一致。
  - 若当前后端已输出相关信息（见 `App.tsx` 中对 `llm_response`, `tool_calls` 的解析），则前端统一聚合后持久化，无需强制后端改造。

---

## Agent端实现计划
- 在 TrajectoryRecorder 中确保每步包含：思考内容、工具调用、工具结果、反思与汇总（lakeview）。
- 若需要补充 `lakeview_summary`，可在结束时将 `Lakeview` 信息追加到最终步骤或单独事件：
  - 参考：`ai-ide/src/App.tsx:629-647`、`801-829` 对 `Lakeview` 的处理。
- 工具名统一化：在 agent 层或前端映射表进行归类即可，不强制改动工具注册。

---

## 消息记录
- [用户需求]（仅自然语言+引用文件名）
  - “请审阅 docs/guide.md 并生成摘要。”
  - 附：`[workspace:/workspace/docs/guide.md]`

- [step_number 1]
  - THINK 🧠, WRITE_FIX 📝
  - content: “正在分析文档结构...”
  - tool-results: 成功 ✅（result: “替换成功：...）”

- [step_number 2]
  - OUTLIER ❓
  - error: “检测到不一致的标题层级”

- [step_number 3]
  - REPORT 📣
  - lakeview_summary: “已完成分析与修复，总结如下...”

注：用户/助手/系统消息均以哈希UUID标识，避免名称冲突。



## 验收标准
- 首次进入页面自动创建会话且无重复吐司提示。
- 刷新页面仍可查看消息记录与SSE步骤。
- 用户需求消息仅包含需求文本与引用文件名；SSE步骤显示完整结构化信息。
- 工具调用与结果以图标与文字呈现，信息清晰。
- 用户与助手消息使用哈希UUID标识，无冲突。

