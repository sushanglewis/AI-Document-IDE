import React from 'react';
import { Toaster } from 'sonner';
import { FileTree } from './components/FileTree';
import { ChatPanel } from './components/ChatPanel';
import { CodeEditor } from './components/CodeEditor';
import { StreamingConsole } from './components/StreamingConsole';
import { useAppStore, Session } from './lib/store';
import { apiClient, AgentStep } from './lib/api';
import { toast } from 'sonner';
import { cn } from './lib/utils';

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

export default App;

function App() {
  const { 
    currentSessionId, 
    workspaceRoot, 
    systemPrompt,
    setWorkspaceRoot, 
    setFileTree, 
    addSession,
    updateSession,
    setSystemPrompt,
    sessions,
    addOpenFile,
    setActiveFile
  } = useAppStore();
  
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [currentSteps, setCurrentSteps] = React.useState<AgentStep[]>([]);
  const [isBackendAvailable, setIsBackendAvailable] = React.useState(true);
  const [workspaceOptions, setWorkspaceOptions] = React.useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = React.useState<string>('openrouter');
  const [modelBaseUrl, setModelBaseUrl] = React.useState<string>('http://10.0.2.22:9997/v1');
  const [modelName, setModelName] = React.useState<string>('Qwen3-32B');
  const [apiKey, setApiKey] = React.useState<string>('sk-xinference');
  const [savedModels, setSavedModels] = React.useState<Array<{ name: string; provider: string; baseUrl: string; model: string; apiKey: string }>>([
    { name: 'Xinference-OpenRouter-Qwen3', provider: 'openrouter', baseUrl: 'http://10.0.2.22:9997/v1', model: 'Qwen3-32B', apiKey: 'sk-xinference' },
  ]);
  const [selectedModelName, setSelectedModelName] = React.useState<string>('Xinference-OpenRouter-Qwen3');
  const [isModelModalOpen, setIsModelModalOpen] = React.useState(false);
  const [isCreatingModel, setIsCreatingModel] = React.useState(false);
  const [leftCollapsed, setLeftCollapsed] = React.useState(false);
  const [chatCollapsed, setChatCollapsed] = React.useState(false);

  // Initialize workspace and create initial session
  React.useEffect(() => {
    const initializeApp = async () => {
      try {
        const workspaces = await apiClient.listWorkspaces();
        setWorkspaceOptions(workspaces);
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
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setIsBackendAvailable(false);
        toast.error('初始化应用失败，请确保后端服务正常运行');
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


  const handleWorkspaceSelect = async (ws: string) => {
    setWorkspaceRoot(ws);
    const files = await apiClient.listFiles(ws);
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
  };

  const handleTestConnectivity = async () => {
    try {
      await apiClient.testModelConnectivity({
        provider: selectedProvider,
        model: modelName,
        model_base_url: modelBaseUrl,
        api_key: apiKey,
      });
      toast.success('模型连通性测试通过');
    } catch (e) {
      toast.error('模型连通性测试失败');
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
    toast.success('模型配置已保存');
  };

  const createNewSession = async (workspacePath?: string) => {
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
      
      addSession(newSession);
      toast.success('新会话已创建');
      return session.session_id;
    } catch (error) {
      console.error('Failed to create session:', error);
      toast.error('创建会话失败，请确保后端服务正常运行');
      return null;
    }
  };

  const handleSendMessage = async (message: string, useStreaming: boolean) => {
    let sessionId = currentSessionId;
    
    if (!sessionId) {
      sessionId = await createNewSession();
      if (!sessionId) {
        return;
      }
    }

    if (useStreaming) {
      setIsStreaming(true);
      setCurrentSteps([]);
      
      try {
        // Add user message to session
        updateSession(sessionId, {
          messages: [...(sessions.find(s => s.id === sessionId)?.messages || []), {
            id: Date.now().toString(),
            type: 'user' as const,
            content: message,
            timestamp: new Date(),
            sessionId: sessionId
          }]
        });

        await apiClient.runInteractiveTaskStream(
          {
            session_id: sessionId,
            task: message,
            working_dir: workspaceRoot,
            prompt: systemPrompt as any,
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
              // Session started, can add a system message if needed
              console.log('Session started:', data.data);
            } else if (data.type === 'step') {
              setCurrentSteps(prev => [...prev, data.data]);
              
              // Process the step data and create meaningful messages
              const stepMessage = [];

              // Required fields summary
              const stepNumber = data.data.step_number;
              const completed = String((data.data.state || '').toUpperCase() === 'COMPLETED');
              stepMessage.push({
                id: data.data.step_id + '_summary',
                type: 'system' as const,
                content: `步骤: ${stepNumber ?? '-'} | 完成: ${completed}`,
                timestamp: new Date(data.data.timestamp),
                sessionId: sessionId,
                stepId: data.data.step_id,
              });
              
              // Add LLM response content if available
              if (data.data.llm_response) {
                // Use full content if available, otherwise use content_excerpt
                const llmContent = data.data.llm_response.content || data.data.llm_response.content_excerpt || '';
                const content = llmContent.trim();
                
                console.log('LLM response debug:', {
                  has_full_content: !!data.data.llm_response.content,
                  has_excerpt: !!data.data.llm_response.content_excerpt,
                  content_preview: content.substring(0, 100),
                  content_length: content.length,
                  finish_reason: data.data.llm_response.finish_reason,
                  has_tool_calls: !!(data.data.llm_response.tool_calls && data.data.llm_response.tool_calls.length > 0)
                });
                
                if (content.length > 0) {
                  stepMessage.push({
                    id: data.data.step_id + '_response',
                    type: 'agent' as const,
                    content: content,
                    timestamp: new Date(data.data.timestamp),
                    sessionId: sessionId,
                    stepId: data.data.step_id,
                    metadata: {
                      model: data.data.llm_response.model,
                      usage: data.data.llm_response.usage,
                      finish_reason: data.data.llm_response.finish_reason,
                      has_tool_calls: !!(data.data.llm_response.tool_calls && data.data.llm_response.tool_calls.length > 0)
                    }
                  });
                  // Also log finish_reason when present
                  if (data.data.llm_response.finish_reason) {
                    stepMessage.push({
                      id: data.data.step_id + '_finish_reason',
                      type: 'system' as const,
                      content: `finish_reason: ${data.data.llm_response.finish_reason}`,
                      timestamp: new Date(data.data.timestamp),
                      sessionId: sessionId,
                      stepId: data.data.step_id,
                    });
                  }
                } else if (data.data.llm_response.tool_calls && data.data.llm_response.tool_calls.length > 0) {
                  // If no text content but has tool calls, show tool execution status
                  const toolCallNames = data.data.llm_response.tool_calls.map((tool: any) => tool.name).join(', ');
                  stepMessage.push({
                    id: data.data.step_id + '_tools',
                    type: 'agent' as const,
                    content: `🔧 正在执行工具: ${toolCallNames}`,
                    timestamp: new Date(data.data.timestamp),
                    sessionId: sessionId,
                    stepId: data.data.step_id,
                    metadata: {
                      model: data.data.llm_response.model,
                      usage: data.data.llm_response.usage,
                      finish_reason: data.data.llm_response.finish_reason,
                      is_tool_execution: true
                    }
                  });
                  // Explicitly print tool calls array
                  stepMessage.push({
                    id: data.data.step_id + '_tool_calls_list',
                    type: 'system' as const,
                    content: `tool_calls: ${JSON.stringify(data.data.llm_response.tool_calls)}`,
                    timestamp: new Date(data.data.timestamp),
                    sessionId: sessionId,
                    stepId: data.data.step_id,
                  });
                } else {
                  // Even if content is empty, show model thinking status
                  stepMessage.push({
                    id: data.data.step_id + '_thinking',
                    type: 'agent' as const,
                    content: '🤔 AI正在思考中...',
                    timestamp: new Date(data.data.timestamp),
                    sessionId: sessionId,
                    stepId: data.data.step_id,
                    metadata: {
                      model: data.data.llm_response.model,
                      usage: data.data.llm_response.usage,
                      finish_reason: data.data.llm_response.finish_reason,
                      is_thinking: true
                    }
                  });
                  // Describe empty content reason
                  stepMessage.push({
                    id: data.data.step_id + '_empty_reason',
                    type: 'system' as const,
                    content: `LLM 内容为空。finish_reason=${data.data.llm_response.finish_reason || 'unknown'}，tool_calls=${(data.data.llm_response.tool_calls && data.data.llm_response.tool_calls.length > 0) ? 'present' : 'none'}`,
                    timestamp: new Date(data.data.timestamp),
                    sessionId: sessionId,
                    stepId: data.data.step_id,
                  });
                }
              }
              
              // Add tool calls information
              if (data.data.tool_calls && data.data.tool_calls.length > 0) {
                const toolCallInfo = data.data.tool_calls.map((tool: any) => 
                  `执行工具: ${tool.name}(${JSON.stringify(tool.parameters).slice(0, 100)}${JSON.stringify(tool.parameters).length > 100 ? '...' : ''})`
                ).join('\n');
                
                stepMessage.push({
                  id: data.data.step_id + '_tools',
                  type: 'system' as const,
                  content: toolCallInfo,
                  timestamp: new Date(data.data.timestamp),
                  sessionId: sessionId,
                  stepId: data.data.step_id
                });
              }
              
              // Add reflection if available
              if (data.data.reflection) {
                stepMessage.push({
                  id: data.data.step_id + '_reflection',
                  type: 'system' as const,
                  content: `反思: ${data.data.reflection}`,
                  timestamp: new Date(data.data.timestamp),
                  sessionId: sessionId,
                  stepId: data.data.step_id
                });
              }

              // Add lakeview summary if available
              if (data.data.lakeview_summary) {
                stepMessage.push({
                  id: data.data.step_id + '_lakeview',
                  type: 'system' as const,
                  content: `Lakeview: ${data.data.lakeview_summary}`,
                  timestamp: new Date(data.data.timestamp),
                  sessionId: sessionId,
                  stepId: data.data.step_id
                });
              }
              
              // Add all step messages to session
              if (stepMessage.length > 0) {
                const currentMessages = sessions.find(s => s.id === sessionId)?.messages || [];
                updateSession(sessionId, {
                  messages: [...currentMessages, ...stepMessage]
                });
              }
            } else if (data.type === 'completed') {
              setCurrentSteps(data.data.steps || []);
              
              // Add completion summary
              const completionMessage = {
                id: 'completion_' + Date.now(),
                type: 'system' as const,
                content: `✅ 任务完成\n执行时间: ${data.data.execution_time?.toFixed(2)}s\n步骤数: ${data.data.steps_count}\n结果: ${data.data.final_result || '成功'}`,
                timestamp: new Date(),
                sessionId: sessionId
              };
              
              const currentMessages = sessions.find(s => s.id === sessionId)?.messages || [];
              updateSession(sessionId, {
                messages: [...currentMessages, completionMessage]
              });
            }
          },
          (error) => {
            console.error('Streaming error:', error);
            toast.error('流式处理出错');
            
            // Add error message to session
            updateSession(sessionId, {
              messages: [...(sessions.find(s => s.id === sessionId)?.messages || []), {
                id: 'error_' + Date.now(),
                type: 'error' as const,
                content: '流式处理出错: ' + error.message,
                timestamp: new Date(),
                sessionId: sessionId
              }]
            });
          },
          () => {
            setIsStreaming(false);
            toast.success('任务完成');
          }
        );
      } catch (error) {
      console.error('Failed to run task:', error);
      toast.error('执行任务失败，请检查后端服务状态');
      setIsStreaming(false);
    }
    } else {
      // Non-streaming execution
      try {
        // Add user message to session
        updateSession(sessionId, {
          messages: [...(sessions.find(s => s.id === sessionId)?.messages || []), {
            id: Date.now().toString(),
            type: 'user' as const,
            content: message,
            timestamp: new Date(),
            sessionId: sessionId
          }]
        });

        const result = await apiClient.runInteractiveTask({
          session_id: sessionId,
          task: message,
          working_dir: workspaceRoot,
        });
        
        setCurrentSteps(result.steps || []);
        
        // Add agent messages from result
        if (result.steps && result.steps.length > 0) {
          const agentMessages = result.steps
            .filter(step => step.llm_response?.content_excerpt)
            .map(step => ({
              id: step.step_id,
              type: 'agent' as const,
              content: step.llm_response!.content_excerpt,
              timestamp: new Date(step.timestamp),
              sessionId: sessionId,
              stepId: step.step_id,
              metadata: {
                tool_calls: step.tool_calls,
                tool_results: step.tool_results,
                reflection: step.reflection
              }
            }));
          
          if (agentMessages.length > 0) {
            updateSession(sessionId, {
              messages: [...(sessions.find(s => s.id === sessionId)?.messages || []), ...agentMessages]
            });
          }
        }
        
        // Add completion message
        if (result.final_result) {
          updateSession(sessionId, {
            messages: [...(sessions.find(s => s.id === sessionId)?.messages || []), {
              id: 'completion_' + Date.now(),
              type: 'system' as const,
              content: '任务完成: ' + result.final_result,
              timestamp: new Date(),
              sessionId: sessionId
            }]
          });
        }
        
        toast.success('任务完成');
      } catch (error) {
        console.error('Failed to run task:', error);
        toast.error('执行任务失败，请检查后端服务状态');
        
        // Add error message to session
        updateSession(sessionId, {
          messages: [...(sessions.find(s => s.id === sessionId)?.messages || []), {
            id: 'error_' + Date.now(),
            type: 'error' as const,
            content: '执行任务失败: ' + (error as Error).message,
            timestamp: new Date(),
            sessionId: sessionId
          }]
        });
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
        
        toast.success(`文件 ${(relativePath || filePath)} 加载成功`);
      } else {
        toast.warning('文件内容为空');
      }
    } catch (error: any) {
      console.error('Failed to read file:', error);
      if (error.response?.status === 404) {
        const rp = filePath.startsWith(workspaceRoot)
          ? filePath.slice(workspaceRoot.length).replace(/^\//, '')
          : filePath.startsWith('/workspace')
            ? filePath.replace(/^\/workspace\/?/, '')
            : filePath;
        toast.error(`文件不存在: ${rp}`);
      } else if (error.response?.status === 403) {
        toast.error('没有权限读取该文件');
      } else {
        toast.error(`读取文件失败: ${error.message}`);
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
        <Toaster position="top-right" />
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-background">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">AI IDE</h1>
            {/* Layout Toggles */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLeftCollapsed(v => !v)}
                className="px-2 py-1 text-xs bg-muted rounded"
              >{leftCollapsed ? '展开文件' : '折叠文件'}</button>
              <button
                onClick={() => setChatCollapsed(v => !v)}
                className="px-2 py-1 text-xs bg-muted rounded"
              >{chatCollapsed ? '展开对话' : '折叠对话'}</button>
            </div>
            
            {/* System Prompt Selection */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">系统提示词:</label>
              <select 
                value={systemPrompt} 
                onChange={(e) => setSystemPrompt(e.target.value as any)}
                className="px-2 py-1 border rounded text-sm bg-background"
                disabled={isStreaming}
              >
                <option value="DOCUMENT_AGENT_SYSTEM_PROMPT">文档助手</option>
                <option value="TRAE_AGENT_SYSTEM_PROMPT">工程助手</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">工作空间:</label>
              <select
                value={workspaceRoot}
                onChange={(e) => handleWorkspaceSelect(e.target.value)}
                className="px-2 py-1 border rounded text-sm bg-background"
                disabled={isStreaming}
              >
                {workspaceOptions.length === 0 && (
                  <option value={workspaceRoot}>{workspaceRoot}</option>
                )}
                {workspaceOptions.map(ws => (
                  <option key={ws} value={ws}>{ws}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">模型配置:</label>
              <button
                onClick={() => { setIsModelModalOpen(true); setIsCreatingModel(false); }}
                className="px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
              >
                管理模型
              </button>
              <span className="text-xs text-muted-foreground">当前: {selectedModelName}</span>
            </div>
            
            {/* Session Info */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>会话:</span>
              <span className="font-mono">
                {currentSessionId ? currentSessionId.substring(0, 8) + '...' : '未创建'}
              </span>
              <button 
                onClick={() => createNewSession()}
                className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                disabled={isStreaming}
              >
                新建会话
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-2" />
        </div>
        
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div className="w-64 border-r bg-muted/30 flex flex-col">
            <FileTree onFileSelect={handleFileSelect} />
          </div>

          {/* Main Content */}
        <div className="flex-1 flex">
          {/* Left: FileTree (collapsible by width) */}
          <div className={cn(leftCollapsed ? 'w-0' : 'w-64', "border-r bg-muted/30 flex flex-col overflow-hidden")}>
            <FileTree onFileSelect={handleFileSelect} />
          </div>

          {/* Middle: Markdown / Editor */}
          <div className="flex-1 flex flex-col border-r">
            <CodeEditor />
          </div>

          {/* Right: Chat (collapsible) */}
          <div className={cn(chatCollapsed ? 'w-0' : 'w-[380px]', "flex flex-col overflow-hidden")}>            
            {!chatCollapsed && (
              <>
                <ChatPanel 
                  onSendMessage={handleSendMessage}
                  isStreaming={isStreaming}
                />
                <div className="flex-1 overflow-y-auto">
                  <StreamingConsole 
                    steps={currentSteps}
                    isStreaming={isStreaming}
                    messages={sessions.find(s => s.id === currentSessionId)?.messages || []}
                  />
                </div>
              </>
            )}
          </div>
        </div>

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
                              toast.success('模型已选中');
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
        </div>
      </div>
    </ErrorBoundary>
  );
}