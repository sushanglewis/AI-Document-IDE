import React, { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Settings, Plus, Trash2, Key, BrainCircuit } from 'lucide-react';

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
  currentPrompt: string;
  onPromptChange: (prompt: any) => void;
  onSavePrompt: (prompt: SystemPrompt) => void;
  onDeletePrompt: (id: string) => void;
  modelConfig: ModelConfig;
  onModelConfigChange: (config: ModelConfig) => void;
  qualityReviewEnabled?: boolean;
  qualityReviewRules?: string;
  onQualityReviewEnabledChange?: (enabled: boolean) => void;
  onQualityReviewRulesChange?: (rules: string) => void;
}

export function SystemSettings({
  open,
  onOpenChange,
  systemPrompts,
  currentPrompt,
  onPromptChange,
  onSavePrompt,
  onDeletePrompt,
  modelConfig,
  onModelConfigChange,
  qualityReviewEnabled = false,
  qualityReviewRules = '',
  onQualityReviewEnabledChange,
  onQualityReviewRulesChange,
}: SystemSettingsProps) {
  const [activeTab, setActiveTab] = useState('prompts');
  const [newPrompt, setNewPrompt] = useState({ name: '', content: '' });
  const [newPromptDialogOpen, setNewPromptDialogOpen] = useState(false);

  const handleSaveNewPrompt = () => {
    if (newPrompt.name.trim() && newPrompt.content.trim()) {
      const prompt: SystemPrompt = {
        id: Date.now().toString(),
        name: newPrompt.name.trim(),
        content: newPrompt.content.trim()
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="prompts" className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4" />
              系统提示词
            </TabsTrigger>
            <TabsTrigger value="model" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              模型管理
            </TabsTrigger>
          </TabsList>
            
            <div className="flex-1 overflow-auto p-4">
              {/* System Prompts Tab */}
              <TabsContent value="prompts" className="mt-0 space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">预设提示词</h3>
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
                          <DialogTitle>新建系统提示词</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="prompt-name">提示词名称</Label>
                            <Input
                              id="prompt-name"
                              value={newPrompt.name}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPrompt(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="输入提示词名称"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="prompt-content">提示词内容</Label>
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
                      <div key={prompt.id} className={"border rounded-lg p-4 space-y-3 " + (prompt.content === currentPrompt ? 'bg-accent' : '')}>
                        <div className="flex items-start justify-between">
                          <div className="space-y-1 flex-1">
                            <h4 className="font-medium">{prompt.name}</h4>
                            <p className="text-sm text-muted-foreground">{prompt.content}</p>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <Button
                              size="sm"
                              variant={prompt.content === currentPrompt ? 'default' : 'outline'}
                              onClick={() => onPromptChange(prompt.content)}
                            >
                              使用
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onDeletePrompt(prompt.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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