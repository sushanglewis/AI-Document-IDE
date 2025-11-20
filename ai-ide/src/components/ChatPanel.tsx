import React from 'react';
import { Send, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAppStore } from '../lib/store';

const PROMPT_OPTIONS = [
  { value: 'DOCUMENT_AGENT_SYSTEM_PROMPT', label: '文档助手', description: '专注于文档生成和改写' },
  { value: 'TRAE_AGENT_SYSTEM_PROMPT', label: '工程助手', description: '专注于代码生成和调试' },
  { value: 'custom', label: '自定义', description: '使用自定义提示词' },
];

interface ChatPanelProps {
  className?: string;
  onSendMessage: (message: string, isStreaming: boolean) => void;
  isStreaming?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ 
  className, 
  onSendMessage, 
  isStreaming = false 
}) => {
  const [message, setMessage] = React.useState('');
  const [selectedPrompt, setSelectedPrompt] = React.useState('DOCUMENT_AGENT_SYSTEM_PROMPT');
  const [customPrompt, setCustomPrompt] = React.useState('');
  const [showSettings] = React.useState(false);
  const { sessions, currentSessionId } = useAppStore();


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isStreaming) return;

    const finalMessage = selectedPrompt === 'custom' && customPrompt.trim()
      ? `${customPrompt}\n\n${message}`
      : message;

    onSendMessage(finalMessage, true); // Default to streaming
    setMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  return (
    <div className={cn("border-b", className)}>
      {/* Settings Panel */}
      {showSettings && (
        <div className="p-4 border-b bg-muted/50">
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">系统提示词</label>
              <select
                value={selectedPrompt}
                onChange={(e) => setSelectedPrompt(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background"
              >
                {PROMPT_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            
            {selectedPrompt === 'custom' && (
              <div>
                <label className="text-sm font-medium mb-1 block">自定义提示词</label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="输入自定义系统提示词..."
                  className="w-full px-3 py-2 border rounded-md bg-background h-20 resize-none"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-4">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述您的需求，例如：生成一个项目文档大纲..."
              disabled={isStreaming}
              className="w-full px-3 py-2 pr-10 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary min-h-[60px] max-h-[120px]"
              rows={2}
            />
            <div className="absolute right-2 bottom-2 text-xs text-muted-foreground">
              Ctrl+Enter 发送
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <select
              value={currentSessionId || ''}
              onChange={(e) => {
                if (e.target.value) {
                  useAppStore.getState().setCurrentSession(e.target.value);
                }
              }}
              className="px-2 py-1 border rounded text-sm bg-background"
              disabled={isStreaming}
            >
              <option value="">选择会话</option>
              {sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {session.name} ({session.systemPrompt === 'DOCUMENT_AGENT_SYSTEM_PROMPT' ? '文档' : '工程'})
                </option>
              ))}
            </select>
          <button
            type="submit"
            disabled={!message.trim() || isStreaming}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {isStreaming ? '处理中...' : '发送'}
          </button>
          </div>
        </div>
      </form>
    </div>
  );
};