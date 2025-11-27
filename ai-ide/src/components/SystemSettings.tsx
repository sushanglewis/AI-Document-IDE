import React, { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Settings, Plus, Key, BrainCircuit, Globe } from 'lucide-react';
import { apiClient } from '../lib/api';
import Toast from '../lib/toast';

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

interface SystemSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  onViewPrompt?: (name: string) => void;
  onEditPrompt?: (name: string) => void;
}

export function SystemSettings({
  open,
  onOpenChange,
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
  onViewPrompt,
  onEditPrompt,
}: SystemSettingsProps) {
  const [activeTab, setActiveTab] = useState('prompts');
  const [newPrompt, setNewPrompt] = useState({ name: '', content: '' });
  const [newPromptDialogOpen, setNewPromptDialogOpen] = useState(false);
  const [onlineBaseUrl, setOnlineBaseUrl] = useState('http://10.0.2.34:7876');
  const [loadingBaseUrl, setLoadingBaseUrl] = useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.getOnlineBaseUrl();
        if (res?.base_url) setOnlineBaseUrl(res.base_url);
      } catch { /* noop */ }
    })();
  }, [open]);

  const handleSaveNewPrompt = () => {
    if (newPrompt.name.trim() && newPrompt.content.trim()) {
      const payload = {
        text: newPrompt.content.trim(),
        enable_quality_review: !!qualityReviewEnabled,
        quality_review_rules: qualityReviewRules || ''
      };
      const prompt: SystemPrompt = {
        id: Date.now().toString(),
        name: newPrompt.name.trim(),
        content: JSON.stringify(payload)
      };
      onSavePrompt(prompt);
      setNewPrompt({ name: '', content: '' });
      setNewPromptDialogOpen(false);
    }
  };



  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            系统设置
          </DialogTitle>
          <DialogDescription>
            配置系统提示词与模型设置
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="prompts" className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4" />
              模式配置
            </TabsTrigger>
            <TabsTrigger value="model" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              模型管理
            </TabsTrigger>
            <TabsTrigger value="online" className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              online地址管理
            </TabsTrigger>
          </TabsList>
            
            <div className="flex-1 overflow-auto p-4">
              {/* System Prompts Tab */}
              <TabsContent value="prompts" className="mt-0 space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Button 
                      size="sm" 
                      onClick={() => setNewPromptDialogOpen(true)}
                      className="flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      新建
                    </Button>
                  </div>
                  
                  {newPromptDialogOpen && (
                    <Dialog open={newPromptDialogOpen} onOpenChange={setNewPromptDialogOpen}>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>新建模式</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="prompt-name">模式名称</Label>
                            <Input
                              id="prompt-name"
                              value={newPrompt.name}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPrompt(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="输入提示词名称"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="prompt-content">模式内容</Label>
                            <Textarea
                              id="prompt-content"
                              value={newPrompt.content}
                              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewPrompt(prev => ({ ...prev, content: e.target.value }))}
                              placeholder="输入提示词内容"
                              rows={6}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>启用质量审查</Label>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={qualityReviewEnabled}
                                onChange={(e) => onQualityReviewEnabledChange?.(e.target.checked)}
                              />
                              <span className="text-sm text-muted-foreground">开启后在编辑工具后插入质量审查</span>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="qr-rules">质量审查规则</Label>
                            <Textarea
                              id="qr-rules"
                              value={qualityReviewRules}
                              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onQualityReviewRulesChange?.(e.target.value)}
                              placeholder="输入审查规则，如：禁止TODO、必须包含标题等"
                              rows={4}
                            />
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" variant="outline" onClick={() => setNewPromptDialogOpen(false)}>取消</Button>
                            <Button size="sm" onClick={() => { handleSaveNewPrompt(); setNewPromptDialogOpen(false); }}>保存</Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                  
                  <div className="grid gap-3">
                    {systemPrompts.map((prompt) => (
                      <div
                        key={prompt.id}
                        className={"border rounded-lg p-3 flex items-center justify-between cursor-pointer " + (prompt.name === selectedPromptName ? 'bg-accent' : '')}
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
                        <span className="text-sm font-medium">{prompt.name}</span>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => onViewPrompt?.(prompt.name)}>查看详情</Button>
                          <Button size="sm" onClick={() => onEditPrompt?.(prompt.name)}>修改</Button>
                          <Button size="sm" variant="ghost" onClick={() => onDeletePrompt?.(prompt.name)}>删除</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
              
              
              {/* Model Management Tab */}
              <TabsContent value="model" className="mt-0 space-y-4">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">模型配置</h3>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="provider">模型提供商</Label>
                      <Select 
                        value={modelConfig.provider} 
                        onValueChange={(value: string) => onModelConfigChange({ ...modelConfig, provider: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="选择模型提供商" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="anthropic">Anthropic</SelectItem>
                          <SelectItem value="google">Google</SelectItem>
                          <SelectItem value="azure">Azure OpenAI</SelectItem>
                          <SelectItem value="ollama">Ollama</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="model">模型名称</Label>
                      <Input
                        id="model"
                        value={modelConfig.model}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onModelConfigChange({ ...modelConfig, model: e.target.value })}
                        placeholder="输入模型名称，如 gpt-4, claude-3-sonnet等"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="api-key">API密钥</Label>
                      <Input
                        id="api-key"
                        type="password"
                        value={modelConfig.apiKey}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onModelConfigChange({ ...modelConfig, apiKey: e.target.value })}
                        placeholder="输入API密钥"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="base-url">基础URL（可选）</Label>
                      <Input
                        id="base-url"
                        value={modelConfig.baseUrl || ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onModelConfigChange({ ...modelConfig, baseUrl: e.target.value })}
                        placeholder="输入自定义基础URL，如 https://api.openai.com/v1"
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Online Address Management Tab */}
              <TabsContent value="online" className="mt-0 space-y-4">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Online 服务地址</h3>
                  <div className="space-y-2">
                    <Label htmlFor="online-base-url">Base URL</Label>
                    <Input
                      id="online-base-url"
                      value={onlineBaseUrl}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOnlineBaseUrl(e.target.value)}
                      placeholder="http://host:port"
                    />
                    <div className="text-xs text-muted-foreground">用于 Online 创建/搜索/详情请求的服务端地址</div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
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
                    >保存</Button>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
        
        <div className="flex justify-end gap-2 p-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
