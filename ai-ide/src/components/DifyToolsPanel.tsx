import React, { useEffect, useState } from 'react';
import { Bot, Workflow, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

interface DifyTool {
  id: number;
  name: string;
  description: string;
  api_url: string;
  api_key: string;
  request_method: string;
  request_body_template: string;
  parameter_schema: string;
  curl_example: string;
  app_id?: string;
  is_custom: boolean;
}

interface DifyToolsPanelProps {
  onClose?: () => void;
}

export const DifyToolsPanel: React.FC<DifyToolsPanelProps> = () => {
  const [tools, setTools] = useState<DifyTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTools = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/custom-tools');
      if (!res.ok) throw new Error('Failed to fetch tools');
      const data = await res.json();
      setTools(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const handleDragStart = (e: React.DragEvent, tool: DifyTool) => {
    const data = {
      type: 'dify_tool',
      tool: {
        name: tool.name,
        description: tool.description,
        id: tool.id,
        app_id: tool.app_id
      }
    };
    e.dataTransfer.setData('text/plain', JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="h-9 flex items-center justify-between px-4 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-shrink-0 bg-muted/20">
        <span>Dify Tools</span>
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
              暂无 Dify 工具
            </div>
          )}
          
          {tools.map((tool) => (
            <div
              key={tool.id}
              draggable
              onDragStart={(e) => handleDragStart(e, tool)}
              className="group flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-grab active:cursor-grabbing border border-transparent hover:border-border transition-all"
            >
              <div className="p-1.5 bg-blue-500/10 text-blue-500 rounded">
                {tool.request_body_template?.includes('workflow') ? (
                  <Workflow className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{tool.name}</div>
                <div className="text-xs text-muted-foreground truncate">{tool.description || 'No description'}</div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                 {/* Actions if needed */}
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
