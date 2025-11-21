import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';
import { AgentStep } from '../lib/api';

interface StreamingConsoleProps {
  className?: string;
  steps: AgentStep[];
  isStreaming?: boolean;
  messages?: Array<{
    id: string;
    type: 'user' | 'agent' | 'system' | 'error';
    content: string;
    timestamp: Date;
    sessionId?: string;
    stepId?: string;
    metadata?: any;
  }>;
}

export const StreamingConsole: React.FC<StreamingConsoleProps> = ({ 
  className, 
  steps, 
  messages = []
}) => {
  type ConsoleMessageItem = {
    id: string;
    type: 'user' | 'agent' | 'system' | 'error';
    content: string;
    timestamp: Date;
    isStep: false;
    metadata?: any;
  };

  type ConsoleStepItem = {
    id: string;
    type: 'agent';
    content: string;
    timestamp: Date;
    isStep: true;
    step: AgentStep;
    metadata?: any;
  };

  type ConsoleItem = ConsoleMessageItem | ConsoleStepItem;
  // Combine and sort messages and steps by timestamp
  const allItems: ConsoleItem[] = React.useMemo(() => {
    const messageItems: ConsoleMessageItem[] = messages.map(msg => ({
      id: msg.id,
      type: msg.type,
      content: msg.content,
      timestamp: new Date(msg.timestamp as any),
      isStep: false
    }));
    
    const stepItems: ConsoleStepItem[] = steps.map(step => {
      const stepId = step.step_id || `step_${step.timestamp}`;
      return {
        id: stepId,
        type: 'agent' as const,
        content: step.llm_response?.content || step.llm_response?.content_excerpt || '',
        timestamp: new Date(step.timestamp),
        isStep: true,
        step: step
      };
    });
    
    const combined = [...messageItems, ...stepItems];
    return combined.sort((a, b) => new Date(a.timestamp as any).getTime() - new Date(b.timestamp as any).getTime());
  }, [messages, steps]);

  const displayItems = React.useMemo(() => {
    return allItems.filter((item) => {
      if (item.isStep) {
        const s = (item as any).step as AgentStep;
        const c = (s.llm_response?.content || s.llm_response?.content_excerpt || '').trim();
        return c.length > 0;
      }
      return (item.content || '').trim().length > 0;
    });
  }, [allItems]);

  // Token usage隐藏，不再显示

  return (
    <div className={cn("h-full overflow-y-auto p-4", className)}>
      {displayItems.length > 0 ? (
        <>
          {displayItems.map((item) => {
            const tools = item.isStep && 'step' in item && item.step.tool_calls && item.step.tool_calls.length > 0
              ? `\n🔧 ${item.step.tool_calls.map((t: any) => t.name).join(', ')}`
              : '';
            const merged = `${item.content}${tools}`.trim();
            return (
              <div key={item.id} className={cn(
                "w-full mb-3"
              )}>
                <div className={cn(
                  "inline-block max-w-[80%] rounded-2xl px-3 py-2 text-[14px] border",
                  item.type === 'user' 
                    ? "bg-primary/10 border-border" 
                    : item.type === 'error'
                    ? "bg-destructive/10 text-destructive border-destructive/20"
                    : item.type === 'system'
                    ? "bg-muted/50 text-muted-foreground border-border"
                    : "bg-muted border-border"
                )}>
                  {item.type === 'agent' ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm max-w-none dark:prose-invert">
                      {merged}
                    </ReactMarkdown>
                  ) : (
                    merged
                  )}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center">
            <div className="text-4xl mb-4">💬</div>
            <div className="text-lg font-medium mb-2">暂无对话记录</div>
            <div className="text-sm">开始与AI助手对话，体验智能编程辅助</div>
          </div>
        </div>
      )}
    </div>
  );
};