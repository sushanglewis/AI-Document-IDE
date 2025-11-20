## 目标与原则
- 通过自然语言对话驱动所有任务：生成大纲、生成文档、改写文档，无固定功能列表。
- 直接操作工作空间：新建/打开/编辑/保存文件，所有变更落地到 `/workspace`。
- 默认采用文档型系统提示词：`DOCUMENT_AGENT_SYSTEM_PROMPT`；可在会话或任务时切换/自定义。
- 流式体验：SSE 结果以会话气泡展示，每步含摘要与工具调用信息。
- 高可用与可观测：轨迹完整可视化、错误清晰反馈、参数可配置。

## 系统架构
### 前端（IDE 插件或 Web 面板）
- 对话面板：输入框（支持拖拽文件 chip）、Prompt 选择器（默认文档型）、发送按钮（非流式/流式两种）。
- 工作空间文件树：读取 `/workspace`，列出目录与文件；支持新建、打开、保存。
- Markdown 编辑器：成熟富文本控件（支持 Markdown 渲染与所见即所得），保存回写到工作空间。
- 流式控制台：SSE 会话气泡渲染（start/step/completed/end）。
- 消息记录窗口：按 `session_id` 聚合显示对话、步骤、工具结果与轨迹链接，支持搜索/过滤。

### 后端（复用现有服务接口）
- 会话：`POST /agent/interactive/start`、`POST /agent/interactive/task`、`POST /agent/interactive/task/stream`
- 一次性任务：`POST /api/agent/run`（JSON 友好）、`POST /agent/run`（含上传配置）
- 工作空间：`GET /workspace`、`GET /api/files`、`GET /api/file`、`POST /api/file`
- 配置模型：新增 `POST /config/create`（创建/更新 YAML 配置）；测试用 `GET /agent/config?config_file=...`
- OpenAPI：`GET /openapi/apifox-trae-agent.yaml`

## 关键能力
- 自然语言任务输入：用户直接描述需求作为 `task` 提交；文件 chip 注入路径提示。
- 文件管理：任意路径新建（如 `docs/<name>.md`）、打开预览、编辑保存（`POST /api/file`）。
- 文档工作流：大纲 → 文档 → 改写；均在会话中通过工具执行并记录轨迹。
- Prompt 策略：默认 `DOCUMENT_AGENT_SYSTEM_PROMPT`；可切换到工程型或自定义文本。
- 流式渲染：SSE 事件映射为气泡，显示步骤摘要、工具统计与响应片段；支持展开详情。

## 气泡类型与样式（参考轨迹字段）
- 启动气泡（start）：展示 `trajectory_file`、`working_dir`；背景弱强调。
- 步骤气泡（step）：
  - 标题：Step N / 状态（COMPLETED/ERROR）
  - 内容：`llm_response.content_excerpt`（最多 400 字）；`usage`（input/output tokens）、`finish_reason`。
  - 工具统计：`tool_calls` 汇总（名称与数量）；“展开详情”显示完整工具调用与 `tool_results`。
- 反思气泡（reflection）：显示 `reflection` 文本（若存在）。
- 工具结果气泡（tool result）：按调用分组显示成功/错误与输出片段；可折叠。
- 完成气泡（completed）：`success/final_result/agent_state/execution_time/steps_count`，附操作按钮（打开变更文件、查看补丁、打开轨迹时间线）。
- 错误气泡（error）：突出错误原因（如配置无效、连通失败、参数冲突）与修复建议。

## 交互流程
1. 初始化
   - 读取 `GET /workspace` → 设定 `working_dir=/workspace`
   - 拉取 YAML → 生成接口客户端；读取 `GET /agent/config` 展示模型/provider
2. 选择 Prompt
   - 默认 `DOCUMENT_AGENT_SYSTEM_PROMPT`；允许切换为工程型或自定义
3. 创建会话
   - `POST /agent/interactive/start`（`config_file=file:///workspace/trae_config.yaml`、`working_dir=/workspace`、`prompt`）
4. 提交任务
   - 非流式：`POST /agent/interactive/task`（自然语言需求）；完成后加载并渲染轨迹时间线
   - 流式：`POST /agent/interactive/task/stream`，逐步渲染气泡并在完成后汇总
5. 文件操作
   - 新建：输入路径 → `POST /api/file` 写入初始内容
   - 编辑：`GET /api/file` → Markdown 编辑器 → `POST /api/file` 保存
   - 拖拽：将文件 chip 注入任务输入；提交时路径随描述进入 LLM 语境

## 接口约定与映射
- 会话启动（默认文档 Prompt）：
  - `POST /agent/interactive/start` `{config_file:"file:///workspace/trae_config.yaml", working_dir:"/workspace", provider:"openrouter", model:"Qwen3-32B", max_steps:50, console_type:"simple", prompt:"DOCUMENT_AGENT_SYSTEM_PROMPT"}`
- 会话任务（流式）：
  - `POST /agent/interactive/task/stream` `{session_id, task:"改写 /workspace/docs/quickstart.md 并优化结构与术语", working_dir:"/workspace", prompt:"DOCUMENT_AGENT_SYSTEM_PROMPT"}`
- 文件创建与保存：
  - 新建：`POST /api/file` `{file:"/workspace/docs/new-article.md", content:"# 标题\n"}`
  - 保存：`POST /api/file` `{file:"/workspace/docs/new-article.md", content:"..."}`
- 配置创建：
  - `POST /config/create` `{name:"trae_config.custom.yaml", provider:"openrouter", model:"Qwen3-32B", base_url:"http://10.0.2.22:9997/v1", api_key:"sk-xinference", temperature:0.2, top_p:1, top_k:0, parallel_tool_calls:true, max_retries:3, enable_lakeview:false}`
  - 测试：`GET /agent/config?config_file=file:///workspace/trae_config.custom.yaml`

## Markdown 编辑器选型建议
- TipTap Markdown（富文本能力强，插件生态好）或 Monaco + Markdown 插件（代码友好）。
- 必须：Markdown/富文本切换、语法高亮、表格/代码块支持、撤销恢复、快捷键、粘贴图片（可选存储策略）。

## 消息记录窗口设计
- 会话列表：按 `session_id` 聚合，显示最近任务状态与时间。
- 消息流：用户消息、系统 Prompt（可折叠）、流式步骤、工具结果、完成与错误气泡。
- 搜索与过滤：按关键词、文件名、步骤类型过滤；锚点导航到轨迹时间线或具体文件。

## 错误与健壮性
- 参数校验：`working_dir` 必须绝对路径；`task` 与 `file_path` 互斥；Docker 选项互斥提示。
- 配置异常：返回 400 错误详情并在 UI 提供修复建议（如 `model_base_url`、`api_key` 设置）。
- SSE 重连：断线自动重试；去重与步数校验；逐步缓存与恢复。
- 保存保护：保存节流、并发冲突提示（外部修改时的版本提醒）。

## 默认参数
- `working_dir`：`/workspace`（来自 `GET /workspace`）
- `config_file`：`file:///workspace/trae_config.yaml`
- `prompt`：`DOCUMENT_AGENT_SYSTEM_PROMPT`
- `max_steps`：文档类默认 20（可在 UI 调整）

## 里程碑与交付
- 里程碑 1（最小可用）：
  - 对话面板（默认文档 Prompt）、会话启动与非流式任务；工作空间文件树；Markdown 编辑器；基础 SSE 气泡（start/step/completed）。
- 里程碑 2（增强）：
  - 气泡细化（usage、工具统计、展开详情）；拖拽文件到输入框；轨迹时间线与补丁预览。
- 里程碑 3（配置与体验）：
  - `POST /config/create` 前后端；配置测试与设为默认；消息记录窗口（会话列表、搜索过滤、导出）。

## 验收标准
- 自然语言驱动任务在流式/非流式模式下可执行并展示结果。
- 任意文档名创建、编辑与保存回写工作空间；文件拖拽到输入框后任务能基于该文件生成/改写。
- 默认 Prompt 为文档型，轨迹完整，错误反馈明确，整体交互顺畅。

确认后我将按该最终设计开始开发，实现里程碑 1 的最小可用版本并交付测试。