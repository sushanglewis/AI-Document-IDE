# 配置驱动（Configuration-Driven）Trae Agent 产品方案

## 背景与目标
- 背景：当前 Trae Agent 的 Prompt 与行为逻辑较为固化，难以适配不同垂直场景（如纯代码开发、文档撰写）。
- 目标：以统一的 `AgentModeConfig` 配置对象驱动 Agent 行为，实现前端可动态切换模式、注入自定义指令，并在需要时启用“质量审查-反思”闭环。

## 总体架构
- 核心对象：`AgentModeConfig` 在前端形成→后端透传与存储→Agent 读取并应用→工具与反思闭环按需生效。
- 数据流：
  - 前端选择模式/填入指令与审查规则→`/agent/interactive/start` 携带 `agent_mode_config`→后端启动会话并记录→Agent 初始化时应用 `system_prompt` 与 `custom_instructions`→在文本编辑工具执行后触发质量审查→审查结果进入 `reflect_on_result` 驱动自动修正。

---

## 配置对象：AgentModeConfig
- 结构定义（JSON Schema 概念）：
  - `mode_name: string` 模式标识，如 `doc_writer`、`code_expert`。
  - `system_prompt: string` 模式专属系统提示词（覆盖默认）。
  - `custom_instructions: string` 用户自定义业务规则（自然语言）。
  - `enable_quality_review: boolean` 是否开启质量审查。
  - `quality_review_rules: string` 审查标准（供审查工具的 LLM 使用）。
  - 可扩展：`tool_whitelist?: string[]`、`reflection_max_rounds?: number`、`review_model_config_name?: string` 等。

---

## 前端方案
- 配置与会话
  - 会话启动面板增加“模式选择”“自定义指令”“质量审查开关与规则输入”。
  - 将 `AgentModeConfig` 随 `startInteractiveSession` 请求一并发送，并保存在当前会话对象中（便于后续任务传参）。
- 交互与快捷键
  - 使用已有的命令输入弹窗（`Ctrl+K`）提交任务；模式与指令在会话维度保持。
- 消息与SSE
  - 维持现有 Lakeview/Agent SSE 渲染；工具调用与审查反馈以简洁气泡形式拼接展示（当前已简化为单层气泡）。
- OpenAPI 集成
  - 前端基于后端 OpenAPI（Apifox 导入）自动生成/更新类型，确保 `AgentModeConfig` 与 `InteractiveTaskRequest` 的新增字段映射正确。

---

## 后端方案
- 请求模型扩展
  - 在 `InteractiveStartRequest`/`InteractiveTaskRequest` 增加 `agent_mode_config?: AgentModeConfig`。
  - 将 `system_prompt` 与 `custom_instructions` 在会话启动时落库（或仅内存存储，按需选择）。
- 应用入口与透传
  - `trae_agent/server/main.py:303` 处已调用 `agent.agent.set_system_prompt(req.prompt)`；改为优先使用 `req.agent_mode_config.system_prompt`（存在则覆盖）。
  - 将 `custom_instructions` 与审查开关在会话上下文保存（供工具层与 Agent 的 `reflect_on_result` 使用）。
- 存储与接口
  - PostgreSQL 表（示例）：`agent_modes(id, mode_name, system_prompt, created_at)`、`agent_mode_overrides(session_id, custom_instructions, enable_quality_review, quality_review_rules, created_at)`。
  - 接口：`POST /agent/modes`（创建与保存预设）、`GET /agent/modes`（列表）、`GET /agent/modes/{name}`（详情）、会话接口支持 `agent_mode_config`。
- 质量审查工具
  - 新增 `QualityReviewTool`（具备 LLM 能力）：输入为 `{ file_text?, content?, new_str?, file_path?, rules }`，输出 `{ pass: boolean, reasons: string[], suggestions?: string }`。
  - 调用位置：
    - 在 `TextEditorTool.execute` 的 `create / str_replace / insert` 成功后，如果 `enable_quality_review` 为真，立即调用 `QualityReviewTool`，将其输出作为工具的 `ToolResult.output` 附带（或合并到 `ToolResult.observation`）。
    - 后续由 Agent 的 `reflect_on_result` 接收审查结果做反思与自动修正。
- OpenAPI 变更
  - `components.schemas.AgentModeConfig` 新增并在 `/agent/interactive/start` 与 `/agent/interactive/task` 的请求体中引用。

---

## Agent端方案
- 动态 Prompt 应用
  - `trae_agent/prompt/agent_prompt.py` 提供默认 Prompt：代码场景 `TRAE_AGENT_SYSTEM_PROMPT` 与文档场景 `DOCUMENT_AGENT_SYSTEM_PROMPT`（`trae_agent/prompt/agent_prompt.py:4-53`, `55-101`）。
  - `TraeAgent.set_system_prompt` 已支持覆盖与两种标识（`trae_agent/agent/trae_agent.py:184-195`）。在会话启动时优先应用 `AgentModeConfig.system_prompt`。
- 自定义指令注入
  - 在 `TraeAgent.new_task` 构建初始 `user_message` 时，拼接：
    - `Special instructions` 段落：附加 `AgentModeConfig.custom_instructions`（推荐位置：`trae_agent/agent/trae_agent.py:145-152`，在问题描述之后）。
- 审查-反思闭环
  - 工具执行后（特别是 `TextEditorTool`），如果启用审查：立即调用 `QualityReviewTool`，并将其输出随 `ToolResult` 一并返回。
  - 在 `TraeAgent.reflect_on_result`（`trae_agent/agent/trae_agent.py:196-199`）处理：
    - 若 `pass=false`，解析 `reasons/suggestions`，自动生成“修正计划”，触发下一步编辑。
    - 若 `pass=true`，继续后续步骤或结束。
- 工具层改造（拦截点）
  - `TextEditorTool`（`trae_agent/tools/edit_tool.py`）：在 `create/str_replace/insert` 的成功返回前，读取会话上下文：
    - 若 `enable_quality_review=true`，组装审查输入（见下文“审查Case”），调用 `QualityReviewTool`，将结果与原成功消息合并（以统一文本返回，便于前端单层气泡显示）。

---

## 质量审查工具与流程
- 工具：`QualityReviewTool`
  - 输入：`{ file_text?, content?, new_str?, file_path?, rules }`
  - 行为：依据 `rules` 对文本进行 LLM 审查，返回 `pass/reasons/suggestions`。
- 触发条件
  - 开启审查模式（`enable_quality_review=true`）。
  - 发生文本编辑工具调用：`create/str_replace/insert`。
- 审查Case与处理策略（请确认并可定制）
  - Case A：`str_replace` 正常替换（`old_str` 唯一）→审查 `new_file_content` 的片段与上下文；若需全文件语义，读取 `file_path` 完整内容并复核格式（Markdown/代码）。
  - Case B：`new_str` 为空（删除场景）→读取完整文件（`file_path`）进行结构性校验（如标题层级、大纲、代码块完整性）。
  - Case C：`create` 提供 `file_text`→直接审查 `file_text`，同时根据 `file_path` 规则检查命名与扩展名（如 `.md`、`.py`）。
  - Case D：`insert` 提供 `insert_line/new_str`→基于插入后合成的片段进行审查；若规则要求结构完整，则读取全文件进行全局校验。
  - Case E：`view` 命令不触发审查（只读）。
  - Case F：编辑工具返回片段过短→读取全文件补充审查；若文件过大，则按规则进行抽样或分节审查。
  - Case G：文件类型不匹配（非文本/二进制）→返回 `pass=false` 并给出“非目标类型”原因。
  - Case H：`old_str` 不唯一或未命中→工具已报错，不进入审查；在反思环节提示“定位不唯一”。
  - Case I：`file_path` 缺失但给了 `content/new_str`→视为内存态审查；若需要落盘后再审查，提示进行一次 `view` 或读取全文件。
- 反思反馈格式
  - 合并文本返回（便于前端单层气泡展示）：
    - 示例：
      - “编辑成功，片段如下…\n审查结果：Fail\n原因：未包含一级标题；缺少大纲\n建议：添加 `# 标题` 与包含章节的目录”

---

## OpenAPI 与类型
- 在 `openapi/apifox-trae-agent.yaml` 新增：
  - `AgentModeConfig` schema，引用于 `/agent/interactive/start` 与 `/agent/interactive/task` 的 `requestBody`。
- 前端 `api.ts` 增加类型映射，确保 `agent_mode_config` 可选传参并在 SSE 中返回 `reflection/observation`。

---

## 数据存储与会话管理
- PostgreSQL 表设计（示例）
  - `agent_modes`：`(id, mode_name UNIQUE, system_prompt, created_at)`
  - `agent_mode_overrides`：`(id, session_id, custom_instructions, enable_quality_review, quality_review_rules, created_at)`
- 会话上下文
  - 在 `_sessions[session_id]`（`trae_agent/server/main.py:1123-1149` 邻近）或内存结构中附加 `AgentModeContext`。
  - 任务执行时透传上下文至工具与 Agent。

---

## 验证与质量保障
- 单元测试
  - `TraeAgent.set_system_prompt` 覆盖测试。
  - `new_task` 注入 `custom_instructions` 的消息构造测试。
  - `TextEditorTool` 执行后触发 `QualityReviewTool` 的集成测试（含上列 Case）。
- 端到端测试
  - 前端模式切换→会话启动→编辑→审查→反思→自动修正闭环。
- 可观测性
  - SSE 步骤中增加审查结果事件或将其合并到步骤消息，便于前端展示与问题定位。

---

## 安全与合规
- 不记录明文密钥与审查规则中的敏感信息（日志脱敏）。
- 对外接口参数校验与权限控制（如仅部分用户/项目允许自定义模式）。

---

## PostgreSQL 连接方式
- 本机：`host=localhost`，`port=5432`，`user=postgres`，`password=postgres`，`database=trae`
- 连接字符串：
  - `psql`：`psql postgresql://postgres:postgres@localhost:5432/trae`
  - `SQLAlchemy`：`postgresql+psycopg://postgres:postgres@localhost:5432/trae`
- 容器内访问（Docker Compose 网络）：`host=postgres`（其他同上）。

---

## 实施里程碑
- M1：后端 schema 与 OpenAPI 扩展，`AgentModeConfig` 贯穿传递；前端会话面板增加模式与审查设置。
- M2：`TextEditorTool` 与 `QualityReviewTool` 接入，反思闭环在 `TraeAgent.reflect_on_result` 中落地。
- M3：覆盖测试与E2E验证，Apifox 文档更新，演示样例（文档助手模式生成与审查）。