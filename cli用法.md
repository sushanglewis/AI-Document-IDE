CLI 用法列表

- run [TASK] ：在选定工作空间执行一次性任务
  - --file, -f : 从文件读取任务内容
  - --provider, -p : 指定 LLM provider
  - --model, -m : 指定模型
  - --model-base-url : 模型 API 基础地址
  - --api-key, -k : API key
  - --max-steps : 最大执行步数
  - --working-dir, -w : 工作目录（使用按钮选择的工作空间）
  - --must-patch, -mp : 是否必须生成补丁
  - --config-file : 配置文件路径（默认使用项目中的 trae_config.yaml.example ）
  - --trajectory-file, -t : 轨迹保存路径
  - --patch-path, -pp : 补丁文件路径
  - --console-type, -ct : simple 或 rich
  - --agent-type, -at : 目前支持 trae_agent
  - Docker 选项： --docker-image 、 --docker-container-id 、 --dockerfile-path 、 --docker-image-file 、 --docker-keep
- interactive ：进入交互模式（持续会话）
  - 支持与 run 相同的大部分参数： --provider 、 --model 、 --model-base-url 、 --api-key 、 --config-file 、 --max-steps 、 --console-type 、 --agent-type
- show_config ：显示当前配置
  - --config-file 、 --provider 、 --model 、 --model-base-url 、 --api-key 、 --max-steps
- tools ：展示可用工具及说明
上述命令在 trae_agent/cli.py 中实现，入口模块为 trae_agent.cli 。示例用法：

- 任务模式： run "创建一个 hello world Python 脚本" --max-steps 10
- 交互模式： interactive --console-type rich
- 查看配置： show_config --config-file ./trae_config.yaml.example
- 工具列表： tools