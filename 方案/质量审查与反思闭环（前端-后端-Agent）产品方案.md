# 智能质量审查与反思（Quality Review & Reflection Loop）产品方案

## 目标
- 在文档等场景下，对编辑工具产出进行自动化审查，若不满足规则则反馈Observation，驱动Agent自动修正，形成质量闭环。

## 前端方案
- 交互与表单
  - 在“系统设置>系统提示词>新建系统提示词”对话框新增：
    - 开关：`enable_quality_review`（复选框）。
    - 文本域：`quality_review_rules`（用于审查工具的LLM Prompt）。
  - 会话级保存；任务执行时可覆盖。


## 后端方案
- 接口改造
  - 扩展 `POST /agent/interactive/start` 与 `/agent/interactive/task` 请求体，支持 `enable_quality_review` 与 `quality_review_rules`。
  - 会话上下文保存两个字段，供工具层调用与Agent反思读取。
- 数据库结构
  - 新增表 `quality_reviews`：记录每次审查结果与建议。
    - 字段：`id SERIAL PK`、`session_id TEXT`、`file_path TEXT`、`pass BOOLEAN`、`reasons TEXT[]/JSON`、`suggestions TEXT`、`created_at TIMESTAMP`
    - `prompts` 表新增字段`enable_quality_review`、`quality_review_rules` ，存储与该助手相关的审查配置
- OpenAPI
  - 更新 `AgentModeConfig` schema 与可能的工具结果结构；在 SSE或普通响应中返回审查摘要，便于展示（参考 `trae-agent/openapi/apifox-trae-agent.yaml:411-469` 流式接口）。

## Agent端方案
- 拦截与审查工具
  - 编辑工具为 `TextEditorTool`（`str_replace_based_edit_tool`）：`trae-agent/trae_agent/tools/edit_tool.py:100-131` 调度；成功路径：`197-236`（替换）、`238-274`（插入）、`121-126`（创建）。
  - 在成功返回前，若 `enable_quality_review=true`，立即调用 `QualityReviewTool`（新增工具，具备LLM能力）。此时不要将编辑工具的调用结果传入到反思中，而是必须等待审查结果返回 toolscalls.result，将审查结果的输出传入到反思。需要确认现当前代码是否完成工具调用后将toolscalls结果传入反思，如果没有，需要先实现在enable_quality_review未开启时，也必须将工具调用传入反思。改造后，开启enable_quality_review，即将原始流程‘编辑工具调用->产生结果->编辑工具结果传入反思’，修改为‘编辑工具调用->产生结果->传入文档审查工具->输出审查结果->审查结果传入反思’

- 反思处理
  - 需要首先确认当前trae agent反思机制是如何实现的，然后制定方案。

## 最终方案（分步审查插入）
- 流程目标
  - 在一次任务内，对每次“文档类工具调用”（如编辑工具）后的结果，逐次插入“质量审查工具”，将审查结果与步骤摘要一起进入后续推理；最终反思仅基于所有质量审查结果。

- 期望时序（示例）
  - 文档调用1 → 步骤摘要 → 质量审查1 → 步骤摘要 → 文档调用2 → 步骤摘要 → 质量审查2 → 步骤摘要 → 反思（传入质量审查1+2的结果）

- 管线改造点（只在开启 `enable_quality_review=true` 时生效）
  - 禁用并行工具调用：强制 `model_config.parallel_tool_calls=false`，保证顺序插入审查。
  - 按序执行与插入：修改 `base_agent._tool_call_handler` 的顺序逻辑，将“执行工具→注入消息→插入质量审查→注入消息”的链路，在一个 AgentStep 内按工具逐一完成：
    - 文件：`trae-agent/trae_agent/agent/base_agent.py:326-353`
    - 伪代码：
      - `review_results=[]`
      - for `tc in tool_calls`:
        1) `tr = await _tool_caller.sequential_tool_call([tc])`
        2) `messages.append(LLMMessage(role='user', tool_result=tr))`
        3) if `tc.name in ['str_replace_based_edit_tool','json_edit_tool']` and `tr.success`:
           - 解析 `tr.output` 提取 `file_path` 与 `edited_snippet`
           - 构造 `ToolCall(name='quality_review', arguments={file_path, edited_snippet, quality_review_rules})`
           - `rr = await _tool_caller.sequential_tool_call([quality_review_call])`
           - `review_results.append(rr)`
           - `messages.append(LLMMessage(role='user', tool_result=rr))`
      - `step.tool_results = tool_results + review_results`（保留完整轨迹）
      - 反思：当 `enable_quality_review` 时，仅基于 `review_results` 生成反思；否则沿用默认 `reflect_on_result(tool_results)`

- 反思改造
  - 新增 `reflect_on_quality_results(review_results)`选择 `review_results` 作为输入，当开启审查时，使用该方法。
  - 默认行为：审查失败将触发反思提示与后续修正；审查通过时不生成反思文本，保持简洁。
  - 位置：`trae-agent/trae_agent/agent/base_agent.py:253-265, 354-364` 附近进行方法扩展或分支控制。

- 工具与消息
  - 质量审查工具按既有工具模式实现与调用；其输出作为 `function_call_output` 注入消息，无需改造 SSE。
  - 步骤摘要维持既有控制台与轨迹记录链路：`openai_compatible_base.py:192-215`、`trajectory_recorder.py:166-189, 232-242`、`rich_console.py:300-320`。

## 质量审查工具（实现要求）
- 名称：`quality_review`
- 参数：
  - `file_path`（string，必填）
  - `edited_snippet`（string，必填）
  - `quality_review_rules`（string，必填），作为LLM prompt的 {审查规则} 参数注入。该LLM节点需要生成一个 base prompt，role=文档审查校阅工程师，输入为 用户query（即task）、上一步工具的执行结果（result.content / result.repalce_str 需要你应对不同的工具调用以及其返回的结果，来定义不同case传入的参数。通常是生成、替换的内容文本）。
  - `view_range`（array<int>，可选）
- 输出：
  - 建议结构化文本或JSON：`pass:boolean; reasons:string[]; suggestions:string; summary:string`
- 注册：在 `TraeAgentConfig.tools` 增加 `quality_review`（`trae-agent/trae_agent/utils/config.py:147-185`）。
- 执行：沿用 `docker_tool_executor.sequential_tool_call` 与本地执行器路由（`trae-agent/trae_agent/tools/docker_tool_executor.py:62-73`）。

## 接口与上下文
- 在 `InteractiveStartRequest` 与 `InteractiveTaskRequest` 增加：`enable_quality_review?: boolean`、`quality_review_rules?: string`；任务请求覆盖会话初始化配置。
- 从会话上下文读取两个字段用于管线控制与审查参数；写入 `quality_reviews` 表以持久化结果。

## 风险与处理
- 时延：控制审查的输入范围，超时/失败时不阻断流程，反思仍可继续推动修正。
- 一致性：记录 `file_path` 与片段行号；确保审查结果与编辑输出一一对应。
- 安全性：过滤不安全审查规则；工具层保持写入白名单。

## 验收
- 单元：工具分步执行与审查插入、反思分支逻辑、数据落库。
- 集成：按示例时序验证“文档调用→摘要→审查→摘要”循环；最终反思只基于审查结果。

## 说明与假设
- 本方案将“文档调用”界定为会产生具体文档/文件改动的工具（当前为 `str_replace_based_edit_tool`、`json_edit_tool`）；如需覆盖其他产出型工具，可在白名单中增补工具名。
- 若并行工具调用必须保留，则在开启 `enable_quality_review` 时临时切换为顺序模式，仅在审查关闭时恢复并行，以保证插入点的可控性。

---

# 代码走查与最终落地方案（严格可执行）

## 代码走查结论
- Agent管线：工具调用与反思逻辑集中于 `trae-agent/trae_agent/agent/base_agent.py:326-364`，其中 `step.tool_results` 注入到消息后，默认调用 `reflect_on_result(tool_results)` 生成反思文本。
- 当前TraeAgent反思：`trae-agent/trae_agent/agent/trae_agent.py:196-199` 覆写 `reflect_on_result` 返回 `None`，即默认不反思。
- 并行控制：`ModelConfig.parallel_tool_calls` 由配置控制，调用点在 `base_agent.py:343-347`。
- 编辑工具输出：
  - 文本编辑工具 `str_replace_based_edit_tool` 的成功输出是带 `cat -n` 片段的纯文本，包含文件路径与片段行号，见 `trae-agent/trae_agent/tools/edit_tool.py:223-236`。
  - JSON编辑工具 `json_edit_tool` 成功输出也是纯文本摘要，见 `trae-agent/trae_agent/tools/json_edit_tool.py:242-246, 285-287, 326-329`。
- 工具注册与执行：工具注册于 `trae-agent/trae_agent/tools/__init__.py:32-41`；`ToolExecutor` 仅能执行初始化时注入到 `self._tools` 的工具，见 `trae-agent/trae_agent/tools/base.py:186-206, 206-238`。
- Docker执行器：当前仅支持 `bash`、`str_replace_based_edit_tool`、`json_edit_tool`，见 `trae-agent/trae_agent/tools/docker_tool_executor.py:66-71, 131-151`。
- 服务端接口：Interactive模式请求体定义于 `trae-agent/trae_agent/server/main.py:59-78, 80-90`，尚未包含质量审查相关字段；SSE步进输出中已携带 `tool_calls` 与 `tool_results` 摘要，见 `server/main.py:365-446`。
- OpenAPI：Apifox版存在，路径 `trae-agent/openapi/apifox-trae-agent.yaml`；另有 `OpenAPI/trae-agent.yaml`，`AgentModeConfig` 仅含 `mode_name/system_prompt`，见 `OpenAPI/trae-agent.yaml:1-40`。
- DB：当前仅 `prompts` 与 `model_configs` 两表，未包含 `quality_reviews`，见 `trae-agent/trae_agent/server/db.py:12-34`。

结论：现有管线与工具足以承载“审查插入”，需：
- 新增质量审查工具并注册。
- 在工具调用串中按编辑工具成功后同步插入审查调用，消息注入以审查结果为准。
- 当开启时关闭并行；反思仅基于审查结果。
- 扩展接口与上下文；持久化审查结果。
- Docker模式支持质量审查工具的调用路由。

## 最终落地改造方案

### 开关与规则承载
- 请求体扩展：在交互接口增加两个字段（任务请求覆盖会话初始化）：
  - `InteractiveStartRequest.enable_quality_review?: boolean`
  - `InteractiveStartRequest.quality_review_rules?: string`
  - `InteractiveTaskRequest.enable_quality_review?: boolean`
  - `InteractiveTaskRequest.quality_review_rules?: string`
  - 位置：`trae-agent/trae_agent/server/main.py:59-78, 80-90` 增加字段定义与解析。
- 会话上下文：在 `_sessions[session_id]` 的 Agent上保存两个字段，或保存在 `_session_configs[session_id]` 的扩展配置中；本方案采用在 `Agent.agent`（TraeAgent实例）上新增属性：`enable_quality_review: bool`、`quality_review_rules: str | None`，在 `interactive_start`/`interactive_task` 填充。
- 并行控制：当 `enable_quality_review=true` 时，强制 `self.agent_config.model.parallel_tool_calls=False`，见 `base_agent.py:343-347` 行为生效。

### 工具实现（quality_review）
- 名称：`quality_review`
- 参数：
  - `file_path: string`（必填）
  - `edited_snippet: string`（必填）
  - `quality_review_rules: string`（必填）
  - `view_range: array<int>`（可选）
- 输出：`pass:boolean; reasons:string[]; suggestions:string; summary:string`（建议JSON字符串）
- 注册：在 `trae-agent/trae_agent/tools/__init__.py:32-41` 中增加 `"quality_review": QualityReviewTool`，并实现 `QualityReviewTool` 类（新文件 `trae-agent/trae_agent/tools/quality_review_tool.py`）。
- 执行策略：
  - 纯本地模式：直接在 `QualityReviewTool.execute` 内调用所选LLM（直接使用当前会话所选的LLM配置），将 `{task, file_path, edited_snippet, quality_review_rules}` 构造成prompt，返回结构化文本/JSON。
  - Docker模式：在 `docker_tool_executor.py` 增加路由分支，类似 `json_edit_tool`（`trae-agent/trae_agent/tools/docker_tool_executor.py:131-151`），通过 `CONTAINER_TOOLS_PATH` 下的可执行封装或直接转发参数。

### 管线插入（严格时序）
- 修改 `trae-agent/trae_agent/agent/base_agent.py:326-364` 的 `_tool_call_handler`，当开启质量审查时执行如下顺序：
  - `review_results=[]`
  - 遍历 `tool_calls`，逐一顺序执行：
    1) `tr = await _tool_caller.sequential_tool_call([tc])`
    2) `messages.append(LLMMessage(role='user', tool_result=tr[0]))`
    3) 如果 `tc.name in ['str_replace_based_edit_tool','json_edit_tool']` 且 `tr[0].success`：
       - 解析 `tr[0].result` 提取 `file_path` 与 `edited_snippet`（基于 `edit_tool.py:223-236` 输出格式，用正则从 "The file {path} has been edited." 与后续 `cat -n` 段切片构建片段文本）
       - 构造审查调用：`qc = ToolCall(name='quality_review', arguments={file_path, edited_snippet, quality_review_rules}, call_id=... )`
       - `rr = await _tool_caller.sequential_tool_call([qc])`
       - `review_results.append(rr[0])`
       - 将审查结果注入消息：`messages.append(LLMMessage(role='user', tool_result=rr[0]))`
  - `step.tool_results = tool_results + review_results`（确保轨迹完整记录）
- 反思逻辑：当 `enable_quality_review=true` 时，新增分支仅基于 `review_results` 反思：
  - 新增方法 `reflect_on_quality_results(review_results)`，位置建议：`base_agent.py:253-265` 附近；默认规则为“审查失败则生成修正提示，审查通过不产生冗余反思”。
  - 调用替换：开启质量审查时调用 `reflect_on_quality_results(review_results)`；关闭时仍用 `reflect_on_result(tool_results)`。
- TraeAgent兼容：当前 `trae_agent.py:196-199` 将反思禁用。为复用质量反思，建议在 `TraeAgent` 中覆写 `reflect_on_quality_results` 返回 `None`（审查通过无反思；审查失败也可按需要返回简短提示）。若希望保留默认失败反思，则不要覆写，沿用 `BaseAgent` 新增默认实现。

### OpenAPI与后端接口扩展
- OpenAPI（Apifox版）更新：在 `trae-agent/openapi/apifox-trae-agent.yaml` 的交互启动与任务接口中增加 `enable_quality_review` 与 `quality_review_rules` 字段；`AgentModeConfig` schema 增加同名字段。参考 `OpenAPI/trae-agent.yaml:1-40` 的结构。
- 交互接口实现：
  - `interactive_start`：读取两个字段，保存至 `Agent.agent` 实例属性；当开启时强制 `config.trae_agent.model.parallel_tool_calls=False`；见 `server/main.py:618-716`。
  - `interactive_task` 与 `interactive_task_stream`：同样读取覆盖会话，并在执行前刷新 `Agent.agent` 的并行开关与规则。
- SSE：不需改动。审查结果已作为工具输出注入消息并记录到轨迹（`openai_client.parse_tool_call_result` 将 `FunctionCallOutput` 注入历史，见 `trae-agent/trae_agent/utils/llm_clients/openai_client.py:164-207`；`openai_compatible_base.py:192-215` 也会记录交互）。

### 数据落库
- 新增 `quality_reviews` 表：
  - 字段：`id SERIAL PK`、`session_id TEXT`、`file_path TEXT`、`pass BOOLEAN`、`reasons TEXT`（或JSON）、`suggestions TEXT`、`summary TEXT`、`created_at TIMESTAMP`
  - 位置：`trae-agent/trae_agent/server/db.py` 中定义Model，并在 `init_db()` 自动创建。
- 写入时机：在 `_tool_call_handler` 完成审查调用后，将结构化审查结果写入数据库；会话ID可从 `interactive` 管线中传入或通过 `_sessions` 反查。

### Docker模式支持
- 在 `trae-agent/trae_agent/tools/docker_tool_executor.py` 增加对 `quality_review` 的分支与参数编排，沿用 `json_edit_tool` 的风格；同时在初始化时将 `quality_review` 纳入 `docker_tools` 集合（`base_agent.py:65-71`）。

## 实现细节（关键点）
- 编辑输出解析：
  - 文本编辑工具：从 `success_msg` 文本中以正则 `^The file (.+?) has been edited\.` 抽取 `file_path`；`edited_snippet` 则取 "Here's the result of running `cat -n` on" 之后的整段带行号文本（`edit_tool.py:223-236`）。
  - JSON编辑工具：`file_path` 取参数中的路径；`edited_snippet` 可取成功提示文本，或在工具内增补返回片段（可选）。
- 反思规则：质量反思默认仅在 `pass=false` 时输出：合并 `reasons` 与 `suggestions` 的简要提纲；通过时返回空（不注入assistant反思消息）。
- 工具注册与可用性：确保 `quality_review` 被加入 `TraeAgent` 初始化工具集（`trae_agent/trae_agent/agent/trae_agent.py:120-127`），否则 `ToolExecutor` 无法执行该工具。
- 并行关闭：在服务端设置 `config.trae_agent.model.parallel_tool_calls=False`，以保证 `_tool_call_handler` 顺序调用。
- 轨迹与SSE：`step.tool_results` 合并编辑与审查结果，SSE中将自然包含审查结果摘要，无需额外改造。

## 风险与问题评估
- 时延增加：每次编辑工具成功后插入审查将显著增加LLM调用次数。
  - 缓解：限制 `edited_snippet` 长度（例如最多 `N` 行），并设置审查工具超时与失败不阻断（失败时仅记录，不影响后续推理）。
- 解析鲁棒性：编辑工具输出为纯文本，需鲁棒正则解析路径与片段。
  - 缓解：在编辑工具增加可选结构化返回（JSON），但为兼容现有前端显示，仍保留文本。
- Docker支持：质量审查工具在容器内的可执行封装需提供，且路径翻译要正确。
  - 缓解：复用 `json_edit_tool` 的参数编排与路径翻译逻辑（`docker_tool_executor.py:131-151`），并在容器镜像中预置审查工具可执行。
- 反思冲突：`TraeAgent.reflect_on_result` 已禁用，新增质量反思需明确分支，避免产生双重反思。
  - 缓解：只在开启质量审查时调用 `reflect_on_quality_results`，TraeAgent可选择覆写为空以保持简洁。
- OpenAPI与后端一致性：多处接口与schema需同步更新，避免前后端字段不一致。
  - 缓解：统一以 Apifox YAML 为源，生成/对齐 `OpenAPI/trae-agent.yaml`；在 `server/main.py` 增加字段的读取与传递，集中单元测试覆盖。
- 数据库可用性：Postgres连接不可用或迁移失败时影响持久化。
  - 缓解：初始化失败时降级为仅轨迹文件记录；对 `quality_reviews` 写入失败进行捕获与重试。

## 验收与测试计划
- 单元测试：
  - 工具层：`QualityReviewTool` 参数校验与LLM调用回传解析；编辑输出解析函数的边界用例。
  - Agent管线：`_tool_call_handler` 顺序插入、消息注入、并行关闭分支；`reflect_on_quality_results` 分支逻辑。
  - 服务端：`InteractiveStartRequest/InteractiveTaskRequest` 新字段解析与并行开关强制；DB写入。
- 集成测试：
  - 路径：交互会话下执行包含多次 `str_replace_based_edit_tool` 的任务；验证“编辑→摘要→审查→摘要”的时序与最终反思仅基于审查结果。
  - SSE：检查事件流中 `tool_results` 增量包含审查结果；最终completed事件的摘要一致。
- 性能验证：统计开启与关闭质量审查下的步时与总时延；评估可接受范围与收敛质量。



