# 上下文指导注入（Contextual Instruction Injection）产品方案

## 目标
- 允许用户提供 `custom_instructions`，在 Agent 初始 `user_message` 的 `Special instructions` 段落中拼接，指导后续工具与LLM行为。

## 前端方案
- 交互与表单
  - 在“系统设置”对话框新增“自定义业务规则（Custom Instructions）”多行文本域。
  - 可保存为会话级覆盖配置；支持清空与重置为默认。
- 功能改造
  - 会话创建携带 `agent_mode_config.custom_instructions`；任务执行（`/agent/interactive/task`）也携带，便于运行时切换。
  - 位置：复用系统设置面板（`ai-ide/src/App.tsx:1174-1195`），新增一项并在“确认”时写入会话对象。
  - 渲染：SSE消息气泡保持简洁，不单独显示该字段，仅作为Agent决策依据。
- 数据传递
  - `api.ts` 扩展类型：在 `AgentModeConfig` 增加 `custom_instructions?: string`（`ai-ide/src/lib/api.ts:1-136` 附近）。

## 后端方案
- 接口改造
  - 扩展 `POST /agent/interactive/start` 与 `/agent/interactive/task`，支持 `agent_mode_config.custom_instructions`。
  - 在会话上下文中持久化（可选），用于工具层拦截与反思环节直接读取。
- 数据库结构
  - 新增表 `agent_mode_overrides`：
    - 字段：`id SERIAL PK`、`session_id TEXT`、`custom_instructions TEXT`、`created_at TIMESTAMP`
  - 可选：`agent_modes` 预置模式表已在动态模式配置中定义。
- OpenAPI
  - 更新 `AgentModeConfig` schema，增加 `custom_instructions` 字段；Apifox导入保持一致（参考 `trae-agent/openapi/apifox-trae-agent.yaml:1-30`）。

## Agent端方案
- 注入位置与方式
  - 在 `TraeAgent.new_task()` 构建初始 `user_message` 时拼接一段：
    - 参考构建逻辑：`trae-agent/trae_agent/agent/trae_agent.py:130-152`；在 `[Problem statement]` 之后追加：
      - `[Special instructions]: \n{custom_instructions}\n`
  - 确保 Docker/本地路径提示（`[Project root path]`）仍位于开头（`trae-agent/trae_agent/agent/trae_agent.py:139-144`）。
- 作用范围
  - 仅影响当前会话与后续任务；不影响默认 Prompt 的全局定义。

## 阶段计划
- 阶段二：设计
  - 明确 `custom_instructions` 在消息中的拼接格式与前端表单校验（长度限制、敏感词过滤）。
- 阶段二：开发
  - 前端：系统设置新增文本域，类型扩展与请求携带；会话对象存储。
  - 后端：请求解析与会话上下文保存；OpenAPI更新。
  - Agent：`new_task` 拼接逻辑实现与单元测试覆盖。
- 阶段二：测试
  - 单元：拼接内容正确性与顺序稳定性；空值/超长处理；Docker/本地路径提示不受影响。
  - 集成：注入不同指令后，Agent行为差异与工具选择变化验证。
- 阶段二：验收
  - Demo：在“代码专家”模式下注入“禁止使用Bash创建文件”，验证工具选择与行为变化。