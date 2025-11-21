# 背景
当前 trae-agent 的运行逻辑较为固化，Prompt 和行为逻辑通过硬编码绑定。为了满足不同垂直场景（如“纯代码开发”与“文档撰写”）的差异化需求，我们需要将 Agent 改造为配置驱动（Configuration-Driven） 架构。

# 核心目标：
解耦配置：支持前端动态传入运行模式参数，实现 Agent 行为的实时切换。
增强可控性：允许用户注入自定义的业务规则（Custom Instructions）。
质量闭环：在文档生成等特定场景下，引入自动化的“审查-反思”机制，提升交付物的准确性。

# 功能需求详解：我们需要构建一个统一的配置对象 AgentModeConfig，并将其贯穿于 Agent 的生命周期。
1. 动态模式配置 (Dynamic Mode Configuration)
用户在前端选择不同的“模式”时，Agent 应当加载对应的“人设”和“底层指令”。
- 配置项：
mode_name (String): 模式标识（如 "doc_writer", "code_expert"）。
system_prompt (String): 该模式专属的系统提示词（覆盖默认 Prompt）。
- 逻辑变更：
在 /Users/stylesu/Documents/Heils/Agent/trae-agent/trae_agent/prompt/agent_prompt.py 中支持接收动态 Prompt。
在 TraeAgent 初始化时，优先使用传入的 system_prompt。

2. 上下文指导注入 (Contextual Instruction Injection)
- 配置项：
custom_instructions (String): 用户自定义的自然语言指导
- 逻辑变更：
在 trae_agent/agent/trae_agent.py 构建初始 user_message 时，将此字段拼接到 [Special instructions] 模块中。

3. 智能质量审查与反思 (Quality Review & Reflection Loop)
- 用户故事：用户选择了“文档助手”模式，并定义了审查规则（如“必须包含一级标题和大纲”）。当 Agent 调用工具生成了一个文档文件时，系统自动检查内容。如果发现没有大纲，系统会提示 Agent：“检测到文档缺失大纲，请修改。” Agent 随即自动进行修改。
- 配置项：
enable_quality_review (Boolean): 是否开启审查机制。
quality_review_rules (String): 用户定义的审查标准（如“检查是否存在拼写错误”、“检查格式是否为 Markdown”），作为文档审查工具LLM的prompt
- 触发条件：
当前开启了审查模式。
Agent 调用了 文件操作类工具如str_replace_based_edit_tool，需要用 立即调用 文档质量审查工具（具备LLM能力）来拦截该工具向reflect_on_result方法传递的结果，reflect_on_result 将收到 文档质量审查工具 的输出，来进行反思
- 执行逻辑：
拦截：在 str_replace_based_edit_tool  方法中拦截工具执行结果，若开启了审查模式，完成工具调用后立即调用 文档质量审查 工具，并将 文档质量审查工具的输出作为 工具输出。

审查：将工具参数中的 file_text / content / new_str / file path 提取出来，结合 quality_review_rules 进行自动化检查。需要有多case处理能力，如 new_str为空，则通过file_path读取文件，根据str_replace_based_edit_tool可能返回的case进行流程定义。你需要为我提供这些case，让我给出建议
反馈：将审查结果（Pass 或 Fail 原因）作为 Observation 反馈给 Agent，触发其进行下一步思考（反思）。