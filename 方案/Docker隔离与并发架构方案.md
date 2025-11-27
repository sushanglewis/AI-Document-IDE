# Trae Agent Docker 隔离与并发架构方案

## 1. 核心结论

针对您提出的问题：**“cli命令有一个指定docker容器功能，是否意味着应该使用这个命令，在收到创建会话请求后，新建一个子容器来承载这次会话的服务，来避免互斥？”**

**结论是：是的，这是解决多租户隔离、文件并发访问以及资源互斥的最佳架构方案。**

采用 **Master-Worker（主从）架构**，将“大脑”（Trae Agent 逻辑）与“身体”（执行环境）分离，是云端 IDE 和 Agent 服务的标准最佳实践。

## 2. 架构设计：Master-Worker 模型

### 2.1 组件角色

1.  **Master (Control Plane) - API 容器**
    *   **载体**：当前运行 `trae-agent` API 服务的 Docker 容器。
    *   **职责**：
        *   接收前端 HTTP/WebSocket 请求。
        *   维护 Session 状态（Session ID <-> Container ID 映射）。
        *   运行 Agent 核心逻辑（LLM 调用、规划、轨迹记录）。
        *   **不进行** 繁重的文件操作或代码执行，只负责“发号施令”。
    
2.  **Worker (Data Plane) - 会话容器**
    *   **载体**：为每个 Session 动态创建的轻量级 Docker 容器（基于 `trae-agent` 镜像或精简版环境镜像）。
    *   **职责**：
        *   提供隔离的文件系统（Workspace）。
        *   执行 Shell 命令（`ls`, `cat`, `python run.py` 等）。
        *   承载用户的代码运行环境。
    *   **生命周期**：随 Session 创建而启动，随 Session 结束而销毁（或保留供调试）。

### 2.2 核心流程

#### A. 创建会话 (Session Creation)
1.  前端请求 `/session/create` (或 `/agent/interactive/start`)，并在 Payload 中携带 `docker_image` 参数。
2.  Master (API) 接收请求，初始化 `Agent` 实例及 `DockerManager`。
3.  Master 启动一个新的 Worker 容器（挂载必要的 Volume，如需要）。
4.  Master 记录 `Session ID` -> `Agent` 实例的映射。
5.  返回成功响应。

#### B. Agent 运行 (Task Execution)
1.  前端发送 Task。
2.  Master 中的 Agent 逻辑开始思考（LLM 调用）。
3.  Agent 决定执行工具（例如 `bash` 命令 `ls -la`）。
4.  **关键点**：`DockerToolExecutor` 拦截该工具调用。
5.  Master 通过 `docker exec` 将命令发送给对应的 Worker 容器执行。
6.  Worker 返回结果（Stdout/Stderr）。
7.  Master 接收结果，继续思考。

#### C. 并发文件访问 (Concurrent File Access)
1.  **场景**：Agent 正在运行中（例如正在思考或等待长命令），用户点击前端“刷新文件列表”。
2.  前端请求 Master 的文件接口（需新增）。
3.  Master 接收请求（由于 API 是异步的，且 Agent 运行在后台任务中，主线程未被阻塞）。
4.  Master 立即向 Worker 容器发送 `docker exec ls -R /workspace`（**Stateless Execution**）。
5.  Worker 容器是一个独立的 OS，可以同时处理来自 Agent 的命令（如正在跑测试）和来自用户的命令（如 `ls`），互不影响（除非修改同一文件）。
6.  Master 将结果返回给前端。
**彻底解决互斥问题**：文件系统在 Worker 中，Master 只是代理，不再有本地文件锁或 Loopback 请求死锁的问题。

## 3. 解决具体痛点

### 3.1 互斥与死锁 (Mutex & Deadlock)
*   **原问题**：Agent 运行在本地，占用文件锁或 Event Loop；同时尝试调用自身 API（Loopback）导致死锁。
*   **新方案**：
    *   Agent 逻辑在 Master，文件操作在 Worker。
    *   Master 与 Worker 之间通过 Docker Socket 通信，非阻塞。
    *   `task_done` 等工具在 Master 本地运行，直接读取 Master 内存中的轨迹数据，无需 HTTP 回环调用。

### 3.2 多租户隔离 (Multi-tenancy)
*   **原问题**：所有 Session 共享 API 容器的文件系统，A 用户的修改 B 用户可见，极其危险。
*   **新方案**：每个 Session 对应独立 Container。
    *   文件系统完全隔离。
    *   环境变量隔离。
    *   进程隔离（CPU/内存限制可单独配置）。

### 3.3 性能与响应 (Performance)
*   Master 容器专注于处理高并发网络请求和 LLM 调度，负载较低。
*   繁重的编译、测试任务分散在各个 Worker 容器中。

## 4. 实施关键点 (Implementation Strategy)

### 4.1 代码调整方向
需要确认 `trae-agent` 代码已支持以下配置（根据代码分析已基本支持）：

1.  **`BaseAgent` 配置**：
    确保在创建 Agent 实例时，传入 `docker_config` 参数。当前 `server/main.py` 的 `interactive_start` 接口已支持解析 `docker_image` 等参数，这部分**无需大改**。

2.  **工具分发策略 (`docker_tools` list)**：
    在 `base_agent.py` 中，`docker_tools=["bash", "str_replace_based_edit_tool", "json_edit_tool"]`。
    这意味着：
    *   **文件/Shell 操作**：自动转发到 Worker 容器执行。
    *   **逻辑/辅助工具 (如 `task_done`)**：在 Master 本地执行。
    *   **策略正确**：`task_done` 需要读取 Master 上的轨迹文件（Trajectory），因此它必须在 Master 运行。

3.  **环境要求**：
    Master 容器（API 服务）需要挂载宿主机的 Docker Socket，以便能创建兄弟容器（Sibling Containers）。
    *   `docker-compose.yml` 配置：
        ```yaml
        volumes:
          - /var/run/docker.sock:/var/run/docker.sock
        ```

## 5. 补充方案：文件操作并发接口设计

为了实现“在 Trae Agent 执行过程中刷新文件列表”的需求，必须在 API 层增加独立的文件操作接口，并使用 **Stateless Docker Execution** 模式。

### 5.1 接口设计 (API Design)
Master (API) 容器应新增以下 Endpoint：

*   `GET /session/{session_id}/files/list?path=/workspace`
    *   功能：列出指定目录下的文件。
    *   实现：Master 收到请求后，查找对应 Session 的 Docker Container，直接调用 `DockerManager.execute_stateless("ls -F /workspace")`。

*   `GET /session/{session_id}/files/content?path=/workspace/foo.py`
    *   功能：读取文件内容。
    *   实现：Master 调用 `DockerManager.execute_stateless("cat /workspace/foo.py")`。

### 5.2 关键技术点：Stateless Execution
目前的 `DockerManager` 默认使用 `pexpect` 维护一个持久化的交互式 Shell（Interactive Shell）。如果 Agent 正在执行长任务（如 `npm install`），该 Shell 会被占用，此时若尝试通过该 Shell 执行 `ls` 会导致阻塞或失败。

**解决方案**：
1.  **修改 `DockerManager`**：在 `trae_agent/agent/docker_manager.py` 中，取消注释并暴露 `execute_stateless(command)` 方法。
2.  **原理**：使用 `docker exec` (Python SDK `container.exec_run`) 创建一个新的进程。
3.  **并发性**：Docker 容器允许多个 `exec` 进程同时运行，因此文件查询操作不会被 Agent 的长任务阻塞。

## 6. 总结

使用 CLI 的 Docker 功能（即 `DockerManager`）来为每个 Session 创建独立容器，是**完全正确且推荐**的方向。它将从根本上解耦服务逻辑与执行环境，解决您遇到的所有“互斥”、“卡死”和“多租户干扰”问题。
