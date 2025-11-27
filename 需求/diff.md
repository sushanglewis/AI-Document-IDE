# 精准定位与差异编辑能力改造需求

## 背景与目标
- 现状：Agent 通过工具读取/写入本地或在线文档，编辑通常为全量替换；前端无法在编辑过程中渲染可视化差异；质量审查对全文进行审查，成本高。
- 目标：建立“定位 + 精准编辑 + 差异可视化 + 类型化审查 + 缓存保存”的闭环。
  - 前端加载文档后能基于行号/字符偏移进行精准定位；
  - Agent 根据定位信息执行读取/修改/替换/删除等精细操作；
  - 工具返回结构化 diff 与操作类型；
  - 质量审查仅针对变更范围与操作类型进行审查，附带定位信息建议；
  - 前端通过 WebSocket 收到编辑 diff 后直接渲染；所有操作先缓存在前端，用户点击保存才写入本地或在线。

## 端到端流程
- 会话启动：`/agent/interactive/start` 返回 `session_id`（`trae_agent/server/main.py:905-1045`）。
- 执行任务：前端调用 WebSocket `ws://.../ws/agent/interactive/task`（`trae_agent/server/main.py:1262-1522`）。
  - 服务端在每步通过 `WSConsole.update_status` 推送 `type: "step"` 消息（`trae_agent/server/main.py:1368-1491`）。
- 工具编辑：编辑工具以“干运行（dry-run）”模式返回结构化 diff 与定位，不落盘。
- 前端渲染：收到 `tool_results` 中的编辑 diff，直接在页面渲染红底删除、绿底新增。
- 保存：前端根据当前文档来源（本地/在线）调用不同保存接口执行真正写入。

## 前端改造
- 文档定位与渲染
  - 编辑器与预览统一支持定位模型：`{ start_line, start_col, end_line, end_col }` 与 `{ start_offset, end_offset }` 双轨。
  - 新增差异渲染组件，支持 inline diff（按字符/行）与 unified diff（按块）。
  - WebSocket 消息处理：当 `data.type === 'step'` 且 `data.data.tool_results` 含 `edit` 的 diff 负载，增量渲染差异，并将未保存状态打标。
  - 现有消息管线扩展：在 `ai-ide/src/App.tsx:426-593` 的 step 处理处，解析 `tool_results` 的 `result.diff` 与 `result.locator`，生成 UI 事件，更新 `currentSteps` 与文档视图。
- 本地/在线来源识别与保存
  - 本地：调用 `POST /api/file` 写入绝对路径（`ai-ide/src/lib/api.ts:241-248`）。
  - 在线：新增 `POST /online/docs/edit` 后端代理接口；前端在保存时根据文档携带的 `documentId` 调用该接口。
  - 保存前校验：要求前端缓存存在未保存的操作集合；点击保存时按来源批量提交。
- WebSocket 与代理
  - 开发环境新增 `/ws` 代理（已完成：`ai-ide/vite.config.ts:25-30`），确保 `ws://localhost:3002/ws/agent/interactive/task` 转发至后端。
- 文档段落块支持键入命令。用户可以在文档中选中一块段落，右键呼出菜单栏（markdown区域需屏蔽原生右键事件），并选择添加到消息，从而将选中的段落作为消息添加到聊天框，携带段落的定位信息。用户可以通过移除操作，在消息中去掉这个选中的段落。
## Agent 改造
- 精准编辑协议
  - Agent 在调用编辑工具时，支持传入定位信息：`locator = { start_line, start_col, end_line, end_col }` 或 `{ start_offset, end_offset }`。
  - 编辑工具返回的 `ToolExecResult.output` 改为结构化对象（JSON 字符串）包含：
    - `operation_type`: `init|outline|full|paragraph|modify|delete`
    - `locator`: 定位模型（行/列或偏移）
    - `diff`: 统一 diff 或 inline diff（建议 unified，附 hunk 列表）
    - `new_content_excerpt`: 新内容片段（可选，控制大小）
    - `dry_run`: `true` 表示仅预览；`false` 表示已落盘（默认工具走 `dry_run=true`）
  - Agent 在 `BaseAgent._tool_call_handler` 处将上述结构体透传到 WS（`trae_agent/agent/base_agent.py:373-490`）。
- 质量审查上下文增强
  - 现有质量审查调用在 `BaseAgent._tool_call_handler` 已传入 `file_text` 与 `edited_snippet`（`trae_agent/agent/base_agent.py:441-456`）。
  - 扩展传参：`operation_type`、`locator`、`diff`，使审查工具针对变更范围与类型执行审查。
- Git diff 兼容性
  - 现有 `get_git_diff` 仅适用于本地 Git 仓库（`trae_agent/agent/trae_agent.py:217-234`）。
  - 新增“文本级 diff”生成逻辑（工具层实现，见下），用于无 Git 的文档与在线内容。

## 工具改造
- 本地编辑工具（扩展现有 `str_replace_based_edit_tool`）
  - 新增 `mode` 参数：`preview|apply`。
  - `preview`：根据定位与候选新内容生成结构化 diff，返回 JSON，不写文件。
  - `apply`：在服务端确认后执行写入，并返回最终 diff 与写入结果。
- 在线文档工具（`trae_agent/tools/online_doc_tool.py`）
  - 新增命令：`edit_preview`，输入 `document_id` 与候选新内容，服务端生成结构化 diff（本地生成，不调用远端），返回 JSON。
  - 保留 `edit` 真写入；前端保存时调用后端代理接口。
- 差异计算
  - 引入文本 diff 库（后端）计算 unified/inline diff；对 Markdown/HTML 均按纯文本 diff。

## 后端接口改造
- WebSocket 消息载荷
  - 在 `WSConsole.update_status` 已包含 `tool_results`（`trae_agent/server/main.py:1440-1453`）。
  - 要求编辑工具在 `ToolExecResult.output` 返回结构化 JSON，服务端不做二次转换，直接下发到前端。
- 在线文档代理
  - 新增 `POST /online/docs/edit`，代理远端 `/ai/report/edit`（参考现有 `/online/docs/detail|create`：`trae_agent/server/main.py:276-307`）。
  - 已有 `GET/POST /online/base-url`（`trae_agent/server/main.py:2267-2282`）用于配置基准 URL。

## 消息与数据结构（建议）
- 编辑工具返回（示例 JSON 文本）：
  ```json
  {
    "operation_type": "modify",
    "locator": { "start_line": 12, "start_col": 1, "end_line": 20, "end_col": 1 },
    "diff": {
      "format": "unified",
      "hunks": [
        { "header": "@@ -12,9 +12,11 @@", "removed": ["- old"], "added": ["+ new"], "context": ["..."] }
      ]
    },
    "new_content_excerpt": "...",
    "dry_run": true
  }
  ```
- 质量审查工具输入扩展：`file_path|document_id`、`operation_type`、`locator`、`diff`、`edited_snippet|new_content_excerpt`、`quality_review_rules`。
- 前端渲染事件：`{ type: 'edit_diff', operation_type, locator, diff, source: 'local|online', document_id?, file_path? }`。

## 质量审查改造
- 审查策略按操作类型：
  - 初始化文档/生成大纲/生成全文：结构/完整性/格式；
  - 生成段落/修改段落/删除段落：语义连贯性/上下文一致性/引用有效性；
- 审查范围：仅限于 `locator` 指定片段；必要时抽样上下文。
- 输出带定位的修改建议：`{ locator, suggestion_type, suggestion_text }`。

## 保存机制
- 前端缓存所有操作；文档状态包含 `isDirty`。
- 保存按钮判定：
  - 本地：调用 `/api/file` 写入；
  - 在线：调用新增 `/online/docs/edit` 写入；
  - 成功后清空缓存，更新文档内容与版本信息。

## 兼容性与迁移
- 继续支持现有全量替换流程；新增精准编辑为优先路径。
- 无 Git 环境下使用文本 diff；有 Git 时可选结合 `get_git_diff` 进行最终校验。

## 验证计划
- 单元测试：定位解析、diff 生成与合并、质量审查分类。
- 集成测试：WS step 消息包含编辑 diff；前端正确渲染与保存。
- 回归测试：保留现有 SSE/WS 流与整体执行闭环。

## 里程碑
- M1：定义数据结构与接口，前端渲染 diff；
- M2：本地工具 `preview|apply` 与在线 `edit_preview|edit`；
- M3：质量审查按类型与定位输出建议；
- M4：完整闭环与测试覆盖。

