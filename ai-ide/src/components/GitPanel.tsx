import React, { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { Button } from './ui/button';
// import { ScrollArea } from './ui/scroll-area'; // Removed
import { RefreshCw, Plus, Minus, Check, GitBranch } from 'lucide-react';

interface GitFile {
  path: string;
  status: string; // "M ", " M", "A ", "??" etc.
}

const getStatusLabel = (status: string) => {
    if (status === 'M') return 'M'; // Modified
    if (status === 'A') return 'A'; // Added
    if (status === 'D') return 'D'; // Deleted
    if (status === 'R') return 'R'; // Renamed
    if (status === 'C') return 'C'; // Copied
    if (status === '?') return 'U'; // Untracked
    return status;
};

const getStatusColor = (status: string) => {
    if (status === 'M') return 'text-yellow-500';
    if (status === 'A') return 'text-green-500';
    if (status === 'D') return 'text-red-500';
    if (status === 'U') return 'text-green-500'; // Untracked usually green (new)
    return 'text-muted-foreground';
};

interface GitPanelProps {
  workspace: string;
  onOpenFile: (path: string) => void;
}

export const GitPanel: React.FC<GitPanelProps> = ({ workspace, onOpenFile }) => {
  const [stagedFiles, setStagedFiles] = useState<GitFile[]>([]);
  const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([]);
  const [branch, setBranch] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { currentSessionId, updateSession, setCurrentSession } = useAppStore();

  const refresh = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const res = await apiClient.gitStatus(workspace);
      setBranch(res.branch || '');
      
      const staged: GitFile[] = [];
      const unstaged: GitFile[] = [];
      
      res.files.forEach(f => {
        const indexStatus = f.status[0];
        const worktreeStatus = f.status[1];
        
        // Handle Untracked (??) explicitly to avoid duplication
        if (indexStatus === '?' && worktreeStatus === '?') {
            unstaged.push({ path: f.path, status: '?' }); // Untracked
        } else {
            if (indexStatus !== ' ' && indexStatus !== '?') {
               staged.push({ path: f.path, status: indexStatus });
            }
            if (worktreeStatus !== ' ' && worktreeStatus !== '?') {
               unstaged.push({ path: f.path, status: worktreeStatus });
            }
        }
      });
      
      setStagedFiles(staged);
      setUnstagedFiles(unstaged);

      // Sync Open Files State with Git Status (Robust Diff Rendering)
      // If any open file is modified, ensure it has originalContent loaded.
      const store = useAppStore.getState();
      const openFiles = store.openFiles;
      
      // Collect modified paths
      const modifiedPaths = new Set<string>();
      [...staged, ...unstaged].forEach(f => modifiedPaths.add(f.path));
      
      for (const file of openFiles) {
          if (modifiedPaths.has(file.path) && !file.originalContent) {
              // Fetch original content quietly to enable diff view
              try {
                  const oldRes = await apiClient.gitShow(workspace, file.path, 'HEAD');
                  store.updateOpenFile(file.path, { originalContent: oldRes.content });
              } catch { /* ignore */ }
          }
      }

    } catch (e) {
      console.error(e);
      setBranch('');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [workspace]);

  const handleStage = async (path: string) => {
    await apiClient.gitAdd(workspace, [path]);
    refresh();
  };

  const handleUnstage = async (path: string) => {
      await apiClient.gitReset(workspace, [path]);
      refresh();
  };

  const handleCommit = async () => {
    if (!commitMessage) return;
    await apiClient.gitCommit(workspace, commitMessage);
    setCommitMessage('');
    refresh();
    
    // Terminate session if active
    if (currentSessionId) {
        try {
            await apiClient.closeInteractiveSession(currentSessionId);
            updateSession(currentSessionId, { status: 'completed' });
            setCurrentSession('');
        } catch (e) {
            console.error("Failed to close session on commit", e);
        }
    }
  };
  
  const handleInit = async () => {
      await apiClient.gitInit(workspace);
      refresh();
  };

  if (!branch && !isLoading) {
      return (
          <div className="p-4 flex flex-col items-center gap-4">
              <div className="text-sm text-muted-foreground">No Git repository found.</div>
              <Button onClick={handleInit} variant="outline" size="sm">Initialize Repository</Button>
          </div>
      )
  }

  const handleOpenFile = async (path: string) => {
      // If file is modified, open in Diff View
      const isModified = stagedFiles.some(f => f.path === path) || unstagedFiles.some(f => f.path === path);
      if (isModified) {
          try {
              const oldRes = await apiClient.gitShow(workspace, path, 'HEAD');
              const newRes = await apiClient.readFile(workspace, path);
              
              const editorFile = {
                  path: path,
                  content: newRes.content,
                  originalContent: oldRes.content, // Trigger Diff Mode
                  isDirty: false,
                  language: 'plaintext' // We need to get language properly, but FileTree does it. GitPanel lacks context.
                  // But CodeEditor handles extension detection usually if we just pass path.
                  // Actually addOpenFile doesn't detect language if we pass it explicitly.
                  // Let's use a helper or just extension.
              };
              // Helper not available here easily without importing from App/Utils.
              // Let's just pass path and let store/editor handle?
              // Store expects 'language'.
              const ext = path.split('.').pop() || '';
              editorFile.language = ext === 'ts' || ext === 'tsx' ? 'typescript' : ext === 'js' || ext === 'jsx' ? 'javascript' : ext === 'py' ? 'python' : ext === 'md' ? 'markdown' : 'plaintext';
              
              useAppStore.getState().addOpenFile(editorFile);
              useAppStore.getState().setActiveFile(path);
          } catch (e) {
              onOpenFile(path);
          }
      } else {
          onOpenFile(path);
      }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-2 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch className="w-4 h-4" />
            {branch}
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-4">
            {/* Staged */}
            <div>
                <div className="text-xs font-semibold text-muted-foreground mb-2 flex justify-between">
                    <span>STAGED CHANGES</span>
                    <span>{stagedFiles.length}</span>
                </div>
                {stagedFiles.map(f => (
                    <div key={f.path} className="flex items-center justify-between group hover:bg-muted/50 p-1 rounded cursor-pointer" onClick={() => handleOpenFile(f.path)}>
                        <span className="text-sm truncate flex-1" title={f.path}>{f.path}</span>
                        <span className={`text-xs mr-2 ${getStatusColor(f.status)}`}>{getStatusLabel(f.status)}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); handleUnstage(f.path); }}>
                            <Minus className="w-3 h-3" />
                        </Button>
                    </div>
                ))}
            </div>

            {/* Unstaged */}
             <div>
                <div className="text-xs font-semibold text-muted-foreground mb-2 flex justify-between">
                    <span>CHANGES</span>
                    <span>{unstagedFiles.length}</span>
                </div>
                {unstagedFiles.map(f => (
                    <div key={f.path} className="flex items-center justify-between group hover:bg-muted/50 p-1 rounded cursor-pointer" onClick={() => handleOpenFile(f.path)}>
                        <span className="text-sm truncate flex-1" title={f.path}>{f.path}</span>
                        <span className={`text-xs mr-2 ${getStatusColor(f.status)}`}>{getStatusLabel(f.status)}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); handleStage(f.path); }}>
                            <Plus className="w-3 h-3" />
                        </Button>
                    </div>
                ))}
            </div>
        </div>
      </div>

      <div className="p-2 border-t space-y-2">
        <textarea 
            className="w-full text-sm p-2 border rounded bg-background resize-none h-20" 
            placeholder="Commit message (Cmd+Enter)"
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    handleCommit();
                }
            }}
        />
        <Button className="w-full" onClick={handleCommit} disabled={!stagedFiles.length || !commitMessage}>
            <Check className="w-4 h-4 mr-2" />
            {currentSessionId ? 'Commit & End Session' : 'Commit'}
        </Button>
      </div>
    </div>
  );
};
