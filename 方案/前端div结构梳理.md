# 前端 div 结构梳理（AI IDE）

## 顶层布局
- 名称：根布局容器
- 位置：`ai-ide/src/App.tsx:1002`
- 结构与样式：`div.h-screen.flex.flex-col.bg-background`
- 作用：应用整体垂直布局；包含 Header、主体区域
- 大小：高度占满屏幕（`h-screen`），宽度占满（默认）

## Header
- 名称：头部导航栏
- 位置：`ai-ide/src/App.tsx:1006-1032`
- 结构与样式：`div.flex.items-center.justify-between.p-4.border-b.bg-background`
- 作用：显示标题与系统设置、会话操作按钮
- 大小：内容自适应高度，宽度全屏；底部边框分隔

## 主体区域
- 名称：主内容容器
- 位置：`ai-ide/src/App.tsx:1034`
- 结构与样式：`div.flex-1.flex.overflow-hidden`
- 作用：左右分栏：左侧文件树，右侧工作区（编辑器 + 消息控制台）
- 大小：高度填满剩余空间（`flex-1`），溢出隐藏

### 左侧文件树
- 名称：文件树侧栏容器
- 位置：`ai-ide/src/App.tsx:1035`；组件实现 `ai-ide/src/components/FileTree.tsx`
- 结构与样式：`div.w-64.border-r.bg-muted/30.flex.flex-col.overflow-hidden`
- 作用：工作区文件导航与操作（刷新、返回根目录、上传/新建）
- 大小：固定宽度 `w-64`（约 256px），高度随父容器填满
- 工具栏按钮横向分布：`ai-ide/src/components/FileTree.tsx:166-188`

### 右侧工作区
- 名称：工作区容器
- 位置：`ai-ide/src/App.tsx:1038`
- 结构与样式：`div.flex-1.flex.flex-col`
- 作用：上方代码编辑区，下方消息控制台
- 大小：宽度自适应，垂直方向两块区域（编辑区 `flex-1` + 控制台固定高）

#### 代码编辑区（上）
- 名称：编辑器区域容器
- 位置：`ai-ide/src/App.tsx:1039-1041`；组件实现 `ai-ide/src/components/CodeEditor.tsx`
- 结构与样式：`div.flex-1.border-b`
- 作用：文件编辑、Markdown 编辑/分屏/预览切换
- 大小：在工作区内占剩余高度（`flex-1`）

编辑器内部结构：
- 标签栏与工具条：`ai-ide/src/components/CodeEditor.tsx:132-222`
  - 结构：`div.flex.items-center.bg-muted.border-b`
  - 内容：文件标签、Markdown 模式切换（编辑/分屏/预览）、保存按钮
  - 大小：水平自适应，高度由内容决定
- 内容区：`ai-ide/src/components/CodeEditor.tsx:226-291`
  - 结构：`div.flex-1.flex`
  - 模式：
    - 分屏：`div.flex.h-full.min-h-0`（`CodeEditor.tsx:229`）
      - 左侧编辑器：`div.flex-1.border-r.overflow-y-auto`（`CodeEditor.tsx:231-248`）
      - 右侧预览：`div.flex-1.overflow-y-auto.min-h-0`（`CodeEditor.tsx:251-267`）
        - 隐藏切换：当 `isPreviewHidden` 为真时追加 `hidden`（`CodeEditor.tsx:251-257`）
    - 预览：已移除（统一为编辑/分屏两种状态）
    - 编辑：`Editor` 独占，`height="100%"`（`CodeEditor.tsx:273-288`）

Markdown 预览组件：
- 容器：`ai-ide/src/components/MarkdownPreview.tsx:220-241`
  - 外层滚动区：`div.flex-1.overflow-y-auto.text-foreground`（继承父宽度与高度）
  - 内容区：`div.prose.max-w-none.p-6.dark:prose-invert`（`MarkdownPreview.tsx:233-241`）
  - 说明：`max-w-none` 确保不限制最大宽度，预览模式下可填满可用宽度

#### 消息控制台（顶层覆盖）
- 名称：消息控制台覆盖层
- 位置：顶层覆盖渲染（`ai-ide/src/App.tsx:1163-1184` 之后追加的覆盖层）；组件实现 `ai-ide/src/components/StreamingConsole.tsx`
- 结构与样式：`div.fixed.inset-0`，内部对齐底部：`div.w-full.h-[40%].bg-background.border-t.shadow-lg`
- 作用：显示用户与 Agent 的消息、步骤输出；采用消息气泡样式，覆盖下层编辑区/分屏区
- 大小：覆盖层底部占 40% 高度，可滚动
- 显示/隐藏：状态 `isConsoleOpen` 控制；快捷键 `Cmd+Shift+M` 切换
- 气泡样式：`ai-ide/src/components/StreamingConsole.tsx:96-116`（圆角、背景、边框）

## 快捷键与显示切换
- 呼出命令对话框：`Cmd+Shift+K`（`ai-ide/src/App.tsx:60-87`）
- 控制台覆盖层显示/隐藏：`Cmd/Ctrl+Shift+M`（`ai-ide/src/App.tsx:60-87`）
- Markdown 预览隐藏：`ai-ide/src/components/CodeEditor.tsx:52-59, 251-257`

## 问题定位建议
- 预览模式：已删除，统一为编辑/分屏，宽度填满可用区域（`MarkdownPreview.tsx:233-241`）。
- 快捷键无效：若在 macOS 上无效，确认顶层 `window` 监听是否被阻止；当前实现在 `App.tsx:60-87` 与 `CodeEditor.tsx:52-59` 通过 `window.addEventListener('keydown', ...)` 捕获，优先保证全局响应；若依然异常，考虑在具体容器上注册捕获或禁用编辑器内的快捷占用。

## 参考代码位置
- 根布局：`ai-ide/src/App.tsx:1002`
- Header：`ai-ide/src/App.tsx:1006-1032`
- 主体容器：`ai-ide/src/App.tsx:1034`
- 左侧文件树：`ai-ide/src/App.tsx:1035`，工具栏横向：`ai-ide/src/components/FileTree.tsx:166-188`
- 右侧工作区：`ai-ide/src/App.tsx:1038`
- 编辑器区域：`ai-ide/src/App.tsx:1039-1041`，内部结构：`ai-ide/src/components/CodeEditor.tsx:132-291`
- Markdown 预览：`ai-ide/src/components/MarkdownPreview.tsx:220-241`
- 消息控制台：`ai-ide/src/App.tsx:1042-1048`，组件渲染：`ai-ide/src/components/StreamingConsole.tsx:86-124`