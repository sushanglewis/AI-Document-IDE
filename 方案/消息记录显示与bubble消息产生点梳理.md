# 消息记录显示逻辑与 Bubble WS 消息产生点梳理

## 概览
- 消息传递采用 WebSocket 事件流，主要事件类型：`start`、`step`、`bubble`、`completed`、`end`。
- 服务端在每个 Agent 步执行完成后，将“思考内容、反思、工具调用、task_done摘要/错误”等拆分为独立的 `bubble` 事件推送。
- 前端仅渲染 `bubble` 事件为对话气泡；`start` 和聚合型的 `step` 事件在 UI 层忽略，以避免覆盖用户消息或重复展示。

## 服务端事件产生点
- 事件流入口：`trae-agent/trae_agent/server/main.py:469`（`_ws_run`）。
  - 开始事件：`start`（包含 `trajectory_file`、`working_dir`、`tools`）`trae-agent/trae_agent/server/main.py:490`。
  - 步事件：`step`（包含本步所有聚合信息，供调试/追踪）`trae-agent/trae_agent/server/main.py:629`。
  - 完成事件：`completed`（包含 `final_result`、`success`、`agent_state` 等）`trae-agent/trae_agent/server/main.py:775`。
  - 结束事件：`end`（流式结束标记）`trae-agent/trae_agent/server/main.py:776`。

- Bubble 拆分与发送（均为 `type: "bubble"`）：
  - 思考内容（sequentialthinking）：`trae-agent/trae_agent/server/main.py:640-653`
    - 格式：`🧠 sequentialthinking <step>：<content> [✅]`
    - `id`：`seq-<step>`，`role`：`agent`
  - 反思（reflection）：`trae-agent/trae_agent/server/main.py:656-671`
    - 格式：`🧠 sequentialthinking <step>：<reflection> [✅]`
    - `id`：`seq-reflect-<step>`，`role`：`agent`
  - 工具调用（含结果标记）：`trae-agent/trae_agent/server/main.py:673-719`
    - 默认格式：`🔧<tool_name> <arguments_json> [✅/❌]`
    - CKG 特化：`🔧ckg <command>: <identifier>`（提炼关键信息）`trae-agent/trae_agent/server/main.py:689-703`
    - `id`：`tc-<step>-<call_id>`，`role`：`agent`
  - task_done 摘要/错误：`trae-agent/trae_agent/server/main.py:723-752`
    - 错误：`id=taskdone-<step>-error`，`role=error`，内容为错误文本
    - 成功摘要：`id=taskdone-<step>`，`role=agent`，内容为摘要（超长裁剪至 1200 字，尾部附 `<response clipped>`）

- 步负载结构（供参考）：在 `step` 事件的 `data` 中，包含：
  - `phase/state/error/reflection/lakeview_summary`
  - `llm_response`：`model`、`finish_reason`、`usage`、`content`、`content_excerpt`、`tool_calls`
  - `tool_calls` / `tool_results`：带有 `name/call_id/success/result/error/summary`
  - `message_units`：细粒度消息单元（`think`、`tool_call`、`tool_result`、`agent_output`）`trae-agent/trae_agent/server/main.py:602-615`

## 前端显示逻辑
- WebSocket 客户端：`ai-ide/src/lib/api.ts:338-379`（`runAgentStream`）与 `ai-ide/src/lib/api.ts:270-311`（`runInteractiveTaskStream`）。
  - `runInteractiveTaskWS` 是 `runInteractiveTaskStream` 的别名：`ai-ide/src/lib/api.ts:381-388`。

- 在对话发送后开启 WS 流并处理事件：`ai-ide/src/App.tsx:407-463`
  - 忽略 `start` 事件（避免盖过用户输入）：`ai-ide/src/App.tsx:432-435`
  - 处理 `bubble` 事件：构造对话消息并追加到当前会话 `messages`，`role` 为 `agent`/`error`，带 `bubbleId` 去重/标识：`ai-ide/src/App.tsx:436-451`
  - 忽略聚合 `step` 事件（避免覆盖细粒度气泡）：`ai-ide/src/App.tsx:453-456`
  - 处理 `completed` 事件：终止流式状态：`ai-ide/src/App.tsx:458-460`

- `messages` 数据结构（追加消息处）：`ai-ide/src/lib/store.ts:11` 定义了 `bubbleId?: string`，在 `App.tsx` 将 `bubble` 事件映射为对话消息并追加。

## Lakeview 更新与轨迹同步
- 当 `update_trajectory=true` 时，Lakeview 会将摘要写回轨迹文件并通过 TrajectoryRecorder 通知 WS 更新：
  - 写回：`trae-agent/trae_agent/server/main.py:1361-1367`
  - 通知：`TrajectoryRecorder.notify_ws_update(...)` `trae-agent/trae_agent/server/main.py:1365`

## 结束机制与前端联动
- 当本次会话出现成功的 `task_done` 工具结果，Agent 会立即结束并将摘要写入 `final_result`：`trae-agent/trae_agent/agent/base_agent.py:191-200`
- 服务端随后发送 `completed` 与 `end` 事件，前端结束流并保留此前收到的所有 `bubble` 消息作为最终记录：`trae-agent/trae_agent/server/main.py:775-776`。

## 参考与规范
- 事件类型与负载示例，详见：`trae-agent/trae_agent/server/main.py:529-601` 构造逻辑；以及“消息记录重构方案”已有说明：`方案/消息记录重构方案.md:22-65`。

