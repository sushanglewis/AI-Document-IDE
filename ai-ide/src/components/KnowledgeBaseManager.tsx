import React, { useState, useEffect } from 'react';
import { Plus, Database, Trash, Search, Edit, Loader2, Book, ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { apiClient } from '../lib/api';
import Toast from '../lib/toast';
import { cn } from '../lib/utils';

interface KnowledgeBase {
  id: number;
  name: string;
  description?: string;
  dataset_id: string;
  api_key: string;
  api_url: string;
  retrieval_model?: any;
  created_at?: string;
  updated_at?: string;
}

export const KnowledgeBaseManager: React.FC<{ onRetrieveTest: (kb: KnowledgeBase) => void }> = ({ onRetrieveTest }) => {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [currentKb, setCurrentKb] = useState<KnowledgeBase | null>(null);
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    dataset_id: '',
    api_key: '',
    api_url: 'http://10.0.2.31:5001/v1',
    retrieval_model: ''
  });

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; kb: KnowledgeBase | null }>({
    visible: false,
    x: 0,
    y: 0,
    kb: null
  });

  useEffect(() => {
    fetchKbs();
    const handleClickOutside = () => setContextMenu({ ...contextMenu, visible: false });
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const fetchKbs = async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.listKnowledgeBases();
      setKbs(data);
    } catch (e) {
      Toast.error('Failed to load knowledge bases');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.name || !formData.dataset_id || !formData.api_key || !formData.api_url) {
      Toast.error('Please fill in all required fields');
      return;
    }
    try {
      const payload: any = { ...formData };
      if (payload.retrieval_model) {
        try {
          payload.retrieval_model = JSON.parse(payload.retrieval_model);
        } catch (e) {
          Toast.error('Invalid JSON in Retrieval Model');
          return;
        }
      } else {
        delete payload.retrieval_model;
      }
      await apiClient.createKnowledgeBase(payload);
      Toast.success('Knowledge Base created');
      setIsCreateOpen(false);
      resetForm();
      fetchKbs();
    } catch (e: any) {
      Toast.error(e.response?.data?.detail || 'Failed to create');
    }
  };

  const handleUpdate = async () => {
    if (!currentKb) return;
    try {
      const payload: any = { ...formData };
      if (payload.retrieval_model) {
        try {
          payload.retrieval_model = JSON.parse(payload.retrieval_model);
        } catch (e) {
          Toast.error('Invalid JSON in Retrieval Model');
          return;
        }
      } else {
        payload.retrieval_model = null;
      }
      await apiClient.updateKnowledgeBase(currentKb.id, payload);
      Toast.success('Knowledge Base updated');
      setIsEditOpen(false);
      resetForm();
      fetchKbs();
    } catch (e: any) {
      Toast.error(e.response?.data?.detail || 'Failed to update');
    }
  };

  const handleDelete = async () => {
    if (!contextMenu.kb) return;
    if (confirm(`Are you sure you want to delete ${contextMenu.kb.name}?`)) {
      try {
        await apiClient.deleteKnowledgeBase(contextMenu.kb.id);
        Toast.success('Deleted successfully');
        fetchKbs();
      } catch (e) {
        Toast.error('Failed to delete');
      }
    }
    setContextMenu({ ...contextMenu, visible: false });
  };

  const openEdit = (kb: KnowledgeBase) => {
    setCurrentKb(kb);
    setFormData({
      name: kb.name,
      description: kb.description || '',
      dataset_id: kb.dataset_id,
      api_key: kb.api_key,
      api_url: kb.api_url,
      retrieval_model: kb.retrieval_model ? JSON.stringify(kb.retrieval_model, null, 2) : ''
    });
    setIsEditOpen(true);
  };

  const openRetrieve = (kb: KnowledgeBase) => {
    onRetrieveTest(kb);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      dataset_id: '',
      api_key: '',
      api_url: 'http://10.0.2.31:5001/v1',
      retrieval_model: ''
    });
    setCurrentKb(null);
  };

  const handleContextMenu = (e: React.MouseEvent, kb: KnowledgeBase) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      kb
    });
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Create/Edit Dialog -> Replaced with inline form if needed, but user asked for "Tool Management like UI". 
          Tool Management uses a list -> detail/edit view transition.
          Let's adopt that pattern.
      */}
      
      {/* We need to conditionally render List or Form */}
      {(isCreateOpen || isEditOpen) ? (
         <div className="flex flex-col h-full">
            <div className="flex items-center gap-4 px-4 py-2 border-b flex-shrink-0">
                <Button variant="ghost" size="icon" onClick={() => { setIsCreateOpen(false); setIsEditOpen(false); resetForm(); }}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex-1">
                    <h3 className="font-semibold text-sm">{isCreateOpen ? '创建知识库' : '编辑知识库'}</h3>
                </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="space-y-2">
                  <Label>名称</Label>
                  <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="知识库名称" />
                </div>
                <div className="space-y-2">
                  <Label>描述</Label>
                  <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="可选描述" />
                </div>
                <div className="space-y-2">
                  <Label>Knowledge Base ID (Dataset ID)</Label>
                  <Input value={formData.dataset_id} onChange={e => setFormData({ ...formData, dataset_id: e.target.value })} placeholder="Dify Dataset ID" />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" value={formData.api_key} onChange={e => setFormData({ ...formData, api_key: e.target.value })} placeholder="Dify API Key" />
                </div>
                <div className="space-y-2">
                  <Label>API URL</Label>
                  <Input value={formData.api_url} onChange={e => setFormData({ ...formData, api_url: e.target.value })} placeholder="http://..." />
                </div>
                <div className="space-y-2">
                  <Label>Retrieval Model (JSON)</Label>
                  <Textarea 
                    value={formData.retrieval_model} 
                    onChange={e => setFormData({ ...formData, retrieval_model: e.target.value })} 
                    placeholder='{"search_method": "hybrid_search", ...}' 
                    className="font-mono text-xs h-32"
                  />
                </div>
            </div>
            
            <div className="p-4 border-t flex justify-end gap-2 shrink-0">
                <Button variant="outline" onClick={() => { setIsCreateOpen(false); setIsEditOpen(false); resetForm(); }}>取消</Button>
                <Button onClick={isCreateOpen ? handleCreate : handleUpdate}>{isCreateOpen ? '创建' : '保存'}</Button>
            </div>
         </div>
      ) : (
          /* List View */
          <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-4 h-9 border-b flex-shrink-0">
                <div className="font-medium flex items-center gap-2 text-xs">
                  <Book className="w-3.5 h-3.5" />
                  知识库
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { resetForm(); setIsCreateOpen(true); }}>
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-2 no-scrollbar">
                {isLoading ? (
                  <div className="flex justify-center p-4">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : kbs.length === 0 ? (
                  <div className="text-center text-muted-foreground text-sm p-4">
                    暂无知识库，点击右上角添加
                  </div>
                ) : (
                  kbs.map(kb => (
                    <div
                      key={kb.id}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-pointer border border-transparent hover:border-border group relative",
                        contextMenu.visible && contextMenu.kb?.id === kb.id && "bg-accent"
                      )}
                      onContextMenu={(e) => handleContextMenu(e, kb)}
                      draggable
                      onDragStart={(e) => {
                        const payload = {
                          type: 'knowledge_base',
                          config: {
                            dataset_id: kb.dataset_id,
                            api_key: kb.api_key,
                            api_url: kb.api_url,
                            name: kb.name,
                            description: kb.description,
                            retrieval_model: kb.retrieval_model
                          }
                        };
                        e.dataTransfer.setData('text/plain', JSON.stringify(payload));
                      }}
                    >
                      <Database className="w-4 h-4 text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{kb.name}</div>
                        {kb.description && (
                          <div className="text-xs text-muted-foreground truncate">{kb.description}</div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
          </div>
      )}

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="fixed z-50 min-w-[120px] bg-popover text-popover-foreground border rounded-md shadow-md py-1"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div 
            className="px-2 py-1.5 text-sm hover:bg-accent cursor-pointer flex items-center gap-2"
            onClick={() => { if (contextMenu.kb) openEdit(contextMenu.kb); }}
          >
            <Edit className="w-3 h-3" /> 查看详情/编辑
          </div>
          <div 
            className="px-2 py-1.5 text-sm hover:bg-accent cursor-pointer flex items-center gap-2"
            onClick={() => { if (contextMenu.kb) openRetrieve(contextMenu.kb); }}
          >
            <Search className="w-3 h-3" /> 召回测试
          </div>
          <div 
            className="px-2 py-1.5 text-sm hover:bg-accent cursor-pointer flex items-center gap-2 text-destructive"
            onClick={handleDelete}
          >
            <Trash className="w-3 h-3" /> 删除
          </div>
        </div>
      )}
    </div>
  );
};
