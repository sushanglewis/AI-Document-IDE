import React from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, RefreshCw, Plus, Home } from 'lucide-react';
import { cn } from '../lib/utils';
import { FileNode } from '../lib/store';
import { apiClient } from '../lib/api';
import { useAppStore } from '../lib/store';
import { toast } from 'sonner';

interface FileTreeProps {
  className?: string;
  onFileSelect: (path: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({ className, onFileSelect }) => {
  const { fileTree, workspaceRoot, updateFileNode, setFileTree, currentSessionId } = useAppStore();
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

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

  const goToRoot = async () => {
    await refreshTree();
  };

  const handleUpload = async (file: File) => {
    if (!currentSessionId) {
      toast.error('请先创建会话再上传文件');
      return;
    }
    try {
      await apiClient.uploadFile(currentSessionId, file);
      toast.success('文件已上传');
      await refreshTree();
    } catch (e) {
      toast.error('上传失败');
    }
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
        <div className="flex gap-1">
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
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1 hover:bg-accent rounded-sm"
            title="New File"
          >
            <Plus className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
          {/* 移除 workspaceRoot 显示 */}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {fileTree.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No files in workspace
          </div>
        ) : (
          fileTree.map(node => renderNode(node))
        )}
      </div>
    </div>
  );
};