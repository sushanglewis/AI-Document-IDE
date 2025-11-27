import React from 'react';
import Editor from '@monaco-editor/react';
import { Save, X, Circle, Edit3, Split } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAppStore } from '../lib/store';
import { apiClient } from '../lib/api';
import Toast from '../lib/toast';
import { MarkdownPreview } from './MarkdownPreview';

interface CodeEditorProps {
  className?: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ className }) => {
  const { openFiles, activeFilePath, updateOpenFile, removeOpenFile } = useAppStore();
  const [isSaving, setIsSaving] = React.useState(false);
  const [previewMode, setPreviewMode] = React.useState<'edit' | 'split'>('edit');
  const [previewType, setPreviewType] = React.useState<'markdown' | 'html'>('markdown');
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isPreviewHidden, setPreviewHidden] = React.useState(false);

  const activeFile = openFiles.find(f => f.path === activeFilePath);

  const handleSave = async () => {
    if (!activeFile) return;

    setIsSaving(true);
    try {
      const workspace = '/workspace'; // This should come from store
      await apiClient.writeFile(workspace, activeFile.path, activeFile.content);
      updateOpenFile(activeFile.path, { isDirty: false });
      Toast.success('文件已保存');
    } catch (error) {
      console.error('Failed to save file:', error);
      Toast.error('保存文件失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleContentChange = (value: string | undefined) => {
    if (!activeFile || value === undefined) return;
    updateOpenFile(activeFile.path, { 
      content: value,
      isDirty: true 
    });
  };

  const handleToggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const toggle = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm';
      if (toggle) {
        e.preventDefault();
        setPreviewHidden((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleRefreshPreview = () => {
    // Trigger a re-render by updating the file content (add a space and remove it)
    if (activeFile) {
      const currentContent = activeFile.content;
      updateOpenFile(activeFile.path, { content: currentContent + ' ' });
      setTimeout(() => {
        updateOpenFile(activeFile.path, { content: currentContent });
      }, 10);
    }
  };

  const handleCloseTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeOpenFile(path);
  };

  const getLanguage = (filePath: string): string => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'php': 'php',
      'rb': 'ruby',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'xml': 'xml',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'ini': 'ini',
      'cfg': 'ini',
      'conf': 'ini',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'fish': 'shell',
      'ps1': 'powershell',
      'bat': 'batch',
      'cmd': 'batch',
      'sql': 'sql',
      'md': 'markdown',
      'markdown': 'markdown',
      'txt': 'plaintext',
      'log': 'log',
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
    };
    
    return languageMap[ext || ''] || 'plaintext';
  };

  if (openFiles.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full bg-muted/30", className)}>
        <div className="text-center text-muted-foreground">
          <div className="text-lg mb-2">未打开文件</div>
          <div className="text-sm">从文件树中选择一个文件开始编辑</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Tabs */}
      <div className="flex items-center bg-muted border-b">
        <div className="flex-1 flex overflow-x-auto">
          {openFiles.map((file) => (
            <div
              key={file.path}
              className={cn(
                "flex items-center gap-2 px-3 py-2 border-r cursor-pointer min-w-0",
                file.path === activeFilePath
                  ? "bg-background border-b-0"
                  : "bg-muted hover:bg-muted/80"
              )}
              onClick={() => useAppStore.getState().setActiveFile(file.path)}
            >
              <Circle 
                className={cn(
                  "h-2 w-2 flex-shrink-0",
                  file.isDirty ? "text-orange-500 fill-orange-500" : "text-transparent"
                )} 
              />
              <span className="text-sm truncate flex-1">
                {file.path.split('/').pop()}
              </span>
              <button
                onClick={(e) => handleCloseTab(file.path, e)}
                className="p-0.5 hover:bg-accent rounded-sm flex-shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        
        <div className="flex items-center gap-2 ml-auto pr-2">
          {activeFile && (activeFile.path.endsWith('.md') || activeFile.path.endsWith('.markdown')) && (
            <div className="flex items-center gap-1 bg-muted rounded-md p-1">
              <button
                onClick={() => setPreviewMode('edit')}
                className={cn(
                  "px-2 py-1 text-xs rounded transition-colors flex items-center gap-1",
                  previewMode === 'edit' 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                title="编辑模式"
              >
                <Edit3 className="h-3 w-3" />
                编辑
              </button>
              <button
                onClick={() => setPreviewMode('split')}
                className={cn(
                  "px-2 py-1 text-xs rounded transition-colors flex items-center gap-1",
                  previewMode === 'split' 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                title="分屏模式"
              >
                <Split className="h-3 w-3" />
                分屏
              </button>
              <button
                onClick={() => { setPreviewType('html'); setPreviewMode('split'); }}
                className={cn(
                  "px-2 py-1 text-xs rounded transition-colors flex items-center gap-1",
                  previewType === 'html' && previewMode === 'split'
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                title="HTML预览"
              >
                HTML预览
              </button>
              <button
                onClick={() => { setPreviewType('markdown'); setPreviewMode('split'); }}
                className={cn(
                  "px-2 py-1 text-xs rounded transition-colors flex items-center gap-1",
                  previewType === 'markdown' && previewMode === 'split'
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                title="Markdown预览"
              >
                Markdown预览
              </button>
              
            </div>
          )}
          {activeFile && (
            <button
              onClick={handleSave}
              disabled={!activeFile.isDirty || isSaving}
              className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              保存
            </button>
          )}
        </div>
      </div>

      {/* Editor / Markdown Preview */}
      <div className="flex-1 flex min-h-0">
        {activeFile && (activeFile.path.endsWith('.md') || activeFile.path.endsWith('.markdown')) && previewMode === 'split' ? (
          <div className={cn("grid h-full min-h-0 w-full", 'grid-cols-2')}>
            {previewMode === 'split' && (
              <div className="overflow-y-auto border-r">
                <Editor
                  height="100%"
                  language={getLanguage(activeFile.path)}
                  value={activeFile.content}
                  onChange={handleContentChange}
                  theme="vs"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    wordWrap: 'on',
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    renderWhitespace: 'selection',
                    bracketPairColorization: { enabled: true },
                    suggest: { showKeywords: true, showSnippets: true },
                  }}
                />
              </div>
            )}
            <div className={cn(
              'overflow-y-auto min-h-0 h-full w-full',
              isPreviewHidden && 'hidden'
            )}>
              <MarkdownPreview
                content={activeFile.content || ''}
                showToolbar={false}
                onRefresh={handleRefreshPreview}
                onToggleFullscreen={handleToggleFullscreen}
                isFullscreen={isFullscreen}
                showWordCount={true}
                showReadingTime={true}
                enableAutoScroll={false}
                customStyles={{
                  fontSize: 'base',
                  lineHeight: 'relaxed',
                  theme: 'auto'
                }}
                renderMode={previewType}
              />
            </div>
          </div>
        ) : (
          // Edit Mode or Non-Markdown Files
          activeFile && (
            <Editor
              height="100%"
              language={getLanguage(activeFile.path)}
              value={activeFile.content}
              onChange={handleContentChange}
              theme="vs"
              options={{
                minimap: { enabled: true },
                fontSize: 14,
                wordWrap: 'on',
                automaticLayout: true,
                scrollBeyondLastLine: false,
                renderWhitespace: 'selection',
                bracketPairColorization: { enabled: true },
                suggest: { showKeywords: true, showSnippets: true },
              }}
            />
          )
        )}
      </div>
    </div>
  );
};
