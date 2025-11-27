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
      isStep: false,
      metadata: { attachments: (msg as any).attachments, sse_step: (msg as any).sse_step }
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
        const mus = Array.isArray((s as any).message_units) ? (s as any).message_units : [];
        return c.length > 0 || mus.length > 0;
      }
      const hasSse = !!(item as any).metadata?.sse_step;
      return hasSse || ((item.content || '').trim().length > 0);
    });
  }, [allItems]);

  // Token usage隐藏，不再显示

  return (
    <div className={cn("h-full overflow-y-auto p-4", className)}>
      {displayItems.length > 0 ? (
        <>
          {displayItems.map((item) => {
            const isSseMsg = !!(item as any).metadata?.sse_step;
            if (isSseMsg) {
              const sse = (item as any).metadata?.sse_step;
              const toolCalls = Array.isArray(sse.tool_calls) ? sse.tool_calls : [];
              const toolResults = Array.isArray(sse.tool_results) ? sse.tool_results : [];
              return (
                <div key={item.id} className="w-full mb-3">
                  <div className={cn("inline-block max-w-[90%] rounded-2xl px-3 py-2 text-[13px] border bg-muted/40")}> 
                    <div className="text-xs text-muted-foreground">步骤 {sse.step_number ?? '-'} {sse.error ? '· 发生错误' : ''}</div>
                    {sse.content && <div className="mt-1 whitespace-pre-wrap">{sse.content}</div>}
                    {sse.reflection && <div className="mt-2 text-xs">反思：{sse.reflection}</div>}
                    {sse.lakeview_summary && <div className="mt-2 text-xs">Lakeview：{sse.lakeview_summary}</div>}
                    {toolCalls.length > 0 && (
                      <div className="mt-2 text-xs flex flex-wrap gap-1">
                        {toolCalls.map((t: any, idx: number) => (
                          <span key={idx} className="px-1.5 py-0.5 bg-muted rounded border">{t.icon} {t.name}</span>
                        ))}
                      </div>
                    )}
                    {toolResults.length > 0 && (
                      <div className="mt-2 text-xs space-y-1">
                        {toolResults.map((r: any, idx: number) => (
                          <div key={idx}>{r.success ? '✅' : '❌'} {r.result || r.error || ''}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            const step: AgentStep | undefined = item.isStep ? ((item as any).step as AgentStep) : undefined;
            const tools = item.isStep && step && step.tool_calls && step.tool_calls.length > 0
              ? `\n🔧 ${step.tool_calls.map((t: any) => t.name).join(', ')}`
              : '';
            const mus: Array<any> = item.isStep && step && Array.isArray((step as any).message_units)
              ? ((step as any).message_units as any[])
              : [];
            const musText = mus.length > 0 ? mus.map((u) => {
              if (u.type === 'think') return `🤔 ${String(u.content || '').trim()}`;
              if (u.type === 'tool_call') return `🔧 ${String(u.name || '')}`;
              if (u.type === 'tool_result') return `${u.success ? '✅' : '❌'}`;
              if (u.type === 'agent_output') return String(u.markdown || '').trim();
              return '';
            }).filter(Boolean).join('\n') : '';
            const merged = `${item.content}${tools}${musText ? ('\n' + musText) : ''}`.trim();
            const attachments = (item as any).metadata?.attachments as string[] | undefined;
            return (
              <div key={(item as any).bubbleId || item.id} className={cn("w/full mb-3")}> 
                <div className={cn(
                  "inline-block max-w-[80%] rounded-2xl px-3 py-2 text-[14px] border",
                  item.type === 'user' ? "bg-primary/10 border-border" :
                  item.type === 'error' ? "bg-destructive/10 text-destructive border-destructive/20" :
                  item.type === 'system' ? "bg-muted/50 text-muted-foreground border-border" : "bg-muted border-border"
                )}>
                  {item.type === 'agent' ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm max-w-none dark:prose-invert">{merged}</ReactMarkdown>
                  ) : merged}
                  {attachments && attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {attachments.map((a, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 text-xs bg-muted rounded border">{a}</span>
                      ))}
                    </div>
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
