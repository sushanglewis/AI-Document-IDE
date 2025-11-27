# 需要将当前的trae-agent遵循dify的规则，封装成一个dify tool插件，让其可以编排在dify工作流中，接收上游输入，并向下游输出（支持流式）。
- trae-agent将部署在一个可以与dify通信的环境内，提供接口
- 将接口封装成dify tool插件，插件名称为`trae-agent`，插件遵循dify的插件打包方式，可以直接在dify插件市场以本地插件的方式安装到dify中
- 根据dify的脚手架init方式，直接为插件授予dify平台权限：tools、models、apps、resources、storage、endpoints，从而插件可以获取平台的工具信息、模型配置信息等

# 插件能做什么
- 插件可以通过dify拖拉拽的方式配置到工作流中，并通过dify的edge连接，接收上游的输入，将输出流式返回给下游节点
- 插件具备以下配置项，可让用户自定义
  - 模型配置，直接以dify LLM节点模型选择的方式，用户通过下拉列表选择dify平台现有可用模型，确认后插件将使用该模型进行推理
  - 工具配置，直接以dify Agent节点配置工具列表的方式，用户可以用同样的方式为trae-agent配置可用工具
  - 质量评估配置，开关，打开后配置质量验证规则，即当前的quality_review_tool中LLM用到的rules
  - prompt配置，用户在该插件的dify节点配置表单中，填充自己定义的prompt，即传入当前模式下的prompt
- 插件运行测试、历史运行记录：同dify现有插件那样支持这两个功能


# 我认为需要对trae-agent做什么改造
- 与dify现有的模型客户端打通，即trae-agent在启用LLM客户端推理时，直接调用dify平台的模型客户端，而不是自己实现一个模型客户端
- 工具配置，需要支持现有的dify工具绑定方式，应该是dify前端绑定一系列的工具，这些工具会保存为一个工具列表，当trae-agent运行时，工具列表信息以上下文的方式传入LLM，从而让LLM输出tool call。此时trae-agent服务需要能够通过工具的url、token、参数等信息，对外部工具进行调用，并获取返回结果，然后返回到dify
- dify工作流信息传入：dify.sys.query（用户请求）、以及用户在prompt、质量评估配置中，引入的dify的其他变量，在运行到该插件节点时，应该会构造成一整段信息，传入到trae-agent服务，然后trae-agent内部根据这些信息执行
- 通信协议：trae-agent通过插件与dify集成，需要支持dify当前的插件通信协议
……


# manifest.yaml (插件清单文件)
"""
# 基础标识信息
identity:
  name: trae-agent
  author: bytedance-trae-team
  label:
    en_US: Trae Agent
    zh_Hans: Trae智能代理
    pt_BR: Agente Trae
  version: 1.0.0
  
# 插件描述
description:
  human:
    en_US: An intelligent software engineering agent that can perform code analysis, editing, testing and debugging tasks through natural language interaction.
    zh_Hans: 一个智能的软件工程代理，能够通过自然语言交互执行代码分析、编辑、测试和调试任务。
    pt_BR: Um agente de engenharia de software inteligente que pode executar análise de código, edição, teste e depuração através de interação em linguagem natural.
  llm: A comprehensive software engineering agent tool for code analysis, editing, testing, and debugging with natural language interaction capabilities.
 
# 插件类型和权限
type: tool
permissions:
  - tools      # 获取dify工具信息
  - models     # 获取dify模型配置
  - apps       # 访问应用信息
  - resources  # 访问资源
  - storage    # 存储访问
  - endpoints  # 端点访问
 
# 运行时配置
runtime:
  python:
    source: 
    requirements: requirements.txt
  streaming: true
  timeout: 300  # 5分钟超时
 
# 输入输出定义
inputs:
  - name: query
    type: string
    required: true
    label:
      en_US: Task Query
      zh_Hans: 任务查询
    description:
      en_US: Natural language description of the software engineering task to perform
      zh_Hans: 要执行的软件工程任务的自然语言描述
 
outputs:
  - name: result
    type: string
    streaming: true
    label:
      en_US: Execution Result
      zh_Hans: 执行结果
  - name: trajectory
    type: object
    streaming: false
    label:
      en_US: Execution Trajectory
      zh_Hans: 执行轨迹
 
# 参数配置
parameters:
  # 系统提示词配置
  - name: system_prompt
    type: string
    required: false
    label:
      en_US: System Prompt
      zh_Hans: 系统提示词
      pt_BR: Prompt do Sistema
    human_description:
      en_US: Custom system prompt for the agent
      zh_Hans: 代理的自定义系统提示词
      pt_BR: Prompt personalizado do sistema para o agente
    llm_description: Custom system prompt to guide agent behavior and capabilities
    form: llm
    default: ""
    placeholder:
      en_US: "Enter custom system prompt (optional)"
      zh_Hans: "输入自定义系统提示词（可选）"
    max_length: 2000
 
  # 模型配置
  - name: model_config
    type: model-selector
    required: true
    label:
      en_US: LLM Model
      zh_Hans: 大语言模型
      pt_BR: Modelo LLM
    human_description:
      en_US: Select the language model to use for reasoning
      zh_Hans: 选择用于推理的语言模型
      pt_BR: Selecione o modelo de linguagem para raciocínio
    form: model-selector
    model_types: ["llm"]
 
  # 工具配置
  - name: available_tools
    type: tool-selector
    required: false
    label:
      en_US: Available Tools
      zh_Hans: 可用工具
      pt_BR: Ferramentas Disponíveis
    human_description:
      en_US: Select additional tools from Dify platform
      zh_Hans: 从Dify平台选择额外的工具
      pt_BR: Selecione ferramentas adicionais da plataforma Dify
    form: tool-selector
    default: []
 
  # 最大步数配置
  - name: max_steps
    type: number
    required: false
    label:
      en_US: Max Steps
      zh_Hans: 最大步数
      pt_BR: Máximo de Passos
    human_description:
      en_US: Maximum number of execution steps
      zh_Hans: 最大执行步数
      pt_BR: Número máximo de passos de execução
    form: number
    default: 25
    min: 1
    max: 100
 
  # 质量评估开关
  - name: enable_quality_review
    type: boolean
    required: false
    label:
      en_US: Enable Quality Review
      zh_Hans: 启用质量评估
      pt_BR: Habilitar Revisão de Qualidade
    human_description:
      en_US: Enable quality assessment for generated results
      zh_Hans: 对生成结果启用质量评估
      pt_BR: Habilitar avaliação de qualidade para resultados gerados
    form: switch
    default: false
 
  # 质量评估规则
  - name: quality_review_rules
    type: string
    required: false
    label:
      en_US: Quality Review Rules
      zh_Hans: 质量评估规则
      pt_BR: Regras de Revisão de Qualidade
    human_description:
      en_US: Custom rules for quality assessment
      zh_Hans: 质量评估的自定义规则
      pt_BR: Regras personalizadas para avaliação de qualidade
    form: llm
    default: ""
    show_on:
      - variable: enable_quality_review
        value: true
    placeholder:
      en_US: "Define quality assessment criteria"
      zh_Hans: "定义质量评估标准"
    max_length: 1000
 
  # Lakeview摘要配置
  - name: enable_lakeview
    type: boolean
    required: false
    label:
      en_US: Enable Lakeview Summary
      zh_Hans: 启用Lakeview摘要
      pt_BR: Habilitar Resumo Lakeview
    human_description:
      en_US: Enable intelligent summarization of execution process
      zh_Hans: 启用执行过程的智能摘要
      pt_BR: Habilitar resumo inteligente do processo de execução
    form: switch
    default: true
 
  # Docker支持
  - name: enable_docker
    type: boolean
    required: false
    label:
      en_US: Enable Docker Support
      zh_Hans: 启用Docker支持
      pt_BR: Habilitar Suporte Docker
    human_description:
      en_US: Enable Docker container support for isolated execution
      zh_Hans: 启用Docker容器支持以实现隔离执行
      pt_BR: Habilitar suporte a contêiner Docker para execução isolada
    form: switch
    default: false
 
  # Docker配置
  - name: docker_config
    type: object
    required: false
    label:
      en_US: Docker Configuration
      zh_Hans: Docker配置
      pt_BR: Configuração Docker
    show_on:
      - variable: enable_docker
        value: true
    properties:
      image:
        type: string
        default: "ubuntu:20.04"
        label:
          en_US: Docker Image
          zh_Hans: Docker镜像
      keep_container:
        type: boolean
        default: false
        label:
          en_US: Keep Container
          zh_Hans: 保持容器
 
  # 轨迹记录配置
  - name: enable_trajectory_recording
    type: boolean
    required: false
    label:
      en_US: Enable Trajectory Recording
      zh_Hans: 启用轨迹记录
      pt_BR: Habilitar Gravação de Trajetória
    human_description:
      en_US: Record detailed execution trajectory for analysis
      zh_Hans: 记录详细的执行轨迹用于分析
      pt_BR: Gravar trajetória de execução detalhada para análise
    form: switch
    default: true
 
# 标签分类
tags:
  - development
  - automation
  - code-analysis
  - software-engineering
 
# 附加信息
extra:
  python:
    source: tools/trae_agent_tool.py
    dependencies:
      - dify-plugin-sdk>=0.1.0
      - aiohttp>=3.8.0
      - pydantic>=2.0.0
  
  # 健康检查端点
  health_check:
    endpoint: /health
    method: GET
    
  # 预热配置
  warmup:
    enabled: true
    timeout: 30
 
# 环境变量配置
env_vars:
  - name: TRAE_AGENT_PORT
    description: Port for trae-agent service
    default: "8080"
  - name: TRAE_AGENT_HOST
    description: Host for trae-agent service  
    default: "localhost"
  - name: TRAE_LOG_LEVEL
    description: Log level for debugging
    default: "INFO"
    """


# provider.yaml
"""
provider: trae-agent-models
label:
  en_US: Trae Agent Models
  zh_Hans: Trae代理模型
icon_small: 
  en_US: icon_s.svg
icon_large:
  en_US: icon_l.svg
supported_model_types:
  - llm
configurate_methods:
  - predefined-model
provider_credential_schema:
  credential_form_schemas:
    - variable: api_key
      label:
        en_US: API Key
        zh_Hans: API密钥
      type: secret-input
      required: true
      placeholder:
        en_US: Enter your API key
        zh_Hans: 输入您的API密钥
"""

# tool.yaml (工具定义)
"""
identity:
  name: trae_agent_executor
  author: bytedance
  label:
    en_US: Trae Agent Executor
    zh_Hans: Trae代理执行器
 
credentials_for_provider:
  api_key:
    type: secret-input
    required: true
    label:
      en_US: API Key
      zh_Hans: API密钥
 
parameters:
  - name: task_description
    type: string
    required: true
    label:
      en_US: Task Description
      zh_Hans: 任务描述
    human_description:
      en_US: Detailed description of the software engineering task
      zh_Hans: 软件工程任务的详细描述
    llm_description: Comprehensive description of the software engineering task to be executed
"""