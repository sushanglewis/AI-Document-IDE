import React from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, RefreshCw, Home } from 'lucide-react';
import { cn } from '../lib/utils';
import { getFileLanguage } from '../lib/utils';
import { FileNode } from '../lib/store';
import { apiClient } from '../lib/api';
import { useAppStore } from '../lib/store';

interface FileTreeProps {
  className?: string;
  onFileSelect: (path: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({ className, onFileSelect }) => {
  const { fileTree, workspaceRoot, updateFileNode, setFileTree, addOpenFile, setActiveFile } = useAppStore();
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [onlineDocs, setOnlineDocs] = React.useState<Array<{ documentId: string; title?: string; name?: string }>>([]);

  const toRelative = (p: string) => {
    if (!p) return '';
    if (p.startsWith(workspaceRoot)) {
      const rel = p.slice(workspaceRoot.length);
      return rel.startsWith('/') ? rel.slice(1) : rel;
    }
    if (p.startsWith('/workspace')) {
      const rel = p.replace(/^\/workspace\/?/, '');
      return rel;
    }
    return p;
  };

  const loadDirectory = async (path: string) => {
    try {
      updateFileNode(path, { isLoading: true });
      const files = await apiClient.listFiles(workspaceRoot, toRelative(path));
      
      const children: FileNode[] = files.map(file => ({
        name: file.name,
        path: file.path,
        type: file.type,
        size: file.size,
        modified: file.modified,
        children: file.type === 'directory' ? [] : undefined,
        isExpanded: false,
        isLoading: false,
      }));

      updateFileNode(path, { children, isLoading: false });
    } catch (error) {
      console.error('Failed to load directory:', error);
      updateFileNode(path, { isLoading: false });
    }
  };

  const toggleDirectory = async (node: FileNode) => {
    if (node.isExpanded) {
      updateFileNode(node.path, { isExpanded: false });
    } else {
      if (!node.children || node.children.length === 0) {
        await loadDirectory(node.path);
      }
      updateFileNode(node.path, { isExpanded: true });
    }
  };

  const refreshTree = async () => {
    setIsRefreshing(true);
    try {
      const files = await apiClient.listFiles(workspaceRoot);
      const tree: FileNode[] = files.map(file => ({
        name: file.name,
        path: file.path,
        type: file.type,
        size: file.size,
        modified: file.modified,
        children: file.type === 'directory' ? [] : undefined,
        isExpanded: false,
        isLoading: false,
      }));
      setFileTree(tree);
    } catch (error) {
      console.error('Failed to refresh file tree:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  React.useEffect(() => {
    refreshTree();
  }, [workspaceRoot]);

  React.useEffect(() => {
    searchOnline();
  }, []);

  const goToRoot = async () => {
    await refreshTree();
  };


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
    } finally {
      // noop
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

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isActive = false; // This would come from store
    const paddingLeft = depth * 12 + 8;

    return (
      <div key={node.path}>
        <div
          className={cn(
            "flex items-center gap-1 py-1 px-2 hover:bg-accent cursor-pointer rounded-sm",
            isActive && "bg-accent"
          )}
          style={{ paddingLeft }}
          onClick={() => {
            if (node.type === 'directory') {
              toggleDirectory(node);
            } else {
              onFileSelect(node.path);
            }
          }}
          draggable={node.type === 'file'}
          onDragStart={(e) => {
            if (node.type === 'file') {
              const abs = node.path.startsWith('/') ? node.path : `${workspaceRoot}/${node.path}`;
              const payload = { type: 'workspace', path: node.path, absolute: abs };
              e.dataTransfer.setData('text/plain', JSON.stringify(payload));
            }
          }}
        >
          {node.type === 'directory' ? (
            <>
              {node.isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              {node.isExpanded ? (
                <FolderOpen className="h-4 w-4 text-blue-500" />
              ) : (
                <Folder className="h-4 w-4 text-blue-500" />
              )}
            </>
          ) : (
            <>
              <div className="w-4" />
              <File className="h-4 w-4 text-muted-foreground" />
            </>
          )}
          
          <span className="text-sm flex-1 truncate">{node.name}</span>
          
          {node.isLoading && (
            <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
        
        {node.isExpanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex items-center justify-between p-2 border-b">
        <h3 className="text-sm font-semibold">Files</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        <div className="border rounded-md">
          <div className="flex items-center justify-between px-2 py-1 border-b">
            <div className="text-xs font-medium">/workspace</div>
            <div className="flex items-center gap-1">
              <button
                onClick={refreshTree}
                disabled={isRefreshing}
                className="p-1 hover:bg-accent rounded-sm"
                title="Refresh"
              >
                <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
              </button>
              <button
                onClick={goToRoot}
                disabled={isRefreshing}
                className="p-1 hover:bg-accent rounded-sm"
                title="返回根目录"
              >
                <Home className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="p-2">
            {fileTree.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">No files in workspace</div>
            ) : (
              fileTree.map(node => renderNode(node))
            )}
          </div>
        </div>
        <div className="border rounded-md">
          <div className="px-2 py-1 border-b cursor-pointer" onClick={searchOnline}>
            <div className="text-xs font-medium">/Online</div>
          </div>
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
                    };
                    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
                  }}
                >
                  <File className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm truncate flex-1">{d.title || d.name || d.documentId}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
