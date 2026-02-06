import React, { useEffect } from 'react';
import { Settings, File as FileIcon, Files, Moon, Sun, Maximize, Minimize, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Database, Workflow, GitBranch, Globe } from 'lucide-react';
import { ToolsPanel } from './components/ToolsPanel';
import { GitPanel } from './components/GitPanel';
import { OnlineDocPanel } from './components/OnlineDocPanel';
import { loader } from '@monaco-editor/react';
import { FileTree } from './components/FileTree';

// Configure Monaco Editor loader to use unpkg instead of jsdelivr (which is timing out)
loader.config({ paths: { vs: 'https://unpkg.com/monaco-editor@0.54.0/min/vs' } });

import { KnowledgeBaseManager } from './components/KnowledgeBaseManager';
import { KnowledgeRetrievalPanel } from './components/KnowledgeRetrievalPanel';
import { CodeEditor } from './components/CodeEditor';
// import { DiffViewer } from './components/DiffViewer'; // Removed as per refactoring
import { SettingsPage } from './components/SettingsPage';
import { ChatPanel } from './components/ChatPanel';
import { useAppStore, Session, Message } from './lib/store';
import { apiClient } from './lib/api';
import RuntimeLogPanel from './components/RuntimeLogPanel';

interface Tool {
  name: string;
  description: string;
  custom_name?: string;
  initial_name_zh?: string;
  is_custom?: boolean;
}
 
 

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
    setActiveFile,
    addPendingDiff,
    chatPanelCollapsed,
    toggleChatPanel,
    theme,
    setTheme,
    isFullscreen,
    toggleFullscreen,
    enabledTools,
    setEnabledTools
  } = useAppStore();
  
  const [activeSidebarItem, setActiveSidebarItem] = React.useState<string | null>('explorer');

  // Theme Effect
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!document.hidden) {
        // User switched back to this tab.
        // 1. Poll Git Status to see if anything changed while away
        try {
            // We can leverage GitPanel logic or just check modified files.
            // Let's fetch status and see if any open file is modified but not in diff mode.
            const res = await apiClient.gitStatus(workspaceRoot);
            const store = useAppStore.getState();
            const openFiles = store.openFiles;
            
            const modifiedPaths = new Set<string>();
            res.files.forEach(f => {
                if (f.status.includes('M') || f.status.includes('A')) {
                    modifiedPaths.add(f.path);
                }
            });
            
            for (const file of openFiles) {
                if (modifiedPaths.has(file.path) && !file.originalContent) {
                    // Fetch original content to enable diff view
                    const oldRes = await apiClient.gitShow(workspaceRoot, file.path, 'HEAD');
                    const newRes = await apiClient.readFile(workspaceRoot, file.path);
                    store.updateOpenFile(file.path, { 
                        content: newRes.content,
                        originalContent: oldRes.content 
                    });
                }
            }
        } catch (e) {
            console.error("Failed to sync git status on focus", e);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [workspaceRoot]);

  // Fullscreen Effect
  useEffect(() => {
    if (isFullscreen) {
      document.documentElement.requestFullscreen().catch((e) => {
        console.error('Failed to enter fullscreen:', e);
      });
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch((e) => {
          console.error('Failed to exit fullscreen:', e);
        });
      }
    }
  }, [isFullscreen]);

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
  const [isSystemSettingsOpen, setIsSystemSettingsOpen] = React.useState(false);
  const [systemPrompts, setSystemPrompts] = React.useState<Array<{id: string, name: string, content: string}>>([]);
  const [selectedPromptName, setSelectedPromptName] = React.useState<string | undefined>(undefined);
  const [isCommandOpen, setIsCommandOpen] = React.useState(false);
  const [commandText, setCommandText] = React.useState('');
  const [commandAttachments, setCommandAttachments] = React.useState<Array<{display: string; token: string}>>([]);
  const [qualityReviewEnabled, setQualityReviewEnabled] = React.useState<boolean>(false);
  const [qualityReviewRules, setQualityReviewRules] = React.useState<string>("");
  const [promptView, setPromptView] = React.useState<{open: boolean; name: string; content: string} | null>(null);
  const [promptEdit, setPromptEdit] = React.useState<{open: boolean; name: string; content: string; enable_quality_review?: boolean; quality_review_rules?: string} | null>(null);
  
  // Knowledge Retrieval State
  const [isKnowledgeRetrievalOpen, setIsKnowledgeRetrievalOpen] = React.useState(false);
  const [knowledgeRetrievalTarget, setKnowledgeRetrievalTarget] = React.useState<any>(null);

  // const [diffViewer, setDiffViewer] = React.useState<{ open: boolean; path: string; oldStr: string; newStr: string; taskId: string } | null>(null);

  // Tool Selection State
  const [availableTools, setAvailableTools] = React.useState<Tool[]>([]);
  
  // Diff View State
  // Removed diffData as str_replace now uses inline diffs via pendingDiffs

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

        // Fetch available tools
        try {
           const toolsData = await apiClient.getAvailableTools();
           if (toolsData && Array.isArray(toolsData.tools)) {
               setAvailableTools(toolsData.tools);
               // Select all tools by default if none enabled
               const toolNames = toolsData.tools.map(t => t.name);
               if (enabledTools.length === 0) {
                 setEnabledTools(toolNames);
               }
           }
        } catch (e) {
            console.error('Failed to fetch tools:', e);
            // Fallback
            const fallbackTools = ['edit_tool', 'mock_edit_tool', 'online_doc_tool', 'sequentialthinking'];
            setAvailableTools(fallbackTools.map(name => ({ name, description: name, initial_name_zh: name })));
            if (enabledTools.length === 0) {
              setEnabledTools(fallbackTools);
            }
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



  // Load sessions on mount
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const list = await apiClient.listSessions();
        const formattedSessions = list.map((s: any) => ({
          id: s.id,
          name: s.title || s.id,
          createdAt: new Date(s.created_at),
          updatedAt: new Date(s.updated_at),
          workingDir: workspaceRoot, 
          configFile: 'trae_config.yaml',
          status: 'active' as Session['status'],
          messages: [], 
          systemPrompt: 'DOCUMENT_AGENT_SYSTEM_PROMPT' as Session['systemPrompt']
        }));
        if (formattedSessions.length > 0) {
            setSessions(formattedSessions);
        }
      } catch (e) {
        console.error("Failed to load sessions", e);
      }
    };
    fetchSessions();
  }, []);

  // @ts-ignore
  const handleSelectSession = async (sid: string) => {
      setCurrentSession(sid);
      try {
        const msgs = await apiClient.getSessionMessages(sid);
        const formattedMsgs = msgs.map((m: any) => {
            let type = m.role === 'user' ? 'user' : 'agent';
            if (m.meta && m.meta.type === 'bubble') type = 'bubble';
            if (m.role === 'system') type = 'system';
            
            return {
                id: m.id.toString(),
                type: type as Message['type'],
                content: m.content,
                timestamp: new Date(m.created_at),
                sessionId: sid,
                metadata: m.meta
            };
        });
        
        updateSession(sid, { messages: formattedMsgs });
      } catch (e) {
        console.error("Failed to load session messages", e);
      }
  };

  const handleTestConnectivity = async (config?: {provider: string, model: string, apiKey: string, baseUrl?: string}) => {
    const provider = config?.provider || selectedProvider;
    const model = config?.model || modelName;
    const url = config?.baseUrl || modelBaseUrl;
    const key = config?.apiKey || apiKey;

    try {
      await apiClient.testModelConnectivity({
        provider: provider,
        model: model,
        model_base_url: url,
        api_key: key,
      });
      appendMessage('模型连通性测试通过');
      return true;
    } catch (e) {
      try {
        const fallbackUrl = 'http://host.docker.internal:9997/v1';
        await apiClient.testModelConnectivity({
          provider: provider,
          model: model,
          model_base_url: fallbackUrl,
          api_key: key,
        });
        setModelBaseUrl(fallbackUrl);
        appendMessage('模型连通性测试通过(已切换备用Base URL)');
        return true;
      } catch {
        appendMessage('模型连通性测试失败', 'error');
        return false;
      }
    }
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

  const handleSaveModelConfig = async (config: {provider: string, model: string, apiKey: string, baseUrl?: string}) => {
    try {
      await apiClient.saveModelConfig({
        name: 'default_model_config',
        provider: config.provider,
        model: config.model,
        base_url: config.baseUrl || '',
        api_key: config.apiKey
      });
      appendMessage('模型配置已保存');
    } catch (e) {
      console.error('Failed to save model config:', e);
      appendMessage('保存模型配置失败', 'error');
    }
  };

  // Load default model config on mount
  useEffect(() => {
    const loadModelConfig = async () => {
      try {
        const config = await apiClient.getModelConfig('default_model_config');
        if (config) {
          setSelectedProvider(config.provider);
          setModelName(config.model);
          setApiKey(config.api_key);
          if (config.base_url) {
            setModelBaseUrl(config.base_url);
          }
        }
      } catch (e) {
        // Ignore error if config doesn't exist yet
        console.log('No default model config found, using defaults');
      }
    };
    loadModelConfig();
  }, []);

  const createNewSession = async (workspacePath?: string, onlineMode?: boolean) => {
    try {
      const session = await apiClient.startInteractiveSession({
        working_dir: workspacePath || workspaceRoot,
        agent_type: 'trae_agent',
        max_steps: 20,
        provider: selectedProvider,
        model: modelName,
        model_base_url: modelBaseUrl,
        api_key: apiKey,
        prompt: systemPrompt as any,
        agent_mode_config: { mode_name: selectedPromptName, system_prompt: (selectedPromptName || systemPrompt) as any },
        console_type: 'lakeview',
        enable_lakeview: true, // Force enable LakeView
        lakeview_url: 'ws://localhost:8000/ws/agent/interactive/task', // This might be overridden by backend but good to have
        enable_quality_review: qualityReviewEnabled,
        quality_review_rules: qualityReviewRules,
        use_online_mode: !!onlineMode,
        tools: enabledTools,
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

  const handleCreateSessionUI = async () => {
      const sid = await createNewSession();
      if (sid) appendMessage('新会话已创建', 'system', sid);
  };

  const handleKillSessionUI = async () => {
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
        
        const attachments = extractAttachments(message);
        const hashId = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); h &= 0xffffffff; } return Math.abs(h).toString(16); };
        const userId = `user_${hashId('user:user')}`;
        const agentId = `agent_${hashId(modelName)}`;
        
        // Use raw message with tokens for both local display and backend
        useAppStore.getState().appendSessionMessage(sessionId, {
          id: makeMsgId(),
          type: 'user' as const,
          content: message,
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
        let taskPayload = message;
        
        // Inject Context for Active File if available
        // Removed: Automatic full-file context injection was causing token waste and confusing the LLM.
        // The LLM should rely on user-provided capsules or use the 'view' tool if needed.
        // If explicit context is needed, it should be part of the user selection (capsules).
        /*
        const store = useAppStore.getState();
        if (store.activeFilePath) {
            const activeFile = store.openFiles.find(f => f.path === store.activeFilePath);
            if (activeFile && activeFile.content) {
                const pid = `pid_${makeMsgId().substring(0, 8)}`;
                const content = activeFile.content;
                const contextXml = `
<context_injection>
<paragraph id="${pid}" path="${store.activeFilePath}">
<content>${content}</content>
</paragraph>
</context_injection>`;
                taskPayload = `${message}\n${contextXml}`;
                
                // Store paragraph context locally for frontend lookup
                store.addParagraphContext({
                    id: pid,
                    path: store.activeFilePath,
                    start: 0,
                    end: content.length,
                    content: content
                });
            }
        }
        */

        await apiClient.runInteractiveTaskWS(
          {
            session_id: sessionId,
            task: taskPayload,
            working_dir: workspaceRoot,
            prompt: (selectedPromptText || systemPrompt) as any,
            agent_mode_config: { mode_name: selectedPromptName, system_prompt: (selectedPromptText || systemPrompt) as any },
            enable_quality_review: qualityReviewEnabled,
            quality_review_rules: qualityReviewRules,
          },
          (data) => {
            console.log('Stream data received:', data);
            
            if (data.type === 'diff') {
              console.log('Received diff message:', data);
              if (data.data && data.data.file_path && data.data.changes) {
                data.data.changes.forEach((change: any) => {
                  addPendingDiff(data.data.file_path, change);
                });
                // Optionally notify user
                appendMessage(`收到针对 ${data.data.file_path} 的修改建议`, 'system');
              }
              return;
            }

            if (data.type === 'str_replace') {
              console.log('Received str_replace message:', data);
              
              const store = useAppStore.getState();
              const activeFilePath = store.activeFilePath;
              const taskId = data.task_id || `diff_${Date.now()}`;

              if (activeFilePath) {
                 const activeFile = store.openFiles.find(f => f.path === activeFilePath);
                 if (activeFile && activeFile.content) {
                    let start = -1;
                    let end = -1;
                    let originalContent = data.old_str || '';
                    let newContent = data.new_str || '';
                    let cmd = 'replace';
                    let startLine = -1;
                    let endLine = -1;
                    let startOffset = -1;
                    let endOffset = -1;

                    // 1. Parse XML to get metadata (Priority for metadata)
                    if (data.xml_content) {
                        const xml = data.xml_content;
                        const commandMatch = xml.match(/<command>([^<]+)<\/command>/);
                        const startMatch = xml.match(/<start>(\d+)<\/start>/);
                        const endMatch = xml.match(/<end>(\d+)<\/end>/);
                        const newContentMatch = xml.match(/<new_content>([\s\S]*?)<\/new_content>/);
                        const contentMatch = xml.match(/<content>([\s\S]*?)<\/content>/);
                        
                        if (commandMatch) cmd = commandMatch[1];
                        // <start>/<end> are character offsets
                        if (startMatch) startOffset = parseInt(startMatch[1]);
                        if (endMatch) endOffset = parseInt(endMatch[1]);
                        if (newContentMatch) newContent = newContentMatch[1];
                        if (contentMatch) originalContent = contentMatch[1];
                    } else {
                        // Fallback to legacy fields
                        if (typeof data.insert_line === 'number') {
                             startLine = data.insert_line;
                             cmd = 'insert';
                        } else if (typeof data.start === 'number') {
                             // data.start is likely character offset if coming from mock_edit_tool
                             startOffset = data.start;
                             if (typeof data.end === 'number') endOffset = data.end;
                        }
                    }

                    // 2. Strategy A: Content Match (High Priority)
                    if (originalContent) {
                        const idx = activeFile.content.indexOf(originalContent);
                        if (idx !== -1) {
                            start = idx;
                            end = idx + originalContent.length;
                        }
                    }
                    
                    // 2.5 Strategy A2: Character Offset (If Content Match failed)
                    if (start === -1 && startOffset !== -1) {
                        // Validate bounds
                        if (startOffset <= activeFile.content.length) {
                            start = startOffset;
                            end = endOffset !== -1 ? endOffset : start;
                        }
                    }

                    // 3. Strategy B: Line Number to Offset Fallback
                    if (start === -1 && startLine !== -1) {
                        const lines = activeFile.content.split('\n');
                        
                        if (cmd === 'insert') {
                             // Insert AFTER the line (assuming 1-based startLine)
                             // e.g. insert_line=27 means insert after line 27
                             if (startLine <= lines.length) {
                                const linesBefore = lines.slice(0, startLine);
                                start = linesBefore.join('\n').length;
                                // Add newline if we are not at the very beginning (startLine=0)
                                if (startLine > 0) start += 1;
                                else start = 0;
                                end = start;
                             }
                        } else {
                             // Replace/Delete using Line Numbers (1-based)
                             // Start Offset
                             const lineIdx = Math.max(0, startLine - 1);
                             if (lineIdx < lines.length) {
                                 const preLines = lines.slice(0, lineIdx);
                                 start = preLines.join('\n').length + (lineIdx > 0 ? 1 : 0);
                                 
                                 // End Offset
                                 if (endLine !== -1) {
                                     const endLineIdx = Math.max(0, endLine);
                                     const postLines = lines.slice(0, endLineIdx);
                                     end = postLines.join('\n').length + (endLineIdx > 0 ? 1 : 0);
                                 } else {
                                     // If no end line, assume same as start? Or just start offset?
                                     // For safety, if no end line and no content match, we might abort or assume single line.
                                     // Let's assume single line if endLine is missing but startLine is present.
                                     const postLines = lines.slice(0, lineIdx + 1);
                                     end = postLines.join('\n').length + (lineIdx + 1 > 0 ? 1 : 0);
                                 }
                             }
                        }
                    }

                    if (start !== -1) {
                        addPendingDiff(activeFilePath, {
                            id: taskId,
                            start: start,
                            end: end,
                            original_content: originalContent,
                            new_content: newContent,
                            metadata: {
                                command: cmd as any
                            }
                        });
                        return;
                    }
                 }
              }
              
              // Fallback if no active file or content not found:
              console.warn('Could not apply str_replace to active file');
              appendMessage('无法在当前文件中定位修改内容，请确认文件是否打开', 'error');
              return;
            }
            
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
              const role = (data.data.role === 'user' || data.data.role === 'system' || data.data.role === 'error' || data.data.role === 'agent') ? data.data.role : 'bubble';
              const content = String(data.data.content || '').trim();
              const bubbleId = String(data.data.id || '');
              
              // Check for final result
              if (data.data.emoji === '🏁' || data.data.title === '任务完成') {
                  setIsStreaming(false);
              }

              useAppStore.getState().upsertSessionBubble(sessionId, bubbleId || makeMsgId(), {
                id: bubbleId || makeMsgId(),
                type: role,
                content: content,
              } as any);
              return;
            }
            
            if ((data.type === 'file_changed' || data.type === 'file_change') && data.data) {
                const path = data.data.path;
                console.log('File changed event:', path);
                (async () => {
                    try {
                       const currentWorkspace = useAppStore.getState().workspaceRoot || workspaceRoot;
                       let relPath = path;
                       if (path.startsWith(currentWorkspace)) {
                           relPath = path.slice(currentWorkspace.length);
                           if (relPath.startsWith('/')) relPath = relPath.slice(1);
                       }
                       
                       const requestId = `diff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                       console.log('Fetching diff for:', relPath, 'in workspace:', currentWorkspace, 'request_id:', requestId);
                       
                       // 1. Get Git Diff to find what changed
                       // Use contextLines=0 to get minimal diffs (strict line changes without context)
                       const gitDiffRes = await apiClient.gitDiff(currentWorkspace, relPath, 0, requestId);
                       
                       // Verify Request ID matches
                       if (gitDiffRes.request_id && gitDiffRes.request_id !== requestId) {
                           console.warn("Received diff response for mismatching request ID", gitDiffRes.request_id, requestId);
                       }
                       
                       const diffStr = gitDiffRes.diff;

                       // Parse filename from diff to ensure we target the correct file
                       if (diffStr) {
                           const lines = diffStr.split('\n');
                           for (const line of lines) {
                               if (line.startsWith('+++ ')) {
                                   try {
                                       let raw = line.slice(4).trim();
                                       if (raw.startsWith('b/')) raw = raw.slice(2);
                                       else if (raw.startsWith('"b/')) raw = raw.slice(3).replace(/"$/, '');
                                       
                                       if (raw.includes('\\')) {
                                            const bytes = [];
                                            let i = 0;
                                            while (i < raw.length) {
                                                if (raw[i] === '\\' && i + 3 < raw.length && /^[0-7]/.test(raw[i+1]) && /^[0-7]/.test(raw[i+2]) && /^[0-7]/.test(raw[i+3])) {
                                                    bytes.push(parseInt(raw.slice(i+1, i+4), 8));
                                                    i += 4;
                                                } else {
                                                    bytes.push(raw.charCodeAt(i));
                                                    i++;
                                                }
                                            }
                                            relPath = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
                                       } else {
                                            relPath = raw;
                                       }
                                       console.log('Updated relPath from diff:', relPath);
                                   } catch (e) {
                                       console.warn('Failed to parse path from diff:', line, e);
                                   }
                                   break;
                               }
                           }
                       }

                       const oldRes = await apiClient.gitShow(currentWorkspace, relPath, 'HEAD');
                       const newRes = await apiClient.readFile(currentWorkspace, relPath);
                       const oldContent = oldRes.content;
                       
                       // Parse Git Diff again to get Line Numbers
                       // We will use the line numbers to calculate offsets in oldContent.
                       if (diffStr) {
                           // Clear existing pending diffs for this file as we have a fresh state from Git
                           useAppStore.getState().clearPendingDiffs(relPath);

                           const lines = diffStr.split('\n');
                           let oldLine = 0;
                           let newLine = 0;
                           let hunkIndex = 0;
                           
                           let inHunk = false;
                           for (let i=0; i<lines.length; i++) {
                               const line = lines[i];
                               if (line.startsWith('@@ ')) {
                                   inHunk = true;
                                   const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
                                   if (match) {
                                       oldLine = parseInt(match[1]);
                                       newLine = parseInt(match[3]);
                                   }
                               } else if (inHunk && line.startsWith('-')) {
                                   // Deletion/Replacement Old Side
                                   // We need to group consecutive changes
                                   let startL = oldLine;
                                   let content = line.slice(1);
                                   let j = i + 1;
                                   while (j < lines.length && (lines[j].startsWith('-') || lines[j].startsWith('+'))) {
                                       if (lines[j].startsWith('-')) {
                                           content += '\n' + lines[j].slice(1);
                                           oldLine++; // Consumed old line
                                       }
                                       j++;
                                   }
                                   // Now find corresponding new content (if any)
                                   let newC = '';
                                   let k = i + 1;
                                   // Reset k to find '+' lines in the same block
                                   while (k < lines.length && (lines[k].startsWith('-') || lines[k].startsWith('+'))) {
                                       if (lines[k].startsWith('+')) {
                                            if (newC) newC += '\n';
                                            newC += lines[k].slice(1);
                                       }
                                       k++;
                                   }
                                   
                                   // Calculate Offsets in Old Content
                                   const oldLines = oldContent.split('\n');
                                   // startL is 1-based
                                   const startIdx = Math.max(0, startL - 1);
                                   // content has N lines.
                                   const numOldLines = content.split('\n').length;
                                   const endIdx = startIdx + numOldLines;
                                   
                                   const preLines = oldLines.slice(0, startIdx);
                                   const startOffset = preLines.join('\n').length + (startIdx > 0 ? 1 : 0);
                                   
                                   const targetLines = oldLines.slice(startIdx, endIdx);
                                   const endOffset = startOffset + targetLines.join('\n').length; // No extra newline at end of block usually
                                   
                                   // Add to pendingDiffs
                                   // Bind button to request_id (append index for uniqueness if multiple hunks)
                                   const diffId = `${requestId}_${hunkIndex++}`;
                                   const diffItem = {
                                       id: diffId,
                                       start: startOffset,
                                       end: endOffset,
                                       original_content: content,
                                       new_content: newC,
                                       metadata: { source: 'git_diff', request_id: requestId }
                                   };
                                   
                                   // Check duplication
                                   const exists = useAppStore.getState().pendingDiffs[relPath]?.some(d => d.start === diffItem.start);
                                   if (!exists) {
                                        addPendingDiff(relPath, diffItem);
                                   }
                                   
                                   // Advance outer loop
                                   i = j - 1;
                                   // Correct oldLine/newLine tracking is hard with mixed hunks, 
                                   // but we only rely on the start of the hunk and consecutive lines.
                                   oldLine++; // The current line was consumed
                               } else if (inHunk && line.startsWith('+')) {
                                   // Pure insertion (no preceding -)
                                   // Check if previous line was - (handled above). If not, it's insertion.
                                   const prev = lines[i-1];
                                   if (!prev.startsWith('-')) {
                                       // Insertion at oldLine
                                       let newC = line.slice(1);
                                       let j = i + 1;
                                       while (j < lines.length && lines[j].startsWith('+')) {
                                           newC += '\n' + lines[j].slice(1);
                                           j++;
                                       }
                                       
                                       const oldLines = oldContent.split('\n');
                                       const startIdx = Math.max(0, oldLine - 1);
                                       // Insertion point
                                       const preLines = oldLines.slice(0, startIdx);
                                       let startOffset = preLines.join('\n').length;
                                       if (startIdx > 0) startOffset += 1;
                                       
                                       const diffId = `${requestId}_${hunkIndex++}`;
                                       const diffItem = {
                                           id: diffId,
                                           start: startOffset,
                                           end: startOffset, // Insert has 0 length in old
                                           original_content: '',
                                           new_content: newC,
                                           metadata: { source: 'git_diff', request_id: requestId }
                                       };
                                        const exists = useAppStore.getState().pendingDiffs[relPath]?.some(d => d.start === diffItem.start);
                                        if (!exists) {
                                                addPendingDiff(relPath, diffItem);
                                        }
                                       i = j - 1;
                                   }
                                   newLine++;
                               } else if (inHunk) {
                                   // Context line
                                   oldLine++;
                                   newLine++;
                               }
                           }
                       }

                       // Update editor content to HEAD (Old) so we can render diffs
                       // If we have pending diffs, we enforce showing Old Content
                       const pendingDiffs = useAppStore.getState().pendingDiffs[relPath] || [];
                       
                       let newEditorContent = newRes.content;
                       let newOriginalContent = oldRes.content;
                       
                       if (pendingDiffs.length > 0) {
                           console.log('Pending diffs detected from Git, enforcing Inline Diff view with Old Content');
                           newEditorContent = oldRes.content;
                           newOriginalContent = undefined as any;
                       }

                       const editorFile = {
                           path: relPath,
                           content: newEditorContent,
                           originalContent: newOriginalContent,
                           isDirty: false,
                           language: getFileLanguage(relPath)
                       };
                       
                       const activeF = useAppStore.getState().openFiles.find(f => f.path === relPath || f.path === path);
                       if (activeF) {
                           useAppStore.getState().updateOpenFile(activeF.path, { content: newEditorContent, originalContent: newOriginalContent });
                       } else {
                           addOpenFile(editorFile);
                       }
                       setActiveFile(relPath);
                       
                    } catch(e) {
                       console.error("Failed to load diff", e);
                    }
                })();
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
        <div className="flex items-center justify-between h-10 px-4 border-b bg-background shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold">AI Doc</h1>
          </div>
          
          {/* Right Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveSidebarItem(activeSidebarItem ? null : 'explorer')}
              className="p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors"
              title={activeSidebarItem ? "收起侧边栏" : "展开文件列表"}
            >
              {activeSidebarItem ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
            
            <button
              onClick={toggleChatPanel}
              className="p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors"
              title={!chatPanelCollapsed ? "收起会话窗口" : "展开会话窗口"}
            >
              {!chatPanelCollapsed ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            </button>

            <div className="w-px h-4 bg-border mx-1" />

            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors"
              title={theme === 'light' ? "切换到沉浸模式" : "切换到白天模式"}
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors"
              title={isFullscreen ? "退出全屏" : "进入全屏"}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
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
          {/* Activity Bar */}
          <div className="w-12 border-r bg-muted/40 flex flex-col items-center py-2 gap-2 z-20 shrink-0">
            <button
              onClick={() => setActiveSidebarItem(activeSidebarItem === 'explorer' ? null : 'explorer')}
              className={`p-2 rounded-md transition-colors ${activeSidebarItem === 'explorer' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
              title="资源管理器"
            >
              <Files className="h-5 w-5" />
            </button>

            <button
              onClick={() => setActiveSidebarItem(activeSidebarItem === 'online' ? null : 'online')}
              className={`p-2 rounded-md transition-colors ${activeSidebarItem === 'online' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
              title="在线文档"
            >
              <Globe className="h-5 w-5" />
            </button>

            <button
              onClick={() => setActiveSidebarItem(activeSidebarItem === 'git' ? null : 'git')}
              className={`p-2 rounded-md transition-colors ${activeSidebarItem === 'git' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
              title="源代码管理"
            >
              <GitBranch className="h-5 w-5" />
            </button>

            <button
              onClick={() => setActiveSidebarItem(activeSidebarItem === 'knowledge' ? null : 'knowledge')}
              className={`p-2 rounded-md transition-colors ${activeSidebarItem === 'knowledge' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
              title="知识库"
            >
              <Database className="h-5 w-5" />
            </button>

            <button
              onClick={() => setActiveSidebarItem(activeSidebarItem === 'dify-tools' ? null : 'dify-tools')}
              className={`p-2 rounded-md transition-colors ${activeSidebarItem === 'dify-tools' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
              title="TOOLS"
            >
              <Workflow className="h-5 w-5" />
            </button>
            
            <div className="flex-1" />
            
            <button
              onClick={() => setIsSystemSettingsOpen(true)}
              className={`p-2 rounded-md transition-colors ${isSystemSettingsOpen ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
              title="系统设置"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>

          {/* Sidebar */}
          {activeSidebarItem === 'explorer' && (
            <div className="w-64 border-r bg-background flex flex-col overflow-hidden shrink-0 animate-in slide-in-from-left-5 duration-200">
              <div className="h-9 flex items-center px-4 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                资源管理器
              </div>
              <FileTree onFileSelect={handleFileSelect} />
            </div>
          )}

          {activeSidebarItem === 'online' && (
            <div className="w-64 border-r bg-background flex flex-col overflow-hidden shrink-0 animate-in slide-in-from-left-5 duration-200">
              <OnlineDocPanel />
            </div>
          )}

          {activeSidebarItem === 'git' && (
            <div className="w-64 border-r bg-background flex flex-col overflow-hidden shrink-0 animate-in slide-in-from-left-5 duration-200">
              <div className="h-9 flex items-center px-4 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                源代码管理
              </div>
              <GitPanel workspace={workspaceRoot} onOpenFile={handleFileSelect} />
            </div>
          )}

          {activeSidebarItem === 'knowledge' && (
            <div className="w-64 border-r bg-background flex flex-col overflow-hidden shrink-0 animate-in slide-in-from-left-5 duration-200">
              <KnowledgeBaseManager onRetrieveTest={(kb) => {
                setKnowledgeRetrievalTarget(kb);
                setIsKnowledgeRetrievalOpen(true);
                setIsSystemSettingsOpen(false);
              }} />
            </div>
          )}

          {activeSidebarItem === 'dify-tools' && (
            <div className="w-64 border-r bg-background flex flex-col overflow-hidden shrink-0 animate-in slide-in-from-left-5 duration-200">
              <ToolsPanel />
            </div>
          )}

          <div className="flex-1 flex flex-col min-w-0 bg-background">
            {isSystemSettingsOpen ? (
              <SettingsPage
                onClose={() => setIsSystemSettingsOpen(false)}
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
                onTestConnectivity={handleTestConnectivity}
                onSaveModelConfig={handleSaveModelConfig}
              />
            ) : isKnowledgeRetrievalOpen && knowledgeRetrievalTarget ? (
              <KnowledgeRetrievalPanel 
                kb={knowledgeRetrievalTarget}
                onClose={() => setIsKnowledgeRetrievalOpen(false)}
              />
            ) : (
              <div className="flex-1 border-b overflow-hidden flex flex-col">
                <CodeEditor />
              </div>
            )}
          </div>
          {!chatPanelCollapsed && (
            <ChatPanel 
              className="w-96 border-l bg-background flex flex-col shadow-sm flex-shrink-0"
              messages={
                currentSessionId 
                  ? (sessions.find(s => s.id === currentSessionId)?.messages || []) 
                  : []
              }
              onSendMessage={(msg) => handleSendMessage(msg, true)}
              isStreaming={isStreaming}
              availableTools={availableTools}
              selectedTools={enabledTools}
              onToolsChange={setEnabledTools}
              onCreateSession={handleCreateSessionUI}
              onKillSession={handleKillSessionUI}
            />
          )}
        </div>

        {/* Runtime Log Panel (Cmd+Shift+J) */}
        <RuntimeLogPanel />



        

        {/* Removed message console; WS bubbles are shown as system toasts */}
        


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

      {/* Diff Viewer Modal - REMOVED */}
      {/* diffViewer?.open && ... */}
      </div>
    </ErrorBoundary>
  );
}

export default App;
