# 差异预览与差异确认（Trae IDE最佳实践）

## 目标
- 实时刷新文件列表并感知新增/修改/删除。
- 预览文件内容与差异，采用统一 `git diff` 呈现。
- 更改需用户确认；拒绝后回退到修改前版本。

## 架构原则
- 以工作空间为粒度管理版本，尽量不引入额外依赖。
- 由 Agent 的编辑工具写入前创建快照，写入后生成差异。
- 前端通过 SSE 订阅文件变更事件，驱动 UI 实时刷新。

## 核心流程
1. 初始化版本库：
   - 若工作空间非 Git 仓库，初始化临时仓库并建立初始提交。
2. 编辑前快照：
   - 在写入前对目标文件执行 `git add` 并创建轻量快照标识 `snapshot_id`。
3. 执行写入：
   - 编辑工具完成写入。
4. 生成差异：
   - 通过 `git diff --unified` 获取差异文本和结构化摘要（新增/删除/修改块）。
5. 前端展示与确认：
   - 前端展示差异与文件预览，用户“接受/拒绝”。
6. 应用或回退：
   - 接受：执行 `git commit`，标记为已确认。
   - 拒绝：执行 `git restore --source=<snapshot_id>` 或回滚写入文件到快照内容。
7. 广播事件：
   - 通过 SSE 推送状态变化与目录刷新事件。

## 后端接口
- `POST /fs/snapshot/create`
  - 入参：`path`
  - 出参：`snapshot_id`
- `GET /fs/diff?path=<file>&snapshot_id=<id>`
  - 出参：`unified_diff`、`changes_summary`
- `POST /fs/confirm`
  - 入参：`snapshot_id`
  - 效果：提交更改并清理快照。
- `POST /fs/revert`
  - 入参：`snapshot_id`
  - 效果：回退文件到快照版本。
- `GET /fs/changes/stream`
  - SSE 推送：文件新增、修改、删除、确认、回退事件。

## Agent 工具挂钩
- 在 `write_file` 之前调用 `snapshot/create`，获取 `snapshot_id`。
- 在 `write_file` 之后，调用 `diff` 返回差异文本与摘要，并在工具结果中附带 `snapshot_id`。
- 前端基于 `snapshot_id` 拉取差异，实现确认或回退。

## 前端实现
- 文件树：订阅 `fs/changes/stream`，接收事件后刷新列表。
- 详情面板：显示当前文件内容与 `git diff` 结果，提供“接受/拒绝”。
- 交互：
  - 接受→`POST /fs/confirm`，更新状态并广播事件。
  - 拒绝→`POST /fs/revert`，恢复旧版本并广播事件。

## 存储与容器
- 容器内挂载主机工作空间，Git 仓库与快照均位于挂载目录。
- 事件与差异计算在容器内完成，结果通过 API 返回。

## 兼容性与回退策略
- 若 Git 不可用，使用快照文件夹策略：写入前将旧内容复制到 `.trae/snapshots/<id>`；回退时直接覆盖目标文件。
- 差异生成仍采用 `difflib.unified_diff` 确保一致的呈现。

## 安全策略
- 路径校验限制在工作空间内。
- 快照与差异生成对大文件添加超时与大小限制。

## 成功标准
- 新文件创建后前端可立即看到列表刷新。
- 每次编辑后用户能看到 `git diff`，确认后提交，拒绝后回退。

