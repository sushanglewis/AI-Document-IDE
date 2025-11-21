import React from 'react';
import { Settings } from 'lucide-react';
import { Toaster } from 'sonner';
import { FileTree } from './components/FileTree';
import { CodeEditor } from './components/CodeEditor';
import { StreamingConsole } from './components/StreamingConsole';
import { SystemSettings } from './components/SystemSettings';
import { useAppStore, Session } from './lib/store';
import { apiClient, AgentStep } from './lib/api';
import { toast } from 'sonner';

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
  const [currentSteps, setCurrentSteps] = React.useState<AgentStep[]>([]);
  const [isBackendAvailable, setIsBackendAvailable] = React.useState(true);
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
  const [isModelModalOpen, setIsModelModalOpen] = React.useState(false);
  const [isCreatingModel, setIsCreatingModel] = React.useState(false);
  const [isCommandOpen, setIsCommandOpen] = React.useState(false);
  const [commandText, setCommandText] = React.useState('');
  const [isConsoleOpen, setIsConsoleOpen] = React.useState(false);
  const [qualityReviewEnabled, setQualityReviewEnabled] = React.useState<boolean>(false);
  const [qualityReviewRules, setQualityReviewRules] = React.useState<string>("");

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
          const docPrompt = await apiClient.getPrompt('DOCUMENT_AGENT_SYSTEM_PROMPT');
          const devPrompt = await apiClient.getPrompt('TRAE_AGENT_SYSTEM_PROMPT');
          const items = [
            { id: 'DOCUMENT_AGENT_SYSTEM_PROMPT', name: '文档助理模式', content: docPrompt },
            { id: 'TRAE_AGENT_SYSTEM_PROMPT', name: '代码专家模式', content: devPrompt }
          ].filter(p => p.content && p.content.trim().length > 0);
          setSystemPrompts(items);
        } catch {}
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

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    const onToggle = (e: KeyboardEvent) => {
      const isToggle = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'j';
      if (isToggle) {
        e.preventDefault();
        setIsConsoleOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onToggle);
    return () => window.removeEventListener('keydown', onToggle);
  }, []);



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

  // System Settings Functions
  const handleSaveSystemPrompt = (prompt: {id: string, name: string, content: string}) => {
    setSystemPrompts(prev => {
      const others = prev.filter(p => p.id !== prompt.id);
      return [...others, prompt];
    });
    toast.success('系统提示词已保存');
  };

  const handleDeleteSystemPrompt = (id: string) => {
    setSystemPrompts(prev => prev.filter(p => p.id !== id));
    toast.success('系统提示词已删除');
  };


  const handleModelConfigChange = (config: {provider: string, model: string, apiKey: string, baseUrl?: string}) => {
    setSelectedProvider(config.provider);
    setModelName(config.model);
    setApiKey(config.apiKey);
    if (config.baseUrl) {
      setModelBaseUrl(config.baseUrl);
    }
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
        console_type: 'lakeview',
        enable_quality_review: qualityReviewEnabled,
        quality_review_rules: qualityReviewRules,
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
    const makeMsgId = () => (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? (globalThis.crypto as any).randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    
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
              console.log('Session started:', data.data);
              const taskText = (data.data && data.data.task) ? String(data.data.task) : message;
              updateSession(sessionId!, {
                messages: [
                  ...(sessions.find(s => s.id === sessionId)?.messages || []),
                  {
                    id: makeMsgId(),
                    type: 'system' as const,
                    content: `task: ${taskText}`,
                    timestamp: new Date(),
                    sessionId: sessionId!
                  }
                ]
              });
            } else if (data.type === 'step') {
              setCurrentSteps(prev => [...prev, data.data]);
              
              // Process the step data and create meaningful messages
              const stepMessage = [];

              // Required fields summary
              const stepNumber = data.data.step_number;
              const stepTimestamp = data.data.timestamp;
              const stepId = `step_${stepNumber}_${stepTimestamp}`;
              const completed = String((data.data.state || '').toUpperCase() === 'COMPLETED');
              stepMessage.push({
                id: stepId + '_summary',
                type: 'system' as const,
                content: `步骤: ${stepNumber ?? '-'} | 完成: ${completed}`,
                timestamp: new Date(stepTimestamp),
                sessionId: sessionId,
                stepId: stepId,
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
                  id: stepId + '_response',
                  type: 'agent' as const,
                  content: content,
                  timestamp: new Date(stepTimestamp),
                  sessionId: sessionId,
                  stepId: stepId,
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
                      id: stepId + '_finish_reason',
                      type: 'system' as const,
                      content: `finish_reason: ${data.data.llm_response.finish_reason}`,
                      timestamp: new Date(stepTimestamp),
                      sessionId: sessionId,
                      stepId: stepId,
                    });
                  }
                } else if (data.data.llm_response.tool_calls && data.data.llm_response.tool_calls.length > 0) {
                  // If no text content but has tool calls, show tool execution status
                  const toolCallNames = data.data.llm_response.tool_calls.map((tool: any) => tool.name).join(', ');
                  stepMessage.push({
                    id: stepId + '_tools',
                    type: 'agent' as const,
                    content: `🔧 正在执行工具: ${toolCallNames}`,
                    timestamp: new Date(stepTimestamp),
                    sessionId: sessionId,
                    stepId: stepId,
                    metadata: {
                      model: data.data.llm_response.model,
                      usage: data.data.llm_response.usage,
                      finish_reason: data.data.llm_response.finish_reason,
                      is_tool_execution: true
                    }
                  });
                  // Explicitly print tool calls array
                  stepMessage.push({
                    id: stepId + '_tool_calls_list',
                    type: 'system' as const,
                    content: `tool_calls: ${JSON.stringify(data.data.llm_response.tool_calls)}`,
                    timestamp: new Date(stepTimestamp),
                    sessionId: sessionId,
                    stepId: stepId,
                  });
                } else {
                  // Even if content is empty, show model thinking status
                  stepMessage.push({
                    id: stepId + '_thinking',
                    type: 'agent' as const,
                    content: '🤔 AI正在思考中...',
                    timestamp: new Date(stepTimestamp),
                    sessionId: sessionId,
                    stepId: stepId,
                    metadata: {
                      model: data.data.llm_response.model,
                      usage: data.data.llm_response.usage,
                      finish_reason: data.data.llm_response.finish_reason,
                      is_thinking: true
                    }
                  });
                  // Describe empty content reason
                  stepMessage.push({
                    id: stepId + '_empty_reason',
                    type: 'system' as const,
                    content: `LLM 内容为空。finish_reason=${data.data.llm_response.finish_reason || 'unknown'}，tool_calls=${(data.data.llm_response.tool_calls && data.data.llm_response.tool_calls.length > 0) ? 'present' : 'none'}`,
                    timestamp: new Date(data.data.timestamp),
                    sessionId: sessionId,
                    stepId: stepId,
                  });
                }
              }
              
              // Add tool calls information (simplified - backend only provides name and call_id)
              if (data.data.tool_calls && data.data.tool_calls.length > 0) {
                const toolNames = data.data.tool_calls.map((tool: any) => tool.name).join(', ');
                const toolCallCount = data.data.tool_calls.length;
                
                stepMessage.push({
                  id: stepId + '_tools',
                  type: 'system' as const,
                  content: `🔧 执行工具 (${toolCallCount}): ${toolNames}`,
                  timestamp: new Date(stepTimestamp),
                  sessionId: sessionId,
                  stepId: stepId
                });

                // Add tool results summary if available
                if (data.data.tool_results_summary) {
                  const { count = 0, success_count = 0, error_count = 0 } = data.data.tool_results_summary;
                  stepMessage.push({
                    id: stepId + '_tool_results',
                    type: 'system' as const,
                    content: `📊 工具执行结果: 总计${count}, 成功${success_count}, 失败${error_count}`,
                    timestamp: new Date(stepTimestamp),
                    sessionId: sessionId,
                    stepId: stepId
                  });
                }
              }
              
              // Add reflection if available
              if (data.data.reflection) {
                stepMessage.push({
                  id: stepId + '_reflection',
                  type: 'system' as const,
                  content: `反思: ${data.data.reflection}`,
                  timestamp: new Date(stepTimestamp),
                  sessionId: sessionId,
                  stepId: stepId
                });
              }

              // Lakeview step details per agent消息定义
              if (data.data.lakeview_step) {
                const lv = data.data.lakeview_step;
                const content = `${lv.tags_emoji || ''} ${lv.desc_task || ''} · ${lv.desc_details || ''}`.trim();
                stepMessage.push({
                  id: stepId + '_lakeview_step',
                  type: 'system' as const,
                  content,
                  timestamp: new Date(stepTimestamp),
                  sessionId: sessionId,
                  stepId: stepId
                });
              }

              // Add lakeview summary if available
              if (data.data.lakeview_summary) {
                stepMessage.push({
                  id: stepId + '_lakeview',
                  type: 'system' as const,
                  content: `Lakeview: ${data.data.lakeview_summary}`,
                  timestamp: new Date(stepTimestamp),
                  sessionId: sessionId,
                  stepId: stepId
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
              id: makeMsgId(),
              type: 'system' as const,
              content: `✅ 任务完成\n执行时间: ${data.data.execution_time?.toFixed(2)}s\n步骤数: ${data.data.steps_count}\n结果: ${data.data.final_result || '成功'}`,
              timestamp: new Date(),
              sessionId: sessionId
            };
            
            const currentMessages = sessions.find(s => s.id === sessionId)?.messages || [];
            updateSession(sessionId, {
              messages: [...currentMessages, completionMessage]
            });

            // Ensure lakeview summary reply exists
            const lv = data.data.lakeview_summary;
            const hasLv = !!lv && typeof lv === 'string' && lv.trim().length > 0;
            if (!hasLv) {
              const stepNames = (data.data.steps || []).map((st: any) => st.tool_calls?.map((t: any) => t.name).join(', ')).filter(Boolean);
              const toolsUsed = stepNames.length ? Array.from(new Set(stepNames.join(', ').split(',').map((s: string) => s.trim()).filter(Boolean))).join(', ') : '-';
              const fallbackLv = `Lakeview: 执行完成。使用工具: ${toolsUsed}。最终结果: ${data.data.final_result || '成功'}`;
              const lvMsg = {
                id: makeMsgId(),
                type: 'system' as const,
                content: fallbackLv,
                timestamp: new Date(),
                sessionId: sessionId
              };
              const msgs2 = (sessions.find(s => s.id === sessionId)?.messages || []).concat([lvMsg]);
              updateSession(sessionId, { messages: msgs2 });
            } else {
              const lvMsg = {
                id: makeMsgId(),
                type: 'system' as const,
                content: `Lakeview: ${String(lv)}`,
                timestamp: new Date(),
                sessionId: sessionId
              };
              const msgs2 = (sessions.find(s => s.id === sessionId)?.messages || []).concat([lvMsg]);
              updateSession(sessionId, { messages: msgs2 });
            }
          }
          },
          (error) => {
            console.error('Streaming error:', error);
            toast.error('流式处理出错');
            
            // Add error message to session
            updateSession(sessionId, {
              messages: [...(sessions.find(s => s.id === sessionId)?.messages || []), {
                id: makeMsgId(),
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
    }
      // Unified streaming mode - remove non-streaming path
      try {
        // Use the streaming implementation directly
        setIsStreaming(true);
        setCurrentSteps([]);
        
        await apiClient.runInteractiveTaskStream(
          {
            session_id: sessionId,
            task: message,
            working_dir: workspaceRoot,
            prompt: systemPrompt as any,
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
              console.log('Session started:', data.data);
              const taskText = (data.data && data.data.task) ? String(data.data.task) : message;
              updateSession(sessionId!, {
                messages: [
                  ...(sessions.find(s => s.id === sessionId)?.messages || []),
                  {
                    id: 'task_' + Date.now(),
                    type: 'system' as const,
                    content: `task: ${taskText}`,
                    timestamp: new Date(),
                    sessionId: sessionId!
                  }
                ]
              });
            } else if (data.type === 'step') {
              setCurrentSteps(prev => [...prev, data.data]);
              
              // Process the step data and create meaningful messages
              const stepMessage = [];

              // Required fields summary
              const stepNumber = data.data.step_number;
              const stepTimestamp = data.data.timestamp;
              const stepId = `step_${stepNumber}_${stepTimestamp}`;
              const completed = String((data.data.state || '').toUpperCase() === 'COMPLETED');
              stepMessage.push({
                id: stepId + '_summary',
                type: 'system' as const,
                content: `步骤: ${stepNumber ?? '-'} | 完成: ${completed}`,
                timestamp: new Date(stepTimestamp),
                sessionId: sessionId,
                stepId: stepId,
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
                  id: stepId + '_response',
                  type: 'agent' as const,
                  content: content,
                  timestamp: new Date(stepTimestamp),
                  sessionId: sessionId,
                  stepId: stepId,
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
                      id: stepId + '_finish_reason',
                      type: 'system' as const,
                      content: `finish_reason: ${data.data.llm_response.finish_reason}`,
                      timestamp: new Date(stepTimestamp),
                      sessionId: sessionId,
                      stepId: stepId,
                    });
                  }
                } else if (data.data.llm_response.tool_calls && data.data.llm_response.tool_calls.length > 0) {
                  // If no text content but has tool calls, show tool execution status
                  const toolCallNames = data.data.llm_response.tool_calls.map((tool: any) => tool.name).join(', ');
                  stepMessage.push({
                    id: stepId + '_tools',
                    type: 'agent' as const,
                    content: `🔧 正在执行工具: ${toolCallNames}`,
                    timestamp: new Date(stepTimestamp),
                    sessionId: sessionId,
                    stepId: stepId,
                    metadata: {
                      model: data.data.llm_response.model,
                      usage: data.data.llm_response.usage,
                      finish_reason: data.data.llm_response.finish_reason,
                      is_tool_execution: true
                    }
                  });
                  // Explicitly print tool calls array
                  stepMessage.push({
                    id: stepId + '_tool_calls_list',
                    type: 'system' as const,
                    content: `tool_calls: ${JSON.stringify(data.data.llm_response.tool_calls)}`,
                    timestamp: new Date(stepTimestamp),
                    sessionId: sessionId,
                    stepId: stepId,
                  });
                } else {
                  // Even if content is empty, show model thinking status
                  stepMessage.push({
                    id: stepId + '_thinking',
                    type: 'agent' as const,
                    content: '🤔 AI正在思考中...',
                    timestamp: new Date(stepTimestamp),
                    sessionId: sessionId,
                    stepId: stepId,
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
              
              // Add tool calls information (simplified - backend only provides name and call_id)
              if (data.data.tool_calls && data.data.tool_calls.length > 0) {
                const toolNames = data.data.tool_calls.map((tool: any) => tool.name).join(', ');
                const toolCallCount = data.data.tool_calls.length;
                
                stepMessage.push({
                  id: stepId + '_tools',
                  type: 'system' as const,
                  content: `🔧 执行工具 (${toolCallCount}): ${toolNames}`,
                  timestamp: new Date(stepTimestamp),
                  sessionId: sessionId,
                  stepId: stepId
                });

                // Add tool results summary if available
                if (data.data.tool_results_summary) {
                  const { count = 0, success_count = 0, error_count = 0 } = data.data.tool_results_summary;
                  stepMessage.push({
                    id: stepId + '_tool_results',
                    type: 'system' as const,
                    content: `📊 工具执行结果: 总计${count}, 成功${success_count}, 失败${error_count}`,
                    timestamp: new Date(stepTimestamp),
                    sessionId: sessionId,
                    stepId: stepId
                  });
                }
              }
              
              // Add reflection if available
              if (data.data.reflection) {
                stepMessage.push({
                  id: stepId + '_reflection',
                  type: 'system' as const,
                  content: `反思: ${data.data.reflection}`,
                  timestamp: new Date(stepTimestamp),
                  sessionId: sessionId,
                  stepId: stepId
                });
              }

              // Add lakeview summary if available
              if (data.data.lakeview_summary) {
                stepMessage.push({
                  id: stepId + '_lakeview',
                  type: 'system' as const,
                  content: `Lakeview: ${data.data.lakeview_summary}`,
                  timestamp: new Date(stepTimestamp),
                  sessionId: sessionId,
                  stepId: stepId
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

            // Ensure lakeview summary reply exists
            const lv = data.data.lakeview_summary;
            const hasLv = !!lv && typeof lv === 'string' && lv.trim().length > 0;
            if (!hasLv) {
              const stepNames = (data.data.steps || []).map((st: any) => st.tool_calls?.map((t: any) => t.name).join(', ')).filter(Boolean);
              const toolsUsed = stepNames.length ? Array.from(new Set(stepNames.join(', ').split(',').map((s: string) => s.trim()).filter(Boolean))).join(', ') : '-';
              const fallbackLv = `Lakeview: 执行完成。使用工具: ${toolsUsed}。最终结果: ${data.data.final_result || '成功'}`;
              const lvMsg = {
                id: 'lakeview_' + Date.now(),
                type: 'system' as const,
                content: fallbackLv,
                timestamp: new Date(),
                sessionId: sessionId
              };
              const msgs2 = (sessions.find(s => s.id === sessionId)?.messages || []).concat([lvMsg]);
              updateSession(sessionId, { messages: msgs2 });
            } else {
              const lvMsg = {
                id: 'lakeview_' + Date.now(),
                type: 'system' as const,
                content: `Lakeview: ${String(lv)}`,
                timestamp: new Date(),
                sessionId: sessionId
              };
              const msgs2 = (sessions.find(s => s.id === sessionId)?.messages || []).concat([lvMsg]);
              updateSession(sessionId, { messages: msgs2 });
            }
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
            
            {/* System Settings Button - Replaces scattered controls */}
            <button
              onClick={() => setIsSystemSettingsOpen(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
              disabled={isStreaming}
            >
              <Settings className="h-4 w-4" />
              系统设置
            </button>
            
            {/* Session Info removed */}
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => createNewSession()}
              className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
              disabled={isStreaming}
            >
              新建会话
            </button>
          </div>
        </div>
        
        <div className="flex-1 flex overflow-hidden">
          <div className="w-64 border-r bg-muted/30 flex flex-col overflow-hidden">
            <FileTree onFileSelect={handleFileSelect} />
          </div>
          <div className="flex-1 flex flex-col">
            <div className="flex-1 border-b">
              <CodeEditor />
            </div>
            
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

        {isCommandOpen && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setIsCommandOpen(false)}>
            <div className="bg-background border rounded-md shadow-xl w-[600px] max-w-[90vw] p-4" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && commandText.trim()) {
                    handleSendMessage(commandText.trim(), true);
                    setCommandText('');
                    setIsCommandOpen(false);
                  } else if (e.key === 'Escape') {
                    setIsCommandOpen(false);
                  }
                }}
                placeholder="输入命令后按回车提交 (Cmd+Shift+K 打开)"
                className="w-full px-3 py-2 border rounded text-sm bg-background"
              />
            </div>
          </div>
        )}

        {isConsoleOpen && (
          <div className="fixed inset-0 z-[60] pointer-events-none">
            <div className="absolute inset-0 flex items-end justify-stretch pointer-events-none">
              <div className="w-full h-[40%] bg-background border-t shadow-lg pointer-events-auto">
                <StreamingConsole 
                  steps={currentSteps}
                  isStreaming={isStreaming}
                  messages={sessions.find(s => s.id === currentSessionId)?.messages || []}
                />
              </div>
            </div>
          </div>
        )}
        
            {/* System Settings Dialog */}
            <SystemSettings
              open={isSystemSettingsOpen}
              onOpenChange={setIsSystemSettingsOpen}
              systemPrompts={systemPrompts}
              currentPrompt={systemPrompt || ''}
              onPromptChange={setSystemPrompt}
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
            />
      </div>
    </ErrorBoundary>
  );
}

export default App;