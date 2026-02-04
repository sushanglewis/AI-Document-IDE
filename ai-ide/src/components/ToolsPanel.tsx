import React, { useEffect, useState } from 'react';
import { Bot, Workflow, RefreshCw, Terminal, Wrench, FileCode } from 'lucide-react';
import { cn } from '../lib/utils';

interface Tool {
  name: string;
  description: string;
  custom_name?: string;
  initial_name_zh?: string;
  is_custom: boolean;
  // Dify specific fields
  id?: number;
  app_id?: string;
  request_body_template?: string;
}

interface ToolsPanelProps {
  onClose?: () => void;
}

export const ToolsPanel: React.FC<ToolsPanelProps> = () => {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTools = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all tools from backend
      const res = await fetch('/agent/tools');
      if (!res.ok) throw new Error('Failed to fetch tools');
      const data = await res.json();
      setTools(data.tools || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const handleDragStart = (e: React.DragEvent, tool: Tool) => {
    let data;
    
    if (tool.is_custom && tool.request_body_template) {
       // Dify Tool format
       data = {
        type: 'dify_tool',
        tool: {
          name: tool.name,
          description: tool.description,
          id: tool.id,
          app_id: tool.app_id
        }
      };
    } else {
      // Standard Tool format (fallback to simple text insertion or future expansion)
      // For now, we treat standard tools similar to dify tools but with type='dify_tool' 
      // (as per user request to support dragging "like dify tools") 
      // OR we can introduce a new type. 
      // The user said: "support dragging like dify tools... but note capsule info difference".
      // ChatPanel supports 'dify_tool' type. Let's use a generic 'dify_tool' type for now 
      // or better, if ChatPanel is updated to handle 'tool', we use that.
      // But ChatPanel currently only has: text, file, online, context, knowledge, dify_tool.
      // Let's reuse 'dify_tool' for now but careful with metadata, or map to text if ChatPanel doesn't support generic tools.
      // Actually, ChatPanel's handleDrop logic for 'dify_tool' expects `data.tool.name` and `data`.
      
      data = {
        type: 'dify_tool', // Reusing this type for visualization consistency as requested, or we need to add 'tool' type to ChatPanel.
        // Wait, user said "capsule info difference".
        // Let's look at ChatPanel again. It handles 'dify_tool' by inserting <dify_tool_capsule>.
        // Standard tools don't have ID/AppID usually.
        tool: {
          name: tool.name,
          description: tool.description,
          id: tool.id || 0, // Standard tools might not have numeric ID
          app_id: tool.app_id
        },
        is_standard: !tool.is_custom
      };
    }
    
    e.dataTransfer.setData('text/plain', JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const getToolIcon = (tool: Tool) => {
    if (tool.is_custom) {
        if (tool.request_body_template?.includes('workflow')) return <Workflow className="h-4 w-4" />;
        return <Bot className="h-4 w-4" />;
    }
    if (tool.name === 'bash') return <Terminal className="h-4 w-4" />;
    if (tool.name.includes('edit')) return <FileCode className="h-4 w-4" />;
    return <Wrench className="h-4 w-4" />;
  };

  const getToolTypeLabel = (tool: Tool) => {
      if (tool.is_custom) return 'Dify';
      return 'Standard';
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="h-9 flex items-center justify-between px-4 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-shrink-0 bg-muted/20">
        <div>TOOLS</div>
        <button 
          onClick={fetchTools}
          className="p-1 hover:bg-accent rounded-sm text-muted-foreground hover:text-foreground transition-colors"
          title="刷新"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {error && (
          <div className="p-2 text-xs text-destructive bg-destructive/10 rounded mb-2">
            {error}
          </div>
        )}
        
        <div className="space-y-1">
          {tools.length === 0 && !loading && (
            <div className="text-center text-muted-foreground text-xs py-8">
              暂无可用工具
            </div>
          )}
          
          {tools.map((tool) => (
            <div
              key={tool.name}
              draggable
              onDragStart={(e) => handleDragStart(e, tool)}
              className="group flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-grab active:cursor-grabbing border border-transparent hover:border-border transition-all"
            >
              <div className={cn("p-1.5 rounded", tool.is_custom ? "bg-blue-500/10 text-blue-500" : "bg-orange-500/10 text-orange-500")}>
                {getToolIcon(tool)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{tool.custom_name || tool.initial_name_zh || tool.name}</span>
                    <span className={cn("text-[10px] px-1 rounded border", tool.is_custom ? "bg-blue-100 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800" : "bg-orange-100 text-orange-600 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800")}>
                        {getToolTypeLabel(tool)}
                    </span>
                </div>
                <div className="text-xs text-muted-foreground truncate" title={tool.description}>{tool.description || 'No description'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="p-2 border-t bg-muted/10">
        <div className="text-[10px] text-muted-foreground text-center">
          拖拽工具到对话框以使用
        </div>
      </div>
    </div>
  );
};
