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
  onCollapse?: () => void;
}

export const StreamingConsole: React.FC<StreamingConsoleProps> = ({ 
  className, 
  steps, 
  isStreaming = false,
  messages = [],
  onCollapse
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
    
    const stepItems: ConsoleStepItem[] = steps.map(step => ({
      id: step.step_id,
      type: 'agent' as const,
      content: step.llm_response?.content_excerpt || `执行步骤: ${step.state}`,
      timestamp: new Date(step.timestamp),
      isStep: true,
      step: step
    }));
    
    const combined = [...messageItems, ...stepItems];
    return combined.sort((a, b) => new Date(a.timestamp as any).getTime() - new Date(b.timestamp as any).getTime());
  }, [messages, steps]);

  // Token usage隐藏，不再显示

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">对话记录</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground">
            {allItems.length > 0 && `${allItems.length} 条消息`}
            {allItems.length === 0 && '暂无记录'}
          </div>
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="p-1 hover:bg-accent rounded-full h-6 w-6 flex items-center justify-center font-sans text-xs"
              title="折叠对话"
            >
              &gt;
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Combined Messages and Steps - sorted by time */}
        {allItems.length > 0 ? (
          <div className="space-y-3">
            {allItems.map((item) => (
              <div key={item.id} className={cn("flex gap-3") }>
                {/* Message Bubble: 全宽 */}
                <div className={cn(
                  "w-full rounded-lg p-3 shadow-sm",
                  item.type === 'user' 
                    ? "bg-primary text-primary-foreground" 
                    : item.type === 'error'
                    ? "bg-destructive/10 text-destructive border border-destructive/20"
                    : item.type === 'system'
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-muted border border-border"
                )}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      item.type === 'user' && "bg-primary-foreground",
                      item.type === 'agent' && "bg-green-500",
                      item.type === 'system' && "bg-yellow-500",
                      item.type === 'error' && "bg-red-500"
                    )} />
                    <span className={cn(
                      "text-xs font-medium",
                      item.type === 'user' ? "text-primary-foreground/80" : "text-muted-foreground"
                    )}>
                      {item.type === 'user' && '用户'}
                      {item.type === 'agent' && 'AI助手'}
                      {item.type === 'system' && '系统'}
                      {item.type === 'error' && '错误'}
                    </span>
                    <span className={cn(
                      "text-xs",
                      item.type === "user" ? "text-primary-foreground/60" : "text-muted-foreground"
                    )}>
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  
                  <div className={cn(
                    "text-sm whitespace-pre-wrap",
                    item.type === 'user' ? "text-primary-foreground" : "text-foreground"
                  )}>
                    {item.type === 'agent' ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {item.content}
                      </ReactMarkdown>
                    ) : (
                      item.content
                    )}
                  </div>

                  {/* Thinking indicator */}
                  {item.metadata?.is_thinking && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                      <span>AI正在思考中...</span>
                    </div>
                  )}

                  {/* Step Details */}
                  {item.isStep && 'step' in item && (
                    <div className="mt-3 space-y-2">
                      {item.step.llm_response && (
                        <div className="bg-muted/50 rounded p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2 h-2 rounded-full bg-blue-500" />
                            <span className="text-xs font-medium text-muted-foreground">AI响应</span>
                          </div>
                          <div className="text-sm whitespace-pre-wrap">
                            {item.step.llm_response.content || item.step.llm_response.content_excerpt || ''}
                          </div>
                        </div>
                      )}

                      {item.step.tool_calls && item.step.tool_calls.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground">
                            工具调用 ({item.step.tool_calls.length}):
                          </div>
                          {item.step.tool_calls.map((tool: any, toolIndex: number) => {
                            const serialized = tool && tool.parameters !== undefined 
                              ? JSON.stringify(tool.parameters, null, 2).replace(/\s*\n\s*/g, ' ') 
                              : '';
                            const preview = typeof serialized === 'string' ? serialized.slice(0, 100) : '';
                            const isLong = typeof serialized === 'string' && serialized.length > 100;
                            return (
                              <div key={toolIndex} className="bg-accent/50 rounded p-2 text-xs">
                                <div className="font-mono">{tool?.name || 'unknown'}</div>
                                <div className="text-muted-foreground mt-1">
                                  {preview}
                                  {isLong && '...'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {item.step.tool_results && item.step.tool_results.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground">
                            工具结果:
                          </div>
                          {item.step.tool_results.map((result: any, resultIndex: number) => {
                            const serialized = result && result.result !== undefined 
                              ? JSON.stringify(result.result, null, 2).replace(/\s*\n\s*/g, ' ') 
                              : '';
                            const preview = typeof serialized === 'string' ? serialized.slice(0, 200) : '';
                            const isLong = typeof serialized === 'string' && serialized.length > 200;
                            return (
                              <div 
                                key={resultIndex} 
                                className={cn(
                                  "rounded p-2 text-xs",
                                  result?.error 
                                    ? "bg-destructive/10 text-destructive" 
                                    : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                                )}
                              >
                                <div className="font-mono">{result?.name || 'unknown'}</div>
                                {result?.error ? (
                                  <div className="mt-1">{result.error}</div>
                                ) : (
                                  <div className="text-muted-foreground mt-1">
                                    {preview}
                                    {isLong && '...'}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {item.step.reflection && (
                        <div className="bg-yellow-50 dark:bg-yellow-950 rounded p-3">
                          <div className="text-xs font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                            反思:
                          </div>
                          <div className="text-sm">{item.step.reflection}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        
        {/* 移除全局处理中的提示，改为直接显示步骤消息 */}
        
        {allItems.length === 0 && !isStreaming && (
          <div className="text-center text-muted-foreground py-8">
            <div className="text-lg mb-2">💬</div>
            <div className="text-sm">开始与AI助手对话</div>
            <div className="text-xs mt-1">输入您的需求，AI将为您提供帮助</div>
          </div>
        )}
      </div>
    </div>
  );
};