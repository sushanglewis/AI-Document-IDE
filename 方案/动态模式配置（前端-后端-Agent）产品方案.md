# 动态模式配置（Dynamic Mode Configuration）产品方案

## 目标
- 支持用户在前端选择运行模式（如 `doc_writer`、`code_expert`），后端与 Agent 端按模式加载对应系统提示词（System Prompt），实现行为的实时切换。
现在已包含两种模式：
- ‘文档助理模式’，prompt：/Users/stylesu/Documents/Heils/Agent/trae-agent/trae_agent/prompt/agent_prompt.py 中的 TRAE_AGENT_SYSTEM 下的参数
- ‘代码专家模式’，prompt：/Users/stylesu/Documents/Heils/Agent/trae-agent/trae_agent/prompt/agent_prompt.py 中的 DOCUMENT_AGENT_SYSTEM_PROMPT 下的参数

## 前端方案
- 交互与表单
  - 在“系统设置”对话框中新增“模式选择”和“系统提示词”两项：
    - 模式选择：下拉框（`mode_name`），提供内置选项与自定义模式名输入。初始化选项：代码专家、文档助理
    - 系统提示词：文本域（`system_prompt`），支持覆盖默认 Prompt。
  - 会话启动时，将 `AgentModeConfig` 作为参数传入。
- 功能改造
  - 会话创建：`ai-ide/src/App.tsx:1024-1033` 的“新建会话”按钮逻辑扩展，将 `agent_mode_config` 随请求一起传递。
  - UI位置与引用：系统设置面板已存在（`ai-ide/src/App.tsx:1174-1195`），系统提示词选项修改为‘模式选择’，模式需要实现增、删、改、查功能。
  - 命令输入窗口不变化（`cmd+shift+K`），模式配置与系统提示词在会话维度保持。
- 数据传递
  - `api.ts` 扩展 `InteractiveStartRequest`/`InteractiveTaskRequest`，新增 `agent_mode_config?: { mode_name: string; system_prompt?: string }`（参考现有类型结构 `ai-ide/src/lib/api.ts:1-136`）。

## 后端方案
- 接口改造
  - `POST /agent/interactive/start`/`/agent/interactive/task` 请求体新增 `agent_mode_config` 字段。
  - 在会话启动逻辑处优先使用 `agent_mode_config.system_prompt`：
    - 参考：`trae-agent/trae_agent/server/main.py:303-339`，目前通过 `agent.agent.set_system_prompt(req.prompt)`；改为先检查 `req.agent_mode_config.system_prompt`，存在则使用。
- 数据库结构
  - 新增表 `agent_modes`（保存内置或自定义模式）：
    - 字段：`id SERIAL PK`、`mode_name TEXT UNIQUE`、`system_prompt TEXT`、`created_at TIMESTAMP`
- OpenAPI
  - 在 `openapi/apifox-trae-agent.yaml` 增加 `AgentModeConfig` schema，并在上述两个接口的 `requestBody` 中引用（参考文件 `trae-agent/openapi/apifox-trae-agent.yaml:1-30, 411-469`）。

## Agent端方案
- 动态 Prompt 应用
  - `trae_agent/agent/trae_agent.py:180-195` 已支持 `set_system_prompt` 与默认 Prompt 切换。
  - 在会话启动时，若传入 `agent_mode_config.system_prompt`，调用 `TraeAgent.set_system_prompt()` 覆盖默认。
- 内置模式与默认 Prompt
  - 默认 Prompt 位于：`trae-agent/trae_agent/prompt/agent_prompt.py:4-53`（工程Prompt）与 `55-101`（文档Prompt），可通过约定值 `TRAE_AGENT_SYSTEM_PROMPT` 与 `DOCUMENT_AGENT_SYSTEM_PROMPT` 切换。

## 风险与规避方案：
- 优先级冲突：同会话存在 prompt 与 agent_mode_config.system_prompt 时需统一解析顺序，避免提示词重复覆盖引发行为不稳定（建议在后端入口处一次性解析并记入会话上下文）。
- 数据一致性：新增 agent_modes 表需迁移与唯一约束，推荐直接存 system_prompt 文本，降低与 prompts 的耦合。
- 安全性：开放自定义 Prompt 时需配合工具白名单与执行边界，当前工具注册与 Lakeview 摘要机制对风险有初步约束。
- 前端持久化：需在会话维度持久化模式与提示词，扩展 sessions[i].metadata （参考 ai-ide/src/lib/store.ts:167-175 的持久化策略）。

## 变更落实（本次实现）
- UI 图层冲突修复：对话消息记录作为顶层覆盖层渲染，采用 `fixed inset-0 z-[60] pointer-events-none`，仅覆盖层内部可交互（`pointer-events-auto`），不影响下层编辑/预览容器（`ai-ide/src/App.tsx:1179-1191`）。
- 后端支持 `agent_mode_config`：
  - 新增 `AgentModeConfig` 模型并在 `InteractiveStartRequest`/`InteractiveTaskRequest` 中引入（`trae-agent/trae_agent/server/main.py:54-72, 74-83`）。
  - 解析优先级：`agent_mode_config.system_prompt` > `prompt` > 默认；支持枚举名自动映射到内置 Prompt（`trae-agent/trae_agent/server/main.py:689-697, 768-775, 829` 及相关入口统一处理）。
- OpenAPI 更新：
  - 在 `apifox-trae-agent.yaml` 与 `trae-agent.yaml` 增加 `AgentModeConfig` schema，并在交互式接口的 `requestBody` 中引用（`trae-agent/openapi/apifox-trae-agent.yaml:540-606`、`trae-agent/openapi/trae-agent.yaml:142-193`）。
- 前端类型扩展：在 `InteractiveStartRequest`/`InteractiveTaskRequest` 增加 `agent_mode_config` 可选字段，兼容现有调用（`ai-ide/src/lib/api.ts:49-66, 68-76`）。