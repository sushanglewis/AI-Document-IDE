import React, { useState } from 'react';
import { useAppStore } from '../lib/store';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Settings, Plus, Key, BrainCircuit, Globe, CheckCircle2, XCircle, Wrench, Terminal, Trash2, ArrowLeft } from 'lucide-react';
import { apiClient } from '../lib/api';
import Toast from '../lib/toast';
import { cn } from '../lib/utils';

interface SystemPrompt {
  id: string;
  name: string;
  content: string;
}

interface ModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

interface ToolConfig {
  id?: number;
  name: string;
  description: string;
  custom_name?: string;
  initial_name_zh?: string;
  is_custom?: boolean;
  api_url?: string;
  api_key?: string;
  request_method?: string;
  request_body_template?: string;
  parameter_schema?: string;
  curl_example?: string;
  app_id?: string;
}

interface SettingsPageProps {
  onClose: () => void;
  systemPrompts: SystemPrompt[];
  selectedPromptName?: string;
  onPromptChange: (prompt: any) => void;
  onSelectPrompt?: (name: string) => void;
  onSavePrompt: (prompt: SystemPrompt) => void;
  onDeletePrompt: (name: string) => void;
  modelConfig: ModelConfig;
  onModelConfigChange: (config: ModelConfig) => void;
  qualityReviewEnabled?: boolean;
  qualityReviewRules?: string;
  onQualityReviewEnabledChange?: (enabled: boolean) => void;
  onQualityReviewRulesChange?: (rules: string) => void;
  onTestConnectivity: (config: ModelConfig) => Promise<boolean>;
  onSaveModelConfig: (config: ModelConfig) => Promise<void>;
}

type SettingsTab = 'prompts' | 'model' | 'online' | 'tools';

export function SettingsPage({
  onClose,
  systemPrompts,
  selectedPromptName,
  onPromptChange,
  onSelectPrompt,
  onSavePrompt,
  onDeletePrompt,
  modelConfig,
  onModelConfigChange,
  qualityReviewEnabled = false,
  qualityReviewRules = '',
  onQualityReviewEnabledChange,
  onQualityReviewRulesChange,
  onTestConnectivity,
  onSaveModelConfig,
}: SettingsPageProps) {

  const { enabledTools, setEnabledTools } = useAppStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('prompts');
  const [newPrompt, setNewPrompt] = useState({ name: '', content: '' });
  const [onlineBaseUrl, setOnlineBaseUrl] = useState('http://10.0.2.34:7876');
  const [loadingBaseUrl, setLoadingBaseUrl] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [editingTool, setEditingTool] = useState<string | null>(null); // For quick rename in list
  const [customNameInput, setCustomNameInput] = useState('');

  // Unified Tool View State
  const [toolViewMode, setToolViewMode] = useState<'list' | 'create' | 'edit' | 'detail'>('list');
  const [currentTool, setCurrentTool] = useState<ToolConfig | null>(null);

  // Prompt View State
  const [promptViewMode, setPromptViewMode] = useState<'list' | 'create' | 'edit' | 'detail'>('list');
  
  // Form State (Unified)
  // Remove registerMode, assume Dify only
  const [difyConfig, setDifyConfig] = useState({
      type: 'workflow' as 'chat' | 'workflow',
      name: '',
      description: '',
      api_url: '',
      api_key: '',
      app_id: '',
      params: [] as { name: string; description: string; required: boolean; enum: string }[]
  });
  const [registerLoading, setRegisterLoading] = useState(false);

  // Initialize form when entering create/edit/detail mode
  React.useEffect(() => {
    if (toolViewMode === 'create') {
        setDifyConfig({
            type: 'workflow',
            name: '',
            description: '',
            api_url: '',
            api_key: '',
            app_id: '',
            params: []
        });
    } else if ((toolViewMode === 'edit' || toolViewMode === 'detail') && currentTool) {
        // Reverse engineer Dify config from ToolConfig
        let type: 'chat' | 'workflow' = 'workflow';
        let params: { name: string; description: string; required: boolean; enum: string }[] = [];

        try {
            // Try to determine type from request_body_template
            if (currentTool.request_body_template) {
                const template = JSON.parse(currentTool.request_body_template);
                if (template.query && template.query.includes('{{query}}')) {
                    type = 'chat';
                }
            }
        } catch { /* ignore */ }

        try {
            // Parse params from parameter_schema
            if (currentTool.parameter_schema) {
                const schema = JSON.parse(currentTool.parameter_schema);
                // Handle Standard JSON Schema (Object with properties)
                if (schema.properties) {
                    params = Object.entries(schema.properties).map(([key, val]: [string, any]) => ({
                        name: key,
                        description: val.description || '',
                        required: schema.required?.includes(key) || false,
                        enum: val.enum ? val.enum.join(', ') : ''
                    }));
                } 
                // Handle Legacy Array Format (Fallback)
                else if (Array.isArray(schema)) {
                    params = schema.map((p: any) => ({
                        name: p.name,
                        description: p.description || '',
                        required: !!p.required,
                        enum: ''
                    }));
                }

                // Filter out 'query' for chat apps as it's implicit in UI
                if (type === 'chat') {
                    params = params.filter(p => p.name !== 'query');
                }
            }
        } catch { /* ignore */ }

        setDifyConfig({
            type,
            name: currentTool.name,
            description: currentTool.description,
            api_url: currentTool.api_url || '',
            api_key: currentTool.api_key || '',
            app_id: currentTool.app_id || '',
            params
        });
    }
  }, [toolViewMode, currentTool]);

  const handleSaveTool = async () => {
      let payload: any = {};

      if (!difyConfig.name || !difyConfig.api_url || !difyConfig.api_key) {
          alert('请填写必要信息');
          return;
      }

      // Generate Schema and Template
      const params = [...difyConfig.params];
      if (difyConfig.type === 'chat') {
          // Ensure query param exists for chat
          if (!params.find(p => p.name === 'query')) {
              params.unshift({ name: 'query', description: '用户输入的对话内容', required: true, enum: '' });
          }
      }

      // 1. Parameter Schema
      const properties: any = {};
      const required: string[] = [];
      
      params.forEach(p => {
          properties[p.name] = {
              type: "string",
              description: p.description,
          };
          if (p.enum && p.enum.trim()) {
              properties[p.name].enum = p.enum.split(',').map(s => s.trim()).filter(Boolean);
          }
          if (p.required) {
              required.push(p.name);
          }
      });

      const schema = {
          type: "object",
          properties,
          required
      };

      // 2. Request Body Template
      const inputsObj: any = {};
      
      // Determine if we are in Chat or Workflow mode based on type
      const isChat = difyConfig.type === 'chat';
      
      difyConfig.params.forEach(p => {
          // For Chat App: 'query' is a top-level field, NOT in inputs.
          if (isChat && p.name === 'query') return;
          
          // For Workflow App: All params go into 'inputs'.
          inputsObj[p.name] = `{{${p.name}}}`;
      });

      let bodyObj: any = {
          inputs: inputsObj,
          response_mode: "blocking", // User reported 'streaming' might be default but 'blocking' is safer for tool calls? Dify API defaults to blocking usually.
          user: "user-id"
      };

      if (isChat) {
          // Chat App specific fields
          // If user provided a 'query' param, map it here.
          // If not, we default to empty string or whatever the user intends?
          // Usually for a Chat Tool, the LLM should provide a 'query' argument.
          bodyObj.query = "{{query}}"; 
          bodyObj.conversation_id = "";
          
          // Note: User reported sending query='{{query}}' literally.
          // This means the tool call arguments MUST contain 'query'.
          // If the user didn't add 'query' to the params list, the LLM won't generate it.
          // So we must ensure 'query' is in the parameters list or implicitly added.
          // But here we are just generating the template. 
          // The 'schema' above (lines 184-201) determines what the LLM sees.
      }

      payload = {
          name: difyConfig.name,
          description: difyConfig.description || (isChat ? 'Dify Chat App' : 'Dify Workflow App'),
          api_url: difyConfig.api_url,
          api_key: difyConfig.api_key,
          request_body_template: JSON.stringify(bodyObj, null, 2),
          parameter_schema: JSON.stringify(schema, null, 2),
          curl_example: '',
          app_id: difyConfig.app_id
      };

      try {
          setRegisterLoading(true);
          
          if (toolViewMode === 'edit' && currentTool?.id) {
              await apiClient.updateCustomTool(currentTool.id, payload);
              Toast.success('工具修改成功！');
          } else {
              await apiClient.createCustomTool(payload);
              Toast.success('工具注册成功！');
          }

          
          setToolViewMode('list');
          setCurrentTool(null);
          
          // Refresh tools list
          setLoadingTools(true);
          apiClient.getAvailableTools()
            .then(data => setTools(data.tools))
            .catch(() => Toast.error('获取工具列表失败'))
            .finally(() => setLoadingTools(false));
      } catch (e) {
          Toast.error((toolViewMode === 'edit' ? '修改' : '注册') + '失败: ' + (e as any).message);
      } finally {
          setRegisterLoading(false);
      }
  };

  React.useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.getOnlineBaseUrl();
        if (res?.base_url) setOnlineBaseUrl(res.base_url);
      } catch { /* noop */ }
    })();
  }, []);

  React.useEffect(() => {
    if (activeTab === 'tools') {
      setLoadingTools(true);
      apiClient.getAvailableTools()
        .then(data => {
          setTools(data.tools);
          // Default enable 'sequentialthinking' and 'task_done' if enabledTools is empty
          // or ensure they are enabled if we want to enforce "always default"
          // Here we only set if enabledTools is empty to respect user persistence, 
          // but we add them to the list if they are missing from a "fresh" state.
          const currentEnabled = useAppStore.getState().enabledTools;
          if (currentEnabled.length === 0) {
             // Filter to only available tools
             // The user requirement "工具列表中永远默认启用顺序思考、任务完成" 
             // suggests these MUST be enabled.
             // Let's enable all by default if empty, but ensure these two are there.
             const allNames = data.tools.map((t: ToolConfig) => t.name);
             setEnabledTools(allNames);
          } else {
             // Ensure defaults are present? No, respect user choice if they disabled them.
             // But if the user meant "Always enable them when I open the list", that's annoying.
             // "Always default enable" -> In the default state (initial), they are enabled.
          }
        })
        .catch(() => Toast.error('获取工具列表失败'))
        .finally(() => setLoadingTools(false));
    }
  }, [activeTab]);



  const handleDeleteTool = async (tool: ToolConfig) => {
    if (!tool.id) return;
    if (!confirm(`确定要删除工具 "${tool.name}" 吗？`)) return;
    
    try {
        setLoadingTools(true);
        await apiClient.deleteCustomTool(tool.id);
        Toast.success('工具删除成功');
        
        // Refresh tools
        const data = await apiClient.getAvailableTools();
        setTools(data.tools);
    } catch (e) {
        Toast.error('删除失败: ' + (e as any).message);
    } finally {
        setLoadingTools(false);
    }
  };

  const handleSaveToolConfig = async (name: string) => {
    try {
      const res = await apiClient.updateToolConfig(name, customNameInput);
      setTools(prev => prev.map(t => t.name === name ? { ...t, custom_name: res.custom_name } : t));
      setEditingTool(null);
      Toast.success('工具名称已更新');
    } catch {
      Toast.error('更新失败');
    }
  };

  const handleSaveNewPrompt = () => {
    if (newPrompt.name.trim() && newPrompt.content.trim()) {
      const payload = {
        text: newPrompt.content.trim(),
        enable_quality_review: !!qualityReviewEnabled,
        quality_review_rules: qualityReviewRules || ''
      };
      const existingPrompt = systemPrompts.find(p => p.name === newPrompt.name.trim());
      const prompt: SystemPrompt = {
        id: existingPrompt ? existingPrompt.id : Date.now().toString(),
        name: newPrompt.name.trim(),
        content: JSON.stringify(payload)
      };
      onSavePrompt(prompt);
      setNewPrompt({ name: '', content: '' });
      setPromptViewMode('list');
    }
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionStatus('idle');
    try {
      const success = await onTestConnectivity(modelConfig);
      setConnectionStatus(success ? 'success' : 'error');
    } catch (e) {
      setConnectionStatus('error');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSaveModel = async () => {
    try {
      await onSaveModelConfig(modelConfig);
    } catch (e) {
      // Error handling is likely done in parent or ignored if toast is shown there
    }
  };

  const menuItems = [
    { id: 'prompts', label: '模式配置', icon: BrainCircuit },
    { id: 'model', label: '模型管理', icon: Key },
    { id: 'tools', label: '工具管理', icon: Wrench },
    { id: 'online', label: 'Online地址', icon: Globe },
  ];

  return (
    <div className="flex h-full bg-background text-foreground">
      {/* Sidebar */}
      <div className="w-64 border-r bg-muted/30 flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Settings className="w-5 h-5" />
            设置
          </h2>
        </div>
        <div className="flex-1 py-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as SettingsTab)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors",
                  activeTab === item.id 
                    ? "bg-accent text-accent-foreground font-medium" 
                    : "hover:bg-muted text-muted-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="p-4 border-t">
          <Button variant="outline" className="w-full" onClick={onClose}>
            返回编辑器
          </Button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-8 h-full flex flex-col">
          {activeTab === 'prompts' && (
            <div className="space-y-6 h-full flex flex-col">
              {promptViewMode === 'list' ? (
                <>
                  <div className="flex items-center justify-between shrink-0">
                    <div>
                      <h3 className="text-2xl font-semibold mb-1">模式配置</h3>
                      <p className="text-muted-foreground">管理系统的预设提示词模式</p>
                    </div>
                    <Button 
                      onClick={() => { setNewPrompt({ name: '', content: '' }); setPromptViewMode('create'); }}
                      className="flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      新建模式
                    </Button>
                  </div>

                  <div className="grid gap-4 overflow-y-auto pr-2 pb-4">
                    {systemPrompts.map((prompt) => (
                      <div
                        key={prompt.id}
                        className={cn(
                          "border rounded-lg p-4 transition-all hover:border-primary/50",
                          prompt.name === selectedPromptName ? 'bg-accent/50 border-primary' : 'bg-card'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div 
                            className="cursor-pointer flex-1"
                            onClick={() => {
                              let contentText = prompt.content;
                              try {
                                const obj = JSON.parse(prompt.content);
                                if (typeof obj.text === 'string') contentText = obj.text;
                                if (typeof obj.enable_quality_review === 'boolean') onQualityReviewEnabledChange?.(obj.enable_quality_review);
                                if (typeof obj.quality_review_rules === 'string') onQualityReviewRulesChange?.(obj.quality_review_rules);
                              } catch { void 0; }
                              onPromptChange(contentText);
                              onSelectPrompt?.(prompt.name);
                            }}
                          >
                            <h4 className="font-medium text-lg">{prompt.name}</h4>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2 opacity-70">
                              {(() => {
                                try {
                                  const obj = JSON.parse(prompt.content);
                                  return typeof obj.text === 'string' ? obj.text : prompt.content;
                                } catch {
                                  return prompt.content;
                                }
                              })()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 ml-4">
                            <Button size="sm" variant="outline" onClick={() => {
                                let contentText = prompt.content;
                                try {
                                  const obj = JSON.parse(prompt.content);
                                  if (typeof obj.text === 'string') contentText = obj.text;
                                  if (typeof obj.enable_quality_review === 'boolean') onQualityReviewEnabledChange?.(obj.enable_quality_review);
                                  if (typeof obj.quality_review_rules === 'string') onQualityReviewRulesChange?.(obj.quality_review_rules);
                                } catch {}
                                setNewPrompt({ name: prompt.name, content: contentText });
                                setPromptViewMode('detail');
                            }}>详情</Button>
                            <Button size="sm" variant="secondary" onClick={() => {
                                let contentText = prompt.content;
                                try {
                                  const obj = JSON.parse(prompt.content);
                                  if (typeof obj.text === 'string') contentText = obj.text;
                                  if (typeof obj.enable_quality_review === 'boolean') onQualityReviewEnabledChange?.(obj.enable_quality_review);
                                  if (typeof obj.quality_review_rules === 'string') onQualityReviewRulesChange?.(obj.quality_review_rules);
                                } catch {}
                                setNewPrompt({ name: prompt.name, content: contentText });
                                setPromptViewMode('edit');
                            }}>编辑</Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDeletePrompt?.(prompt.name)}>删除</Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                 <div className="flex-1 overflow-hidden flex flex-col gap-4 animate-in slide-in-from-right-4 fade-in duration-200">
                    <div className="flex items-center gap-4 pb-4 border-b flex-shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => setPromptViewMode('list')}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div className="flex-1">
                            <h3 className="text-xl font-semibold">
                                {promptViewMode === 'create' ? '新建模式' : (promptViewMode === 'edit' ? '编辑模式' : '模式详情')}
                            </h3>
                            <p className="text-sm text-muted-foreground">配置系统提示词模式</p>
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto pr-2 pb-4 space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="prompt-name">模式名称</Label>
                        <Input
                          id="prompt-name"
                          value={newPrompt.name}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPrompt(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="例如：Python 专家"
                          disabled={promptViewMode === 'detail' || promptViewMode === 'edit'} 
                        />
                      </div>
                      <div className="space-y-2 flex-1 flex flex-col min-h-[300px]">
                        <Label htmlFor="prompt-content">提示词内容</Label>
                        <Textarea
                          id="prompt-content"
                          value={newPrompt.content}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewPrompt(prev => ({ ...prev, content: e.target.value }))}
                          placeholder="输入详细的系统提示词..."
                          className="font-mono text-sm flex-1"
                          disabled={promptViewMode === 'detail'}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>质量审查设置</Label>
                        <div className="flex items-center gap-2 border p-3 rounded-md bg-muted/20">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={qualityReviewEnabled}
                            onChange={(e) => onQualityReviewEnabledChange?.(e.target.checked)}
                            disabled={promptViewMode === 'detail'}
                          />
                          <span className="text-sm">启用代码质量审查</span>
                        </div>
                      </div>
                      {qualityReviewEnabled && (
                        <div className="space-y-2">
                          <Label htmlFor="qr-rules">审查规则</Label>
                          <Textarea
                            id="qr-rules"
                            value={qualityReviewRules}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onQualityReviewRulesChange?.(e.target.value)}
                            placeholder="输入具体的审查规则..."
                            rows={3}
                            disabled={promptViewMode === 'detail'}
                          />
                        </div>
                      )}
                    </div>

                    {promptViewMode !== 'detail' && (
                        <div className="flex justify-end gap-2 pt-4 border-t mt-auto flex-shrink-0">
                            <Button variant="outline" onClick={() => setPromptViewMode('list')}>取消</Button>
                            <Button onClick={() => { handleSaveNewPrompt(); }}>保存模式</Button>
                        </div>
                    )}
                 </div>
              )}
            </div>
          )}

          {activeTab === 'model' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-2xl font-semibold mb-1">模型管理</h3>
                <p className="text-muted-foreground">配置 LLM 提供商与连接参数</p>
              </div>
              
              <div className="space-y-6 max-w-2xl">
                <div className="space-y-3">
                  <Label className="text-base">提供商选择</Label>
                  {/* Quick Select Tiles */}
                  <div className="grid grid-cols-3 gap-3 pt-1">
                    {[
                      { id: 'openai', label: 'OpenAI' },
                      { id: 'anthropic', label: 'Anthropic' },
                      { id: 'google', label: 'Google' },
                      { id: 'azure', label: 'Azure OpenAI' },
                      { id: 'ollama', label: 'Ollama' },
                      { id: 'openrouter', label: 'OpenRouter' },
                      { id: 'moonshot', label: 'Moonshot' },
                    ].map(provider => (
                      <div
                        key={provider.id}
                        onClick={() => onModelConfigChange({ ...modelConfig, provider: provider.id })}
                        className={cn(
                          "cursor-pointer flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 transition-all hover:bg-accent hover:border-primary/50",
                          modelConfig.provider === provider.id ? "bg-accent border-primary shadow-sm" : "bg-card border-muted"
                        )}
                      >
                        <div className={cn(
                          "w-3 h-3 rounded-full transition-colors",
                          modelConfig.provider === provider.id ? "bg-primary" : "bg-muted-foreground/50"
                        )} />
                        <span className="font-medium text-sm">{provider.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="model">模型名称</Label>
                  <Input
                    id="model"
                    value={modelConfig.model}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onModelConfigChange({ ...modelConfig, model: e.target.value })}
                    placeholder="例如：gpt-4-turbo"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="api-key">API Key</Label>
                  <Input
                    id="api-key"
                    type="password"
                    value={modelConfig.apiKey}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onModelConfigChange({ ...modelConfig, apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="base-url">Base URL (可选)</Label>
                  <Input
                    id="base-url"
                    value={modelConfig.baseUrl || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onModelConfigChange({ ...modelConfig, baseUrl: e.target.value })}
                    placeholder="例如：https://api.openai.com/v1"
                  />
                </div>

                <div className="pt-4 flex items-center gap-4">
                  <Button 
                    onClick={handleTestConnection} 
                    disabled={isTestingConnection}
                    variant="outline"
                    className="w-32"
                  >
                    {isTestingConnection ? '测试中...' : '测试连接'}
                  </Button>

                  <Button 
                    onClick={handleSaveModel} 
                    className="w-32"
                  >
                    保存配置
                  </Button>
                  
                  {connectionStatus === 'success' && (
                    <div className="flex items-center gap-2 text-green-600 animate-in fade-in slide-in-from-left-2">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="text-sm font-medium">连接成功</span>
                    </div>
                  )}
                  
                  {connectionStatus === 'error' && (
                    <div className="flex items-center gap-2 text-destructive animate-in fade-in slide-in-from-left-2">
                      <XCircle className="w-5 h-5" />
                      <span className="text-sm font-medium">连接失败，请检查配置</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="flex-1 overflow-hidden flex flex-col gap-4 h-full">
              {toolViewMode === 'list' ? (
                <>
                  <div className="flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-2xl font-semibold mb-1">工具管理</h3>
                      <span className="text-sm bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        已启用 {enabledTools.length} 个
                      </span>
                    </div>
                    <p className="text-muted-foreground">启用或禁用工具，已启用的工具将出现在聊天工具选择器中。</p>
                  </div>
                  
                  {loadingTools ? (
                    <div className="text-center py-8 text-muted-foreground">加载中...</div>
                  ) : (
                    <div className="flex-1 overflow-hidden flex flex-col gap-4">
                      {/* Built-in Tools Section */}
                      <div className="flex flex-col gap-2 h-1/2 min-h-0">
                        <div className="text-sm font-semibold flex items-center gap-2">
                          <Terminal className="w-4 h-4" />
                          内置工具
                        </div>
                        <div className="flex-1 border rounded-lg p-2 overflow-y-auto bg-muted/10">
                          {tools.filter(t => !t.is_custom).map(tool => (
                            <div key={tool.name} className="flex items-center justify-between p-3 hover:bg-accent/50 rounded border-b last:border-0 bg-card mb-2 last:mb-0">
                              <div className="flex-1 flex flex-col gap-0.5 overflow-hidden mr-4 cursor-pointer" onClick={() => { setCurrentTool(tool); setToolViewMode('detail'); }}>
                                 <div className="flex items-center gap-2">
                                    <span className="font-medium truncate" title={tool.name}>
                                      {tool.custom_name || tool.initial_name_zh || tool.name}
                                    </span>
                                    <span className="text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground font-mono">
                                      {tool.name}
                                    </span>
                                 </div>
                                <span className="text-xs text-muted-foreground truncate" title={tool.description}>
                                  {tool.description || tool.name}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-2">
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setCurrentTool(tool); setToolViewMode('detail'); }}>详情</Button>
                                  
                                  {/* Rename Button */}
                                  {editingTool === tool.name ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        value={customNameInput}
                                        onChange={(e) => setCustomNameInput(e.target.value)}
                                        className="w-32 h-7 text-xs"
                                        placeholder="自定义名称"
                                        autoFocus
                                      />
                                      <Button size="sm" className="h-7 px-2 text-xs" onClick={() => handleSaveToolConfig(tool.name)}>保存</Button>
                                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingTool(null)}>取消</Button>
                                    </div>
                                  ) : (
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      className="h-7 px-2 text-xs"
                                      onClick={() => {
                                        setEditingTool(tool.name);
                                        setCustomNameInput(tool.custom_name || tool.initial_name_zh || tool.name);
                                      }}
                                    >
                                      重命名
                                    </Button>
                                  )}

                                  {/* Switch */}
                                  <div 
                                    className={cn(
                                      "w-10 h-5 rounded-full p-1 cursor-pointer transition-colors relative flex-shrink-0",
                                      enabledTools.includes(tool.name) ? "bg-primary" : "bg-muted"
                                    )}
                                    onClick={() => {
                                      if (enabledTools.includes(tool.name)) {
                                        setEnabledTools(enabledTools.filter(t => t !== tool.name));
                                      } else {
                                        setEnabledTools([...enabledTools, tool.name]);
                                      }
                                    }}
                                  >
                                    <div className={cn(
                                      "w-3 h-3 rounded-full bg-background shadow-sm transition-transform",
                                      enabledTools.includes(tool.name) ? "translate-x-5" : "translate-x-0"
                                    )} />
                                  </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Custom Tools Section */}
                      <div className="flex flex-col gap-2 h-1/2 min-h-0">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold flex items-center gap-2">
                            <Wrench className="w-4 h-4" />
                            自定义工具 (Dify)
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 text-xs gap-1"
                            onClick={() => { setCurrentTool(null); setToolViewMode('create'); }}
                          >
                            <Plus className="w-3 h-3" />
                            注册新工具
                          </Button>
                        </div>
                        <div className="flex-1 border rounded-lg p-2 overflow-y-auto bg-muted/10">
                          {tools.filter(t => t.is_custom).map(tool => (
                            <div key={tool.name} className="flex items-center justify-between p-3 hover:bg-accent/50 rounded border-b last:border-0 bg-card mb-2 last:mb-0">
                              <div className="flex-1 flex flex-col gap-0.5 overflow-hidden mr-4 cursor-pointer" onClick={() => { setCurrentTool(tool); setToolViewMode('detail'); }}>
                                 <div className="flex items-center gap-2">
                                    <span className="font-medium truncate" title={tool.name}>
                                      {tool.custom_name || tool.initial_name_zh || tool.name}
                                    </span>
                                    <span className="text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground font-mono">
                                      {tool.name}
                                    </span>
                                 </div>
                                <span className="text-xs text-muted-foreground truncate" title={tool.description}>
                                  {tool.description || tool.name}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-2">
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setCurrentTool(tool); setToolViewMode('detail'); }}>详情</Button>
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setCurrentTool(tool); setToolViewMode('edit'); }}>修改</Button>
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => handleDeleteTool(tool)}>
                                    <Trash2 className="w-3 h-3" />
                                  </Button>

                                  {/* Rename Button */}
                                  {editingTool === tool.name ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        value={customNameInput}
                                        onChange={(e) => setCustomNameInput(e.target.value)}
                                        className="w-32 h-7 text-xs"
                                        placeholder="自定义名称"
                                        autoFocus
                                      />
                                      <Button size="sm" className="h-7 px-2 text-xs" onClick={() => handleSaveToolConfig(tool.name)}>保存</Button>
                                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingTool(null)}>取消</Button>
                                    </div>
                                  ) : (
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      className="h-7 px-2 text-xs"
                                      onClick={() => {
                                        setEditingTool(tool.name);
                                        setCustomNameInput(tool.custom_name || tool.initial_name_zh || tool.name);
                                      }}
                                    >
                                      重命名
                                    </Button>
                                  )}

                                  {/* Switch */}
                                  <div 
                                    className={cn(
                                      "w-10 h-5 rounded-full p-1 cursor-pointer transition-colors relative flex-shrink-0",
                                      enabledTools.includes(tool.name) ? "bg-primary" : "bg-muted"
                                    )}
                                    onClick={() => {
                                      if (enabledTools.includes(tool.name)) {
                                        setEnabledTools(enabledTools.filter(t => t !== tool.name));
                                      } else {
                                        setEnabledTools([...enabledTools, tool.name]);
                                      }
                                    }}
                                  >
                                    <div className={cn(
                                      "w-3 h-3 rounded-full bg-background shadow-sm transition-transform",
                                      enabledTools.includes(tool.name) ? "translate-x-5" : "translate-x-0"
                                    )} />
                                  </div>
                              </div>
                            </div>
                          ))}
                          {tools.filter(t => t.is_custom).length === 0 && (
                              <div className="text-center py-8 text-muted-foreground text-sm">
                                  暂无自定义工具
                              </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                // Tool Form View (Create / Edit / Detail)
                <div className="flex-1 overflow-hidden flex flex-col gap-4">
                    <div className="flex items-center gap-4 pb-4 border-b flex-shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => { setToolViewMode('list'); setCurrentTool(null); }}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div className="flex-1">
                            <h3 className="text-xl font-semibold">
                                {toolViewMode === 'create' ? '注册新工具' : (toolViewMode === 'edit' ? '修改工具' : '工具详情')}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {toolViewMode === 'detail' ? (currentTool?.custom_name || currentTool?.name) : '配置自定义工具参数'}
                            </p>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-2 pb-4">
                        {/* Only Dify Mode Supported Now */}
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div onClick={() => toolViewMode === 'create' && setDifyConfig(prev => ({...prev, type: 'workflow'}))} 
                                    className={cn("border p-4 rounded cursor-pointer hover:border-primary transition-colors", difyConfig.type === 'workflow' ? "border-primary bg-accent/50" : "bg-card")}>
                                <div className="font-semibold">Workflow</div>
                                <div className="text-xs text-muted-foreground">工作流应用</div>
                                </div>
                                <div onClick={() => toolViewMode === 'create' && setDifyConfig(prev => ({...prev, type: 'chat'}))} 
                                    className={cn("border p-4 rounded cursor-pointer hover:border-primary transition-colors", difyConfig.type === 'chat' ? "border-primary bg-accent/50" : "bg-card")}>
                                <div className="font-semibold">Chatflow</div>
                                <div className="text-xs text-muted-foreground">对话应用</div>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>工具名称 (唯一标识)</Label>
                                <Input value={difyConfig.name} onChange={e => setDifyConfig(prev => ({...prev, name: e.target.value}))} placeholder="例如: dify_search" disabled={toolViewMode === 'detail'} />
                            </div>
                            <div className="space-y-2">
                                <Label>描述</Label>
                                <Input value={difyConfig.description} onChange={e => setDifyConfig(prev => ({...prev, description: e.target.value}))} placeholder="工具的功能描述" disabled={toolViewMode === 'detail'} />
                            </div>
                            </div>
                            
                            <div className="space-y-2">
                                <Label>API Endpoint URL</Label>
                                <Input 
                                    value={difyConfig.api_url} 
                                    onChange={e => {
                                        const val = e.target.value;
                                        let newUrl = val;
                                        let appId = difyConfig.app_id;
                                        
                                        // Auto-detect from dashboard URL
                                        // Pattern: http(s)://host:port/app/APP_ID/...
                                        const match = val.match(/^(https?:\/\/[^\/]+)\/app\/([a-f0-9-]+)/);
                                        if (match) {
                                            let base = match[1];
                                            const id = match[2];
                                            appId = id;
                                            
                                            // Intelligent Port Correction for Dify
                                            // If user pastes URL with port 3000 (Next.js Frontend), it usually means they are bypassing Nginx.
                                            // The API is typically served via Nginx on Port 80 (no port) or directly on 5001.
                                            // We'll try to strip port 3000 to use default (80) which is the standard Nginx entry.
                                            if (base.includes(':3000')) {
                                                base = base.replace(':3000', ''); 
                                                // Toast.warning("检测到前端端口 3000，已自动修正为标准 API 端口");
                                            }
                                            
                                            // Construct API URL based on selected type
                                            if (difyConfig.type === 'workflow') {
                                                newUrl = `${base}/v1/workflows/run`;
                                            } else {
                                                newUrl = `${base}/v1/chat-messages`;
                                            }
                                            
                                            // Toast.info(`已自动识别 API 地址和 App ID`); // Toast might not be available or imported
                                        }
                                        setDifyConfig(prev => ({...prev, api_url: newUrl, app_id: appId}));
                                    }} 
                                    placeholder="粘贴 Dify App Dashboard URL 自动识别，或输入完整 API 地址" 
                                    disabled={toolViewMode === 'detail'} 
                                />
                                <div className="text-[11px] text-muted-foreground space-y-1 bg-muted/20 p-2 rounded">
                                    <p className="font-semibold">使用说明：</p>
                                    <ul className="list-disc pl-4 space-y-0.5">
                                        <li><strong>Chatflow</strong>: 对应 API <code>/v1/chat-messages</code>，参数位于顶层</li>
                                        <li><strong>Workflow</strong>: 对应 API <code>/v1/workflows/run</code>，参数位于 <code>inputs</code> 对象内</li>
                                        <li>可以直接粘贴 Dashboard URL (如 <code>.../app/fb8e.../develop</code>)，系统将自动转换为正确的 API Endpoint。</li>
                                        <li>注意：如果您的 Dashboard URL 带有端口 3000，请确保 API 服务也运行在该端口（通常 API 运行在 80 或 5001）。系统会自动尝试去除 3000 端口。</li>
                                        <li>API Key 请在 Dify 应用的 "访问 API" 页面获取。</li>
                                    </ul>
                                </div>
                            </div>
                            
                            <div className="space-y-2">
                                <Label>API Key</Label>
                                <Input type="password" value={difyConfig.api_key} onChange={e => setDifyConfig(prev => ({...prev, api_key: e.target.value}))} placeholder="app-..." disabled={toolViewMode === 'detail'} />
                            </div>

                            <div className="space-y-2">
                                <Label>App ID (可选)</Label>
                                <Input value={difyConfig.app_id} onChange={e => setDifyConfig(prev => ({...prev, app_id: e.target.value}))} placeholder="fb8e3091-bce5-49ac-9086-dfa7bcf4d5df" disabled={toolViewMode === 'detail'} />
                            </div>

                            <div className="space-y-2 border rounded-md p-3 bg-muted/10">
                                <div className="flex justify-between items-center mb-2">
                                    <Label>输入参数配置</Label>
                                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDifyConfig(prev => ({...prev, params: [...prev.params, {name: '', description: '', required: true, enum: ''}]}))} disabled={toolViewMode === 'detail'}>
                                        <Plus className="w-3 h-3 mr-1"/> 添加参数
                                    </Button>
                                </div>
                                <div className="space-y-3 max-h-[300px] overflow-y-auto p-1">
                                    {difyConfig.params.map((p, i) => (
                                        <div key={i} className="border p-2 rounded bg-background shadow-sm">
                                            <div className="flex gap-2 mb-2">
                                                <Input placeholder="参数名 (如: topic)" value={p.name} onChange={e => {
                                                    const newParams = [...difyConfig.params];
                                                    newParams[i].name = e.target.value;
                                                    setDifyConfig(prev => ({...prev, params: newParams}));
                                                }} className="w-1/3 h-7 text-xs" disabled={toolViewMode === 'detail'} />
                                                <Input placeholder="参数描述" value={p.description} onChange={e => {
                                                    const newParams = [...difyConfig.params];
                                                    newParams[i].description = e.target.value;
                                                    setDifyConfig(prev => ({...prev, params: newParams}));
                                                }} className="flex-1 h-7 text-xs" disabled={toolViewMode === 'detail'} />
                                                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => {
                                                    const newParams = difyConfig.params.filter((_, idx) => idx !== i);
                                                    setDifyConfig(prev => ({...prev, params: newParams}));
                                                }} disabled={toolViewMode === 'detail'}>
                                                    <XCircle className="w-4 h-4 text-destructive" />
                                                </Button>
                                            </div>
                                            <div className="flex gap-2 items-center">
                                                <Input placeholder="枚举值 (逗号分隔，如: A, B, C)" value={p.enum} onChange={e => {
                                                    const newParams = [...difyConfig.params];
                                                    newParams[i].enum = e.target.value;
                                                    setDifyConfig(prev => ({...prev, params: newParams}));
                                                }} className="flex-1 h-7 text-xs" disabled={toolViewMode === 'detail'} />
                                                <label className="flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer select-none text-muted-foreground hover:text-foreground">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={p.required} 
                                                        onChange={e => {
                                                            const newParams = [...difyConfig.params];
                                                            newParams[i].required = e.target.checked;
                                                            setDifyConfig(prev => ({...prev, params: newParams}));
                                                        }}
                                                        disabled={toolViewMode === 'detail'}
                                                        className="rounded border-gray-300 text-primary focus:ring-primary"
                                                    /> 
                                                    必填
                                                </label>
                                            </div>
                                        </div>
                                    ))}
                                    {difyConfig.params.length === 0 && (
                                        <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded">
                                            {difyConfig.type === 'chat' ? '默认包含 query 参数，可添加额外 inputs 参数' : '请添加工作流输入参数'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {toolViewMode !== 'detail' && (
                        <div className="flex justify-end gap-2 pt-4 border-t mt-auto flex-shrink-0">
                            <Button variant="outline" onClick={() => { setToolViewMode('list'); setCurrentTool(null); }}>取消</Button>
                            <Button onClick={handleSaveTool} disabled={registerLoading}>
                                {registerLoading ? <span className="flex items-center gap-2"><span className="animate-spin">⏳</span> 保存中...</span> : (toolViewMode === 'create' ? '注册工具' : '保存修改')}
                            </Button>
                        </div>
                    )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'online' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-2xl font-semibold mb-1">Online 服务设置</h3>
                <p className="text-muted-foreground">配置在线服务的连接地址</p>
              </div>
              
              <div className="space-y-4 max-w-2xl">
                <div className="space-y-2">
                  <Label htmlFor="online-base-url">服务地址</Label>
                  <div className="flex gap-2">
                    <Input
                      id="online-base-url"
                      value={onlineBaseUrl}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOnlineBaseUrl(e.target.value)}
                      placeholder="http://host:port"
                      className="flex-1"
                    />
                    <Button
                      onClick={async () => {
                        setLoadingBaseUrl(true);
                        try {
                          const res = await apiClient.setOnlineBaseUrl(onlineBaseUrl.trim());
                          setOnlineBaseUrl(res.base_url);
                          Toast.success('地址已保存');
                        } catch {
                          Toast.error('保存失败');
                        } finally {
                          setLoadingBaseUrl(false);
                        }
                      }}
                      disabled={!onlineBaseUrl.trim() || loadingBaseUrl}
                    >
                      保存
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    用于 Online 创建/搜索/详情请求的服务端地址
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
