import React from 'react';
import { ChevronRight, ChevronDown, File as FileIcon, Folder, FolderOpen, RefreshCw, Home, Upload, Trash } from 'lucide-react';
import Toast from '../lib/toast';
import { cn } from '../lib/utils';
import { FileNode } from '../lib/store';
import { apiClient } from '../lib/api';
import { useAppStore } from '../lib/store';

interface FileTreeProps {
  className?: string;
  onFileSelect: (path: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({ className, onFileSelect }) => {
  const { fileTree, workspaceRoot, updateFileNode, setFileTree, currentSessionId } = useAppStore();
  const uploadRef = React.useRef<HTMLInputElement | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  
  const [contextMenu, setContextMenu] = React.useState<{ visible: boolean; x: number; y: number; node: FileNode | null }>({ visible: false, x: 0, y: 0, node: null });
  const [isDragOver, setIsDragOver] = React.useState(false);

  React.useEffect(() => {
    const handleClickOutside = () => setContextMenu({ ...contextMenu, visible: false });
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu]);

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

  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      node
    });
  };

  const handleDelete = async () => {
    if (!contextMenu.node) return;
    const { path } = contextMenu.node;
    const absPath = path.startsWith('/') ? path : `${workspaceRoot}/${path}`;
    
    if (confirm(`Are you sure you want to delete ${contextMenu.node.name}?`)) {
      try {
        await apiClient.deleteFile(workspaceRoot, absPath);
        Toast.success('Deleted successfully');
        await refreshTree();
      } catch (e) {
        console.error(e);
        Toast.error('Failed to delete');
      }
    }
    setContextMenu({ ...contextMenu, visible: false });
  };

  const handleNodeDrop = async (e: React.DragEvent, targetNode: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (targetNode.type !== 'directory') return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const relPath = targetNode.path; 
    
    try {
      for (const file of files) {
        await apiClient.uploadFile(currentSessionId || null, file, relPath, workspaceRoot);
      }
      Toast.success(`Uploaded ${files.length} files`);
      await loadDirectory(targetNode.path);
    } catch (e) {
      Toast.error('Upload failed');
    }
  };

  const renderNode = (node: FileNode, depth: number = 0) => {
    const paddingLeft = depth * 12 + 8;

    return (
      <div key={node.path}>
        <div
          className={cn(
            "flex items-center gap-1 py-1 px-2 hover:bg-accent cursor-pointer rounded-sm group",
            contextMenu.visible && contextMenu.node?.path === node.path && "bg-accent"
          )}
          style={{ paddingLeft }}
          onClick={() => {
            if (node.type === 'directory') {
              toggleDirectory(node);
            } else {
              onFileSelect(node.path);
            }
          }}
          onContextMenu={(e) => handleContextMenu(e, node)}
          draggable={node.type === 'file'}
          onDragStart={(e) => {
            if (node.type === 'file') {
              const abs = node.path.startsWith('/') ? node.path : `${workspaceRoot}/${node.path}`;
              const payload = { type: 'workspace', path: node.path, absolute: abs };
              e.dataTransfer.setData('text/plain', JSON.stringify(payload));
            }
          }}
          onDragOver={(e) => {
            if (node.type === 'directory') {
              e.preventDefault(); // Allow drop
              e.currentTarget.classList.add('bg-accent/50');
            }
          }}
          onDragLeave={(e) => {
             if (node.type === 'directory') {
               e.currentTarget.classList.remove('bg-accent/50');
             }
          }}
          onDrop={(e) => {
            if (node.type === 'directory') {
              e.currentTarget.classList.remove('bg-accent/50');
              handleNodeDrop(e, node);
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
              <FileIcon className="h-4 w-4 text-muted-foreground" />
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
      {/* Header Removed (Tabs) - Now handled by Sidebar */}

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-2 h-9 border-b bg-background flex-shrink-0">
            <div className="text-xs font-medium text-muted-foreground">/workspace</div>
            <div className="flex items-center gap-1">
              <button
                onClick={refreshTree}
                disabled={isRefreshing}
                className="p-1 hover:bg-accent rounded-sm text-muted-foreground hover:text-foreground"
                title="Refresh"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
              </button>
              <button
                onClick={goToRoot}
                disabled={isRefreshing}
                className="p-1 hover:bg-accent rounded-sm text-muted-foreground hover:text-foreground"
                title="返回根目录"
              >
                <Home className="h-3.5 w-3.5" />
              </button>
              <input
                ref={uploadRef}
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const res = await apiClient.uploadFile(currentSessionId || null, file, undefined, workspaceRoot);
                    const name = typeof res?.filename === 'string' ? res.filename : '';
                    Toast.success(`已上传: ${name}`);
                    await refreshTree();
                  } catch (err) {
                    Toast.error('上传失败');
                  } finally {
                    e.target.value = '';
                  }
                }}
              />
              <button
                onClick={() => uploadRef.current?.click()}
                className="p-1 hover:bg-accent rounded-sm text-muted-foreground hover:text-foreground"
                title="上传私有文档"
              >
                <Upload className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div 
            className={cn(
              "flex-1 overflow-y-auto p-2 relative transition-colors no-scrollbar",
              isDragOver && "bg-accent/20 border-2 border-dashed border-primary/50 rounded-md"
            )}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setIsDragOver(false);
            }}
            onDrop={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(false);
              
              const files = Array.from(e.dataTransfer.files);
              if (files.length === 0) return;

              try {
                for (const file of files) {
                  await apiClient.uploadFile(currentSessionId || null, file, undefined, workspaceRoot);
                }
                Toast.success(`Uploaded ${files.length} files to root`);
                await refreshTree();
              } catch (e) {
                Toast.error('Upload failed');
              }
            }}
          >
            <div 
              className="space-y-2 min-h-full" 
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="p-2">
                {fileTree.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8">No files in workspace</div>
                ) : (
                  fileTree.map(node => renderNode(node))
                )}
              </div>
            </div>
          </div>
      </div>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground border rounded-md shadow-md p-1 min-w-[120px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="flex items-center gap-2 w-full px-2 py-1.5 text-sm hover:bg-accent rounded-sm text-red-500"
            onClick={handleDelete}
          >
            <Trash className="h-4 w-4" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
};
