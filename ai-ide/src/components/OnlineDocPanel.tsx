import React from 'react';
import { ChevronDown, File as FileIcon, RefreshCw, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { getFileLanguage } from '../lib/utils';
import { apiClient } from '../lib/api';
import { useAppStore } from '../lib/store';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

interface OnlineDocPanelProps {
  className?: string;
}

export const OnlineDocPanel: React.FC<OnlineDocPanelProps> = ({ className }) => {
  const { addOpenFile, setActiveFile } = useAppStore();
  const [onlineDocs, setOnlineDocs] = React.useState<Array<{ documentId: string; title?: string; name?: string }>>([]);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [createTitle, setCreateTitle] = React.useState('');
  const [createDesc, setCreateDesc] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [onlineBaseUrl, setOnlineBaseUrl] = React.useState('http://10.0.2.34:7876');

  React.useEffect(() => {
    searchOnline();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.getOnlineBaseUrl();
        if (res?.base_url) setOnlineBaseUrl(res.base_url);
      } catch { /* noop */ }
    })();
  }, []);

  const searchOnline = async () => {
    try {
      const res = await apiClient.searchOnlineDocs();
      const list = Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.list)
          ? res.list
          : Array.isArray(res?.data?.items)
            ? res.data.items
            : Array.isArray(res?.data?.list)
              ? res.data.list
              : [];
      const mapped = list.map((it: any) => ({ documentId: String(it.documentId || it.id || it.docId || ''), title: it.title, name: it.name }));
      setOnlineDocs(mapped);
    } catch (e) {
      setOnlineDocs([]);
    }
  };

  const handleCreateOnline = async () => {
    if (!createTitle.trim()) return;
    setIsSubmitting(true);
    try {
      await apiClient.createOnlineReport({ title: createTitle.trim(), description: createDesc.trim(), userId: 'user' });
      setIsCreateOpen(false);
      setCreateTitle('');
      setCreateDesc('');
      await searchOnline();
    } catch (e) {
      setIsCreateOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openOnlineDoc = async (docId: string) => {
    try {
      const res = await apiClient.getOnlineDocDetail({ userId: 'user', documentId: docId });
      const content = typeof res?.content === 'string'
        ? res.content
        : typeof res?.data?.content === 'string'
          ? res.data.content
          : JSON.stringify(res);
      const path = `/Online/${docId}.md`;
      const editorFile = { path, content, isDirty: false, language: getFileLanguage(path) };
      addOpenFile(editorFile);
      setActiveFile(path);
    } catch { void 0; }
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
        <div className="h-9 flex items-center px-4 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-background flex-shrink-0">
            在线文档
        </div>
      
        {isCreateOpen ? (
             <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 px-2 py-2 border-b flex-shrink-0">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsCreateOpen(false)}>
                        <ChevronDown className="h-4 w-4 rotate-90" />
                    </Button>
                    <div className="flex-1">
                        <h3 className="font-semibold text-xs">新建在线文档</h3>
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">标题 (必填)</label>
                      <Input className="h-8 text-xs" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} placeholder="输入标题" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">描述</label>
                      <Textarea className="text-xs min-h-[100px]" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="可选描述" />
                    </div>
                </div>
                
                <div className="p-3 border-t flex justify-end gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
                    <Button size="sm" onClick={handleCreateOnline} disabled={!createTitle.trim() || isSubmitting}>确定</Button>
                </div>
             </div>
           ) : (
            <>
              <div className="flex items-center justify-between px-2 h-9 border-b bg-background flex-shrink-0">
                <div className="px-1 py-0.5 cursor-pointer" onClick={searchOnline}>
                  <div className="text-xs font-medium text-muted-foreground">/Online</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={searchOnline}
                    className="p-1 hover:bg-accent rounded-sm text-muted-foreground hover:text-foreground"
                    title="刷新在线文档列表"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setIsCreateOpen(true)}
                    className="p-1 hover:bg-accent rounded-sm text-muted-foreground hover:text-foreground"
                    title="新建在线文档"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 relative transition-colors no-scrollbar">
                <div className="space-y-2 min-h-full">
                  <div className="p-2">
                    {onlineDocs.length === 0 ? (
                      <div className="text-xs text-muted-foreground">无在线文档</div>
                    ) : (
                      onlineDocs.map((d) => (
                        <div
                          key={d.documentId}
                          className="flex items-center gap-2 py-1 px-2 hover:bg-accent cursor-pointer rounded-sm"
                          onClick={() => openOnlineDoc(d.documentId)}
                          draggable
                          onDragStart={(e) => {
                            const payload = {
                              type: 'online',
                              documentId: d.documentId,
                              title: d.title,
                              name: d.name,
                              path: `/Online/${d.documentId}.md`,
                              base_url: onlineBaseUrl,
                            };
                            e.dataTransfer.setData('text/plain', JSON.stringify(payload));
                          }}
                        >
                          <FileIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm truncate flex-1">{d.title || d.name || d.documentId}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
           )
        }
    </div>
  );
};
