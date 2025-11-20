import React from 'react';
import {} from 'lucide-react';
import { cn } from '../lib/utils';

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


  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!message.trim() || isStreaming) return;

    const finalMessage = selectedPrompt === 'custom' && customPrompt.trim()
      ? `${customPrompt}\n\n${message}`
      : message;

    onSendMessage(finalMessage, true);
    setMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
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
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述您的需求，例如：生成一个项目文档大纲..."
              disabled={isStreaming}
              className="w-full px-3 py-2 pr-10 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary min-h-[60px] text-sm"
              rows={3}
            />
            {/* 隐藏提示文案 */}
          </div>
        </div>
      </form>
    </div>
  );
};