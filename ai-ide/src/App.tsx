import React from 'react';
import { Settings, File as FileIcon } from 'lucide-react';
import { FileTree } from './components/FileTree';
import { CodeEditor } from './components/CodeEditor';
import { SystemSettings } from './components/SystemSettings';
import { useAppStore, Session } from './lib/store';
import { apiClient } from './lib/api';
import RuntimeLogPanel from './components/RuntimeLogPanel';
 
 

// Add error boundary to handle network issues
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-background">
          <div className="text-center p-8">
            <h1 className="text-2xl font-bold text-destructive mb-4">应用错误</h1>
            <p className="text-muted-foreground mb-4">
              {this.state.error?.message || '发生了未知错误'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    
    return this.props.children;
  }
}

function App() {
  const { 
    currentSessionId, 
    workspaceRoot, 
    systemPrompt,
    setWorkspaceRoot, 
    setFileTree, 
    setSessions,
    setCurrentSession,
    updateSession,
    setSystemPrompt,
    sessions,
    addOpenFile,
    setActiveFile
  } = useAppStore();
  
  const [isStreaming, setIsStreaming] = React.useState(false);
  // Removed: currentSteps state; using system toasts for streaming updates
  const [isBackendAvailable, setIsBackendAvailable] = React.useState(true);

  const appendMessage = (text: string, type: 'system' | 'error' | 'user' | 'agent' = 'system', sid?: string) => {
    const sessId = sid || currentSessionId;
    if (!sessId || !text.trim()) return;
    const msg = {
      id: ((globalThis.crypto && 'randomUUID' in globalThis.crypto) ? (globalThis.crypto as any).randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`),
      type,
      content: text,
      timestamp: new Date(),
      sessionId: sessId,
    } as any;
    useAppStore.getState().appendSessionMessage(sessId, msg);
  };
  const [selectedProvider, setSelectedProvider] = React.useState<string>('openrouter');
  const [modelBaseUrl, setModelBaseUrl] = React.useState<string>('http://10.0.2.22:9997/v1');
  const [modelName, setModelName] = React.useState<string>('Qwen3-32B');
  const [apiKey, setApiKey] = React.useState<string>('sk-xinference');
  const [savedModels, setSavedModels] = React.useState<Array<{ name: string; provider: string; baseUrl: string; model: string; apiKey: string }>>([
    { name: 'Xinference-OpenRouter-Qwen3', provider: 'openrouter', baseUrl: 'http://10.0.2.22:9997/v1', model: 'Qwen3-32B', apiKey: 'sk-xinference' },
  ]);
  const [selectedModelName, setSelectedModelName] = React.useState<string>('Xinference-OpenRouter-Qwen3');
  const [isSystemSettingsOpen, setIsSystemSettingsOpen] = React.useState(false);
  const [systemPrompts, setSystemPrompts] = React.useState<Array<{id: string, name: string, content: string}>>([]);
  const [selectedPromptName, setSelectedPromptName] = React.useState<string | undefined>(undefined);
  const [isModelModalOpen, setIsModelModalOpen] = React.useState(false);
  const [isCreatingModel, setIsCreatingModel] = React.useState(false);
  const [isCommandOpen, setIsCommandOpen] = React.useState(false);
  const [commandText, setCommandText] = React.useState('');
  const [commandAttachments, setCommandAttachments] = React.useState<Array<{display: string; token: string}>>([]);
  const [qualityReviewEnabled, setQualityReviewEnabled] = React.useState<boolean>(false);
  const [qualityReviewRules, setQualityReviewRules] = React.useState<string>("");
  const [promptView, setPromptView] = React.useState<{open: boolean; name: string; content: string} | null>(null);
  const [promptEdit, setPromptEdit] = React.useState<{open: boolean; name: string; content: string; enable_quality_review?: boolean; quality_review_rules?: string} | null>(null);

  // Initialize workspace and create initial session
  React.useEffect(() => {
    const initializeApp = async () => {
      try {
        const workspaces = await apiClient.listWorkspaces();
        const selectedWorkspace = workspaces[0] || '/workspace';
        setWorkspaceRoot(selectedWorkspace);
        setIsBackendAvailable(true);
        
        // Load file tree
        const files = await apiClient.listFiles(selectedWorkspace);
        if (files.length > 0) {
          const tree = files.map(file => ({
            name: file.name,
            path: file.path,
            type: file.type,
            size: file.size,
            modified: file.modified,
            children: file.type === 'directory' ? [] : undefined,
            isExpanded: false,
            isLoading: false,
          }));
          setFileTree(tree);
        } else {
          setFileTree([]);
        }

        // Create initial session if none exists
        if (!currentSessionId && sessions.length === 0) {
          await createNewSession(selectedWorkspace);
        }

        try {
          const list = await apiClient.listStoredPrompts();
          const items = await Promise.all(list.map(async (p) => {
            try {
              const full = await apiClient.getStoredPromptById(p.id);
              return { id: String(full.id), name: full.name, content: full.content };
            } catch {
              return { id: String(p.id), name: p.name, content: '' };
            }
          }));
          setSystemPrompts(items);
          if (items.length > 0) {
            setSelectedPromptName(items[0].name);
            try {
              const obj = JSON.parse(items[0].content);
              if (typeof obj.enable_quality_review === 'boolean') setQualityReviewEnabled(!!obj.enable_quality_review);
              if (typeof obj.quality_review_rules === 'string') setQualityReviewRules(obj.quality_review_rules);
            } catch { void 0; }
          }
        } catch { void 0; }
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setIsBackendAvailable(false);
        appendMessage('初始化应用失败，请确保后端服务正常运行', 'error');
        // Fallback to container workspace
        const fallbackWorkspace = '/workspace';
        setWorkspaceRoot(fallbackWorkspace);
        setFileTree([]);
        // Try to create session with fallback workspace
        if (!currentSessionId && sessions.length === 0) {
          await createNewSession(fallbackWorkspace);
        }
      }
    };

    initializeApp();
  }, [setWorkspaceRoot, setFileTree, currentSessionId, sessions.length]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const wasOpen = isCommandOpen;
        setIsCommandOpen(!wasOpen);
        if (!wasOpen && !currentSessionId) {
          setCommandText('-create session');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentSessionId, isCommandOpen]);

  // Removed: Cmd+Shift+J toggle for message console



  const handleTestConnectivity = async () => {
    try {
      await apiClient.testModelConnectivity({
        provider: selectedProvider,
        model: modelName,
        model_base_url: modelBaseUrl,
        api_key: apiKey,
      });
      appendMessage('模型连通性测试通过');
    } catch (e) {
      try {
        const fallbackUrl = 'http://host.docker.internal:9997/v1';
        await apiClient.testModelConnectivity({
          provider: selectedProvider,
          model: modelName,
          model_base_url: fallbackUrl,
          api_key: apiKey,
        });
        setModelBaseUrl(fallbackUrl);
        appendMessage('模型连通性测试通过(已切换备用Base URL)');
      } catch {
        appendMessage('模型连通性测试失败', 'error');
      }
    }
  };

  const handleSaveModel = () => {
    const name = `${selectedProvider}-${modelName}`;
    const item = { name, provider: selectedProvider, baseUrl: modelBaseUrl, model: modelName, apiKey };
    setSavedModels((prev) => {
      const others = prev.filter((m) => m.name !== name);
      return [...others, item];
    });
    setSelectedModelName(name);
    appendMessage('模型配置已保存');
  };

  // System Settings Functions
  const handleSaveSystemPrompt = async (prompt: {id: string, name: string, content: string}) => {
    try {
      await apiClient.writeStoredPrompt(prompt.name, prompt.content);
      const list = await apiClient.listStoredPrompts();
      const items = await Promise.all(list.map(async (p) => {
        try {
          const full = await apiClient.getStoredPromptById(p.id);
          return { id: String(full.id), name: full.name, content: full.content };
        } catch {
          return { id: String(p.id), name: p.name, content: '' };
        }
      }));
      setSystemPrompts(items);
      setSelectedPromptName(prompt.name);
      appendMessage('系统提示词已保存');
    } catch (e) {
      appendMessage('保存失败', 'error');
    }
  };

  const handleDeleteSystemPrompt = async (name: string) => {
    try {
      await apiClient.deleteStoredPrompt(name);
      const list = await apiClient.listStoredPrompts();
      const items = await Promise.all(list.map(async (p) => {
        try {
          const full = await apiClient.getStoredPromptById(p.id);
          return { id: String(full.id), name: full.name, content: full.content };
        } catch {
          return { id: String(p.id), name: p.name, content: '' };
        }
      }));
      setSystemPrompts(items);
      if (selectedPromptName === name) {
        setSelectedPromptName(undefined);
        setSystemPrompt('DOCUMENT_AGENT_SYSTEM_PROMPT');
        setQualityReviewEnabled(false);
        setQualityReviewRules('');
      }
      appendMessage('模式配置已删除');
    } catch {
      appendMessage('删除失败', 'error');
    }
  };


  const handleModelConfigChange = (config: {provider: string, model: string, apiKey: string, baseUrl?: string}) => {
    setSelectedProvider(config.provider);
    setModelName(config.model);
    setApiKey(config.apiKey);
    if (config.baseUrl) {
      setModelBaseUrl(config.baseUrl);
    }
  };

  const createNewSession = async (workspacePath?: string, onlineMode?: boolean) => {
    try {
      const chosen = savedModels.find((m) => m.name === selectedModelName) || {
        provider: selectedProvider,
        baseUrl: modelBaseUrl,
        model: modelName,
        apiKey,
      } as any;
      const session = await apiClient.startInteractiveSession({
        working_dir: workspacePath || workspaceRoot,
        agent_type: 'trae_agent',
        max_steps: 20,
        provider: chosen.provider,
        model: chosen.model,
        model_base_url: chosen.baseUrl,
        api_key: chosen.apiKey,
        prompt: systemPrompt as any,
        agent_mode_config: { mode_name: selectedPromptName, system_prompt: (selectedPromptName || systemPrompt) as any },
        console_type: 'lakeview',
        enable_quality_review: qualityReviewEnabled,
        quality_review_rules: qualityReviewRules,
        use_online_mode: !!onlineMode,
      });
      
      const newSession: Session = {
        id: session.session_id,
        name: `会话 ${new Date().toLocaleString()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        workingDir: session.working_dir,
        configFile: session.config_file,
        status: 'active',
        messages: [],
        systemPrompt: systemPrompt,
      };
      
      setSessions([newSession]);
      setCurrentSession(session.session_id);
      return session.session_id;
    } catch (error) {
      console.error('Failed to create session:', error);
      appendMessage('创建会话失败，请确保后端服务正常运行', 'error');
      return null;
    }
  };

  const handleSendMessage = async (message: string, useStreaming: boolean) => {
    const trimmed = message.trim();
    if (trimmed.startsWith('-create session')) {
      const online = trimmed.includes('-online');
      const sid = await createNewSession(undefined, online);
      if (sid) appendMessage(online ? '新会话已创建（在线模式）' : '新会话已创建', 'system', sid);
      return;
    }
    if (message.trim() === '-kill') {
      if (!currentSessionId) {
        appendMessage('无活动会话可关闭', 'error');
        return;
      }
      try {
        await apiClient.closeInteractiveSession(currentSessionId);
        updateSession(currentSessionId, { status: 'completed' });
        setCurrentSession('');
        setIsStreaming(false);
        appendMessage('当前会话已关闭');
      } catch (e) {
        appendMessage('关闭会话失败', 'error');
      }
      return;
    }
    let sessionId = currentSessionId;
    const makeMsgId = () => (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? (globalThis.crypto as any).randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    
    if (!sessionId) {
      sessionId = await createNewSession();
      if (!sessionId) {
        return;
      }
    }

    if (useStreaming) {
      setIsStreaming(true);
      
      try {
        const extractAttachments = (text: string) => {
          const out: string[] = [];
          const ws = Array.from(text.matchAll(/\[workspace:([^\]]+)\]/g)).map(m => m[1]);
          ws.forEach(p => {
            const rel = p.replace(/^\/workspace\/?/, '');
            out.push(`file:${rel}`);
          });
          const on = Array.from(text.matchAll(/\[online:documentId=([^ \]]+)/g)).map(m => m[1]);
          on.forEach(id => out.push(`online:${id}`));
          return out;
        };
        const stripTokens = (text: string) => text.replace(/\[[^\]]+\]/g, '').trim();
        const attachments = extractAttachments(message);
        const clean = stripTokens(message);
        const hashId = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); h &= 0xffffffff; } return Math.abs(h).toString(16); };
        const userId = `user_${hashId('user:user')}`;
        const agentId = `agent_${hashId(selectedModelName || modelName)}`;
        useAppStore.getState().appendSessionMessage(sessionId, {
          id: makeMsgId(),
          type: 'user' as const,
          content: clean,
          attachments,
          timestamp: new Date(),
          sessionId: sessionId,
          metadata: { user_id: userId, agent_id: agentId }
        } as any);

        const selectedPromptText = (() => {
          if (!selectedPromptName) return undefined;
          const found = systemPrompts.find(p => p.name === selectedPromptName);
          if (!found) return undefined;
          try {
            const obj = JSON.parse(found.content);
            return typeof obj.text === 'string' ? obj.text : found.content;
          } catch {
            return found.content;
          }
        })();

        // Event-driven: use interactive WS bubbles directly; show as system toasts
        await apiClient.runInteractiveTaskWS(
          {
            session_id: sessionId,
            task: message,
            working_dir: workspaceRoot,
            prompt: (selectedPromptText || systemPrompt) as any,
            agent_mode_config: { mode_name: selectedPromptName, system_prompt: (selectedPromptText || systemPrompt) as any },
            enable_quality_review: qualityReviewEnabled,
            quality_review_rules: qualityReviewRules,
          },
          (data) => {
            console.log('Stream data received:', data);
            
            // Debug: Log the raw data structure
            if (data.type === 'step' && data.data.llm_response) {
              console.log('LLM Response Debug:', {
                content_excerpt: JSON.stringify(data.data.llm_response.content_excerpt),
                content_length: data.data.llm_response.content_excerpt?.length,
                finish_reason: data.data.llm_response.finish_reason,
                model: data.data.llm_response.model,
                usage: data.data.llm_response.usage
              });
            }
            
            if (data.type === 'start') {
              // Ignore start path announcements in UI to avoid overshadowing the user's task message.
              return;
            }
          if (data.type === 'bubble' && data.data) {
            const role = (data.data.role || 'agent') as 'user' | 'agent' | 'system' | 'error';
            const content = String(data.data.content || '').trim();
            const bubbleId = String(data.data.id || '');
            useAppStore.getState().upsertSessionBubble(sessionId, bubbleId || makeMsgId(), {
              id: bubbleId || makeMsgId(),
              type: role,
              content: content,
            } as any);
            return;
          }
            if (data.type === 'step' && data.data) {
              // Step events are broken down into bubble messages by the server (content/reflection/tool calls/taskdone).
              // Frontend ignores raw step aggregation to avoid overriding user/bubble messages.
              return;
            }
            if (data.type === 'completed') {
              setIsStreaming(false);
              return;
            }
          }
        );
      } catch (error) {
        console.error('Failed to run task:', error);
        appendMessage('执行任务失败，请检查后端服务状态', 'error');
        setIsStreaming(false);
      }
    }
  };

  const handleFileSelect = async (filePath: string) => {
    try {
      const toRelative = (p: string) => {
        if (!p) return '';
        if (p.startsWith(workspaceRoot)) {
          const rel = p.slice(workspaceRoot.length);
          return rel.startsWith('/') ? rel.slice(1) : rel;
        }
        if (p.startsWith('/workspace')) {
          const rel = p.replace(/^\/workspace\/?/, '');
          return rel;
        }
        return p;
      };

      const relativePath = toRelative(filePath);
      const absolutePath = filePath.startsWith('/') ? filePath : `${workspaceRoot}/${filePath}`;
      
      console.log('Reading file with absolute path:', absolutePath);
      console.log('Using workspace root:', workspaceRoot);
      console.log('Relative path for API:', relativePath);
      
      // Use the /api/file endpoint with proper workspace and file parameters
      // This follows the backend recommendation to use workspace as working_dir and file as relative path
      const fileData = await apiClient.readFile(workspaceRoot, relativePath || filePath); // Prefer relative path
      
      // Store the file content in the editor
      console.log('File selected:', filePath, fileData);
      
      // Add file content to editor store
      if (fileData.content) {
        console.log('File content loaded:', fileData.content.substring(0, 100) + '...');
        
        // Create editor file object
        const editorFile = {
          path: filePath,
          content: fileData.content,
          isDirty: false,
          language: getFileLanguage(filePath)
        };
        
        // Add to open files and set as active
        addOpenFile(editorFile);
        setActiveFile(relativePath || filePath);
        appendMessage(`文件 ${(relativePath || filePath)} 加载成功`);
      } else {
        appendMessage('文件内容为空');
      }
    } catch (error: any) {
      console.error('Failed to read file:', error);
      if (error.response?.status === 404) {
        const rp = filePath.startsWith(workspaceRoot)
          ? filePath.slice(workspaceRoot.length).replace(/^\//, '')
          : filePath.startsWith('/workspace')
            ? filePath.replace(/^\/workspace\/?/, '')
            : filePath;
        appendMessage(`文件不存在: ${rp}`, 'error');
      } else if (error.response?.status === 403) {
        appendMessage('没有权限读取该文件', 'error');
      } else {
        appendMessage(`读取文件失败: ${error.message}`, 'error');
      }
    }
  };

  // Helper function to determine file language
  const getFileLanguage = (filePath: string): string => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': return 'javascript';
      case 'ts': return 'typescript';
      case 'tsx': return 'typescript';
      case 'jsx': return 'javascript';
      case 'py': return 'python';
      case 'md': return 'markdown';
      case 'json': return 'json';
      case 'yaml':
      case 'yml': return 'yaml';
      case 'html': return 'html';
      case 'css': return 'css';
      default: return 'plaintext';
    }
  };

  if (!isBackendAvailable) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center p-8 max-w-md">
          <div className="text-6xl mb-4">🔌</div>
          <h1 className="text-2xl font-bold text-destructive mb-4">连接失败</h1>
          <p className="text-muted-foreground mb-6">
            无法连接到后端服务。请确保Docker容器正在运行，并且API服务在端口8090上可用。
          </p>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>• 检查Docker容器状态: <code className="bg-muted px-2 py-1 rounded">docker ps</code></p>
            <p>• 确认API服务运行: <code className="bg-muted px-2 py-1 rounded">curl http://localhost:8090/health</code></p>
            <p>• 重启应用: <code className="bg-muted px-2 py-1 rounded">npm run dev</code></p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            重新连接
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col bg-background">
        
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-background">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">AI IDE</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSystemSettingsOpen(true)}
              className="p-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
              disabled={isStreaming}
              aria-label="系统设置"
              title="系统设置"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>

        {isCommandOpen && (
          <div className="border-b bg-background h-[80px] flex items-center gap-2 px-3">
            <div
              className="flex items-center flex-1 gap-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                try {
                  const raw = e.dataTransfer.getData('text/plain');
                  const obj = JSON.parse(raw);
                  if (obj && typeof obj === 'object') {
                    let display = '';
                    let token = '';
                    if (obj.type === 'workspace') {
                      display = `file:${obj.path}`;
                      token = `[workspace:${obj.absolute}]`;
                    } else if (obj.type === 'online') {
                      display = `online:${obj.documentId}`;
                      token = `[online:documentId=${obj.documentId} tool=online_doc_tool command=detail arguments={"document_id":"${obj.documentId}"}]`;
                    }
                    if (display && token) {
                      setCommandAttachments((prev) => [...prev, { display, token }]);
                    }
                  }
                } catch { /* noop */ }
              }}
            >
              {commandAttachments.map((att, idx) => (
                <div key={idx} className="flex items-center gap-1 px-2 py-1 bg-muted rounded">
                  <FileIcon className="h-4 w-4" />
                  <span className="text-xs">{att.display}</span>
                  <button
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCommandAttachments((prev) => prev.filter((_, i) => i !== idx));
                    }}
                    title="移除"
                  >移除</button>
                </div>
              ))}
              <input
                autoFocus
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (commandText.trim() || commandAttachments.length)) {
                    const tokens = commandAttachments.map((a) => a.token).join(' ');
                    const msg = tokens ? `${commandText.trim()} ${tokens}`.trim() : commandText.trim();
                    handleSendMessage(msg, true);
                    setCommandText('');
                    setCommandAttachments([]);
                    setIsCommandOpen(false);
                  } else if (e.key === 'Escape') {
                    setIsCommandOpen(false);
                  }
                }}
                placeholder="输入命令或拖拽文件到此 (Cmd+Shift+K 打开)"
                className="flex-1 px-3 py-2 border rounded text-sm bg-background"
              />
            </div>
          </div>
        )}
        
        <div className="flex-1 flex overflow-hidden">
          <div className="w-64 border-r bg-muted/30 flex flex-col overflow-hidden">
            <FileTree onFileSelect={handleFileSelect} />
          </div>
          <div className="flex-1 flex flex-col">
            <div className="flex-1 border-b overflow-auto">
              <CodeEditor />
            </div>
            
          </div>
        </div>

        {/* Runtime Log Panel (Cmd+Shift+J) */}
        <RuntimeLogPanel />

        {isModelModalOpen && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="bg-background border rounded-md shadow-xl w-[720px] max-w-[90vw]">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h2 className="text-lg font-semibold">模型管理</h2>
                <button onClick={() => setIsModelModalOpen(false)} className="text-sm text-muted-foreground">关闭</button>
              </div>
              {!isCreatingModel ? (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">已保存模型</span>
                    <button onClick={() => setIsCreatingModel(true)} className="px-2 py-1 text-xs bg-muted rounded">新建模型</button>
                  </div>
                  <div className="max-h-[300px] overflow-auto border rounded">
                    {savedModels.length === 0 && (
                      <div className="p-4 text-sm text-muted-foreground">暂无已保存模型</div>
                    )}
                    {savedModels.map((m) => (
                      <div key={m.name} className="flex items-center justify-between px-3 py-2 hover:bg-muted/30">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{m.name}</span>
                          <span className="text-xs text-muted-foreground">{m.provider} · {m.model} · {m.baseUrl}</span>
                        </div>
                        <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedModelName(m.name);
                        setSelectedProvider(m.provider);
                        setModelBaseUrl(m.baseUrl);
                        setModelName(m.model);
                        setApiKey(m.apiKey);
                        appendMessage('模型已选中');
                      }}
                      className="px-2 py-1 text-xs bg-secondary rounded"
                    >选中</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setIsModelModalOpen(false)} className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded">确认</button>
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <label className="text-sm w-28">客户端</label>
                    <select
                      value={selectedProvider}
                      onChange={(e) => setSelectedProvider(e.target.value)}
                      className="px-2 py-1 border rounded text-sm bg-background flex-1"
                    >
                      <option value="openrouter">OpenRouter / Xinference</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm w-28">Base URL</label>
                    <input
                      type="text"
                      value={modelBaseUrl}
                      onChange={(e) => setModelBaseUrl(e.target.value)}
                      placeholder="http://host:port/v1"
                      className="px-2 py-1 border rounded text-sm bg-background flex-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm w-28">Model Name</label>
                    <input
                      type="text"
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                      placeholder="Qwen3-32B"
                      className="px-2 py-1 border rounded text-sm bg-background flex-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm w-28">API Key</label>
                    <input
                      type="text"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="px-2 py-1 border rounded text-sm bg-background flex-1"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={handleTestConnectivity} className="px-3 py-1 text-sm bg-secondary rounded">测试</button>
                    <button onClick={() => { handleSaveModel(); setIsCreatingModel(false); }} className="px-3 py-1 text-sm bg-muted rounded">保存</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        

        {/* Removed message console; WS bubbles are shown as system toasts */}
        
            {/* System Settings Dialog */}
            <SystemSettings
              open={isSystemSettingsOpen}
              onOpenChange={setIsSystemSettingsOpen}
              systemPrompts={systemPrompts}
              selectedPromptName={selectedPromptName}
              onPromptChange={setSystemPrompt}
              onSelectPrompt={setSelectedPromptName}
              onSavePrompt={handleSaveSystemPrompt}
              onDeletePrompt={handleDeleteSystemPrompt}
              modelConfig={{
                provider: selectedProvider,
                model: modelName,
                apiKey: apiKey,
                baseUrl: modelBaseUrl
              }}
              onModelConfigChange={handleModelConfigChange}
              qualityReviewEnabled={qualityReviewEnabled}
              qualityReviewRules={qualityReviewRules}
              onQualityReviewEnabledChange={setQualityReviewEnabled}
              onQualityReviewRulesChange={setQualityReviewRules}
              onViewPrompt={async (name: string) => {
                  try {
                    const found = systemPrompts.find(p => p.name === name);
                    if (!found) throw new Error('Prompt not found');
                    const full = await apiClient.getStoredPromptById(Number(found.id));
                    setPromptView({ open: true, name: full.name, content: full.content });
                  } catch {
                  appendMessage('获取详情失败', 'error');
                  }
                }}
                onEditPrompt={async (name: string) => {
                  try {
                    const found = systemPrompts.find(p => p.name === name);
                    if (!found) throw new Error('Prompt not found');
                    const full = await apiClient.getStoredPromptById(Number(found.id));
                    let payload: any = {};
                    try { payload = JSON.parse(full.content); } catch { void 0; }
                    setPromptEdit({ open: true, name: full.name, content: (payload.text ?? full.content), enable_quality_review: !!payload.enable_quality_review, quality_review_rules: (payload.quality_review_rules ?? '') });
                  } catch {
                  appendMessage('获取详情失败', 'error');
                  }
                }}
            />

      {/* Prompt View Modal */}
      {promptView?.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setPromptView(null)}>
          <div className="bg-background border rounded-md shadow-xl w-[720px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="text-lg font-semibold">模式详情</h2>
              <button onClick={() => setPromptView(null)} className="text-sm text-muted-foreground">关闭</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-sm text-muted-foreground">名称</div>
              <div className="text-sm">{promptView.name}</div>
              <div className="text-sm text-muted-foreground mt-2">内容</div>
              <pre className="text-sm whitespace-pre-wrap break-words border rounded p-3 max-h-[300px] overflow-auto">{(() => { try { const o = JSON.parse(promptView.content); return String(o.text ?? promptView.content); } catch { return promptView.content; } })()}</pre>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <div className="text-sm text-muted-foreground">是否开启质量审查</div>
                  <div className="text-sm">{(() => { try { const o = JSON.parse(promptView.content); return o.enable_quality_review ? '是' : '否'; } catch { return '否'; } })()}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">审查规则</div>
                  <div className="text-sm break-words">{(() => { try { const o = JSON.parse(promptView.content); return o.quality_review_rules || ''; } catch { return ''; } })()}</div>
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={() => setPromptView(null)} className="px-3 py-1 text-sm bg-muted rounded">关闭</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Edit Modal */}
      {promptEdit?.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setPromptEdit(null)}>
          <div className="bg-background border rounded-md shadow-xl w-[720px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="text-lg font-semibold">修改模式</h2>
              <button onClick={() => setPromptEdit(null)} className="text-sm text-muted-foreground">关闭</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-sm text-muted-foreground">名称</div>
              <div className="text-sm">{promptEdit.name}</div>
              <div className="text-sm text-muted-foreground mt-2">内容</div>
              <textarea
                value={promptEdit.content}
                onChange={(e) => setPromptEdit({ ...promptEdit, content: e.target.value })}
                className="w-full border rounded p-2 text-sm min-h-[160px]"
              />
              <div className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={!!promptEdit.enable_quality_review} onChange={(e) => setPromptEdit({ ...promptEdit, enable_quality_review: e.target.checked })} />
                <span className="text-sm">启用质量审查</span>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">审查规则</div>
                <textarea value={promptEdit.quality_review_rules || ''} onChange={(e) => setPromptEdit({ ...promptEdit, quality_review_rules: e.target.value })} className="w-full border rounded p-2 text-sm min-h-[100px]" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPromptEdit(null)} className="px-3 py-1 text-sm bg-muted rounded">取消</button>
                <button
                  onClick={async () => {
                    try {
                      const payload = {
                        text: promptEdit.content,
                        enable_quality_review: !!promptEdit.enable_quality_review,
                        quality_review_rules: promptEdit.quality_review_rules || ''
                      };
                      await apiClient.writeStoredPrompt(promptEdit.name, JSON.stringify(payload));
                      const list = await apiClient.listStoredPrompts();
                      const items = await Promise.all(list.map(async (p) => {
                        try {
                          const full = await apiClient.getStoredPromptById(p.id);
                          return { id: String(full.id), name: full.name, content: full.content };
                        } catch {
                          return { id: String(p.id), name: p.name, content: '' };
                        }
                      }));
                      setSystemPrompts(items);
                      appendMessage('提示词已更新');
                      setPromptEdit(null);
                    } catch {
                      appendMessage('更新失败', 'error');
                    }
                  }}
                  className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded"
                >保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}

export default App;
