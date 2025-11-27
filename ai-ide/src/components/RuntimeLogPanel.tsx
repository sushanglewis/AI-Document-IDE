import React from 'react';
import { useAppStore } from '../lib/store';
import { cn } from '../lib/utils';

export default function RuntimeLogPanel() {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const toggle = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'j';
      if (toggle) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!open) return null;

  const messages = sessions.find((s) => s.id === currentSessionId)?.messages || [];

  return (
    <div className={cn("fixed right-0 top-[64px] bottom-0 z-40 w-[420px] max-w-[40vw] border-l bg-background/95 backdrop-blur-sm")}> 
      <div className="h-full overflow-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground">暂无运行时消息（Cmd+Shift+J 打开/关闭）</div>
        )}
        {messages.map((m) => {
          const ts = m.timestamp instanceof Date ? m.timestamp : new Date((m as any).timestamp);
          const timeText = isNaN(ts.getTime()) ? '' : ts.toLocaleTimeString();
          return (
          <div key={m.id} className={cn("w-full")}> 
            <div className={cn(
              "inline-block max-w-[95%] rounded-2xl px-3 py-2 text-[13px] border",
              m.type === 'user' ? "bg-primary/10 border-border" :
              m.type === 'error' ? "bg-destructive/10 border-destructive" :
              "bg-muted/30 border-border"
            )}>
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
              {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">{m.attachments.join('\n')}</div>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">{timeText}</div>
          </div>
        );})}
      </div>
    </div>
  );
}
