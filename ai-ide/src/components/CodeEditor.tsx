import React from 'react';
import Editor from '@monaco-editor/react';
import { Save, X, Circle, Edit3, Split, Plus, Check, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAppStore } from '../lib/store';
import { apiClient } from '../lib/api';
import Toast from '../lib/toast';
import { MarkdownPreview } from './MarkdownPreview';

interface CodeEditorProps {
  className?: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ className }) => {
  const { 
    openFiles, 
    activeFilePath, 
    updateOpenFile, 
    removeOpenFile, 
    pendingDiffs, 
    // setChatInput, // Removed unused variable to fix build error
    removePendingDiff, 
    clearPendingDiffs, 
    theme,
    workspaceRoot,
    // addOpenFile, // unused
    // addPendingDiff // unused
  } = useAppStore();
  
  const [isSaving, setIsSaving] = React.useState(false);
  const [previewMode, setPreviewMode] = React.useState<'edit' | 'split'>('edit');
  const [previewType, setPreviewType] = React.useState<'markdown' | 'html'>('markdown');

  const editorRef = React.useRef<any>(null);
  const monacoRef = React.useRef<any>(null);
  const decorationsCollectionRef = React.useRef<any>(null);
  const zoneIdsRef = React.useRef<string[]>([]);

  const activeFile = openFiles.find(f => f.path === activeFilePath);

  const handleAcceptDiff = async () => {
    if (!activeFile || !activeFile.originalContent) return;
    try {
      await apiClient.gitAdd(workspaceRoot, [activeFile.path]);
      updateOpenFile(activeFile.path, { originalContent: undefined });
      Toast.success('Changes accepted');
    } catch (e) {
      Toast.error('Failed to stage changes');
    }
  };

  const handleRejectDiff = async () => {
    if (!activeFile || !activeFile.originalContent) return;
    try {
      await apiClient.gitCheckout(workspaceRoot, [activeFile.path]);
      const res = await apiClient.readFile(workspaceRoot, activeFile.path);
      updateOpenFile(activeFile.path, { content: res.content, originalContent: undefined });
      Toast.success('Changes rejected');
    } catch (e) {
      Toast.error('Failed to revert changes');
    }
  };

    // Diff Rendering Effect
  React.useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !activeFile) return;
    
    const diffs = pendingDiffs[activeFile.path] || [];
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    
    // Guard against invalid editor
    if (!editor || !editor.changeViewZones) return;
    
    // Clear old decorations and zones
    if (decorationsCollectionRef.current) {
        decorationsCollectionRef.current.clear();
    }
    editor.changeViewZones((changeAccessor: any) => {
        zoneIdsRef.current.forEach(id => changeAccessor.removeZone(id));
        zoneIdsRef.current = [];
    });

    if (diffs.length === 0) return;

    const decorations: any[] = [];
    const model = editor.getModel();
    const fileContent = model.getValue();
    
    // We need to batch zone creation
    editor.changeViewZones((changeAccessor: any) => {
        diffs.forEach(diff => {
            let start = diff.start;
            let end = diff.end;

            // 1. Robustness: Try string matching first if old_str is available
            // Note: pendingDiffs store structure should ideally have old_str.
            // Assuming diff object has optional old_content or we infer from range if matching fails
            
            // Actually, the current pendingDiff structure in store seems to be { id, start, end, new_content, ... }
            // If backend sends old_str, we should use it. 
            // But if we only have start/end, we must validate them.
            
            // Strategy:
            // A. Check if [start, end] matches expected content (if we knew it). 
            //    Since we don't strictly store old_str in pendingDiffs (based on store definition, let's assume we might add it or rely on start/end).
            //    If we can't verify content, we rely on start/end but clamp them.
            
            // B. Fallback / Validation:
            if (start > fileContent.length || end > fileContent.length) {
                 // Absolute position is out of bounds. 
                 // Try to find a best guess or just warn. 
                 // For now, we skip to avoid crash, or clamp to end.
                 console.warn(`Diff position out of bounds: ${start}-${end}, file length: ${fileContent.length}`);
                 return;
            }

            // C. String Matching Fallback (If `old_content` exists in diff - future proofing)
            // if (diff.old_content && fileContent.substring(start, end) !== diff.old_content) {
            //    const actualIdx = fileContent.indexOf(diff.old_content);
            //    if (actualIdx !== -1) {
            //        start = actualIdx;
            //        end = actualIdx + diff.old_content.length;
            //    }
            // }

            const startPos = model.getPositionAt(start);
            const endPos = model.getPositionAt(end);
            const range = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
            
            // 1. Highlight Original (Red/Strike)
            decorations.push({
                range,
                options: {
                    isWholeLine: false,
                    className: 'bg-destructive/20 line-through decoration-destructive',
                    hoverMessage: { value: 'Original Content (Pending Change)' },
                    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
                }
            });
            
            // 2. Insert ViewZone for New Content
            const domNode = document.createElement('div');
            domNode.className = "flex flex-col gap-2 bg-green-500/10 border-l-4 border-green-500 p-2 text-sm font-mono pointer-events-auto relative z-50";
            domNode.style.pointerEvents = 'auto';
            domNode.style.zIndex = '50';
            
            // Stop propagation on container to prevent editor from stealing focus/clicks
            domNode.onmousedown = (e) => e.stopPropagation();
            domNode.onmouseup = (e) => e.stopPropagation();
            domNode.onclick = (e) => e.stopPropagation();
            
            // Content
            const contentDiv = document.createElement('pre');
            contentDiv.className = "m-0 whitespace-pre-wrap break-words text-foreground select-text cursor-text";
            contentDiv.textContent = diff.new_content;
            domNode.appendChild(contentDiv);
            
            // Actions
            const actionsDiv = document.createElement('div');
            actionsDiv.className = "flex gap-2 mt-1 pointer-events-auto";
            
            const acceptBtn = document.createElement('button');
            acceptBtn.textContent = '接收';
            acceptBtn.className = 'px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors cursor-pointer pointer-events-auto select-none shadow-sm';
            // Prevent Monaco from stealing focus or events
            acceptBtn.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
            acceptBtn.onclick = async (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('Accept clicked for diff:', diff.id, 'Request ID:', diff.metadata?.request_id);
                // Recalculate range based on current offsets in case of shifts (though batching usually assumes stable state)
                // Ideally we re-resolve start/end here if we want to be super robust against concurrent edits.
                // But for now, using the captured range is standard for single-user flow.
                editor.executeEdits('diff-accept', [{
                    range,
                    text: diff.new_content,
                    forceMoveMarkers: true
                }]);
                
                // Business Logic: Accept -> Apply to buffer -> Remove Diff -> Save File -> Git Add (optional but requested)
                // Update store content first
                const newContent = editor.getValue();
                handleContentChange(newContent);
                removePendingDiff(activeFile.path, diff.id);
                
                // Auto-save and Git Add as per user request for "business logic"
                try {
                    const workspace = useAppStore.getState().workspaceRoot || '/workspace';
                    // Save
                    if (activeFile.path.startsWith('/Online/')) {
                         // Online doc skip git
                         const documentId = activeFile.path.replace('/Online/', '');
                         await apiClient.updateOnlineDoc({ documentId, content: newContent });
                    } else {
                         await apiClient.writeFile(workspace, activeFile.path, newContent);
                         // Git Add
                         await apiClient.gitAdd(workspace, [activeFile.path]);
                         // Git Commit
                         await apiClient.gitCommit(workspace, `Accept changes to ${activeFile.path} (Req: ${diff.metadata?.request_id})`);
                         Toast.success('已接受更改并提交');
                    }
                } catch (err) {
                    console.error('Accept action failed:', err);
                    Toast.error('保存或提交失败，但更改已应用到编辑器');
                }
            };
            
            const rejectBtn = document.createElement('button');
            rejectBtn.textContent = '拒绝';
            rejectBtn.className = 'px-2 py-1 bg-destructive text-white text-xs rounded hover:bg-destructive/90 transition-colors cursor-pointer pointer-events-auto select-none shadow-sm';
            rejectBtn.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
            rejectBtn.onclick = async (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('Reject clicked for diff:', diff.id, 'Request ID:', diff.metadata?.request_id);
                removePendingDiff(activeFile.path, diff.id);
                
                // Business Logic: Reject -> Remove Diff -> Revert File (Git Checkout)
                try {
                    const workspace = useAppStore.getState().workspaceRoot || '/workspace';
                    if (!activeFile.path.startsWith('/Online/')) {
                         // Revert logic:
                         // We just removed the diff, so the editor VIEW returns to oldContent (because we set content=oldContent in App.tsx).
                         // BUT we need to ensure the FILE on disk is also reverted (it might have been changed by tool).
                         // AND we need to ensure the editor model matches disk.
                         
                         // Revert disk to HEAD
                         await apiClient.gitCheckout(workspace, [activeFile.path]);
                         
                         // Reload content from disk to ensure editor is in sync
                         const res = await apiClient.readFile(workspace, activeFile.path);
                         updateOpenFile(activeFile.path, { content: res.content, originalContent: undefined });
                         
                         Toast.success('已拒绝更改并回滚文件');
                    }
                } catch (err) {
                    console.error('Reject action failed:', err);
                    Toast.error('回滚文件失败');
                }
            };
            
            actionsDiv.appendChild(acceptBtn);
            actionsDiv.appendChild(rejectBtn);
            domNode.appendChild(actionsDiv);
            
            const lineCount = diff.new_content.split('\n').length;
            // Calculate height: roughly 19px per line + padding + actions (approx 30px)
            // ViewZones use lines as height unit.
            // Let's approximate.
            const heightInLines = Math.max(lineCount, 1) + 3; 
            
            const zoneId = changeAccessor.addZone({
                afterLineNumber: endPos.lineNumber,
                heightInLines: heightInLines,
                domNode: domNode
            });
            zoneIdsRef.current.push(zoneId);
        });
    });
    
    if (decorationsCollectionRef.current) {
        decorationsCollectionRef.current.set(decorations);
    }
    
  }, [pendingDiffs, activeFile, removePendingDiff, previewMode]); // Added previewMode dependency to force re-render on mode switch

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    decorationsCollectionRef.current = editor.createDecorationsCollection([]);

    // Add Action: Copy to Clipboard as Capsule
    editor.addAction({
      id: 'copy-capsule-to-clipboard',
      label: 'Copy as Capsule',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: (ed: any) => {
        const selection = ed.getSelection();
        if (selection && !selection.isEmpty()) {
           const model = ed.getModel();
           const content = model.getValueInRange(selection);
           const path = activeFilePath || '/unknown';
           
           // Construct the full capsule string
           const capsuleType = 'context';
           const capsuleDesc = '这是用户引用的文档片段';
           const innerContent = `<paragraph_capsule>\n  <paragraph path="${path}">\n    <command>str_replace</command>\n    <content>${content}</content>\n  </paragraph>\n</paragraph_capsule>`;
           
           const clipboardText = ` \`\`\`{type=${capsuleType}, description=${capsuleDesc}}${innerContent}\`\`\` `;
           
           navigator.clipboard.writeText(clipboardText).then(() => {
               Toast.success('胶囊信息已复制到剪切板');
           }).catch(err => {
               console.error('Failed to copy:', err);
               Toast.error('复制失败');
           });
        }
      }
    });
  };

  const handleNewFile = () => {
    const timestamp = Date.now();
    const path = `/workspace/Untitled-${timestamp}.md`;
    updateOpenFile(path, { content: '', isDirty: true });
    useAppStore.getState().setActiveFile(path);
    // Switch to edit mode automatically
    setPreviewMode('edit');
  };

  const handleAcceptAll = () => {
    if (!activeFile || !editorRef.current || !monacoRef.current) return;
    const diffs = pendingDiffs[activeFile.path] || [];
    if (diffs.length === 0) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor.getModel();

    const edits = diffs.map(diff => {
        const startPos = model.getPositionAt(diff.start);
        const endPos = model.getPositionAt(diff.end);
        const range = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
        return {
            range,
            text: diff.new_content,
            forceMoveMarkers: true
        };
    });

    editor.executeEdits('diff-accept-all', edits);
    clearPendingDiffs(activeFile.path);
    handleContentChange(editor.getValue());
  };

  const handleSave = async () => {
    if (!activeFile) return;

    setIsSaving(true);
    try {
      if (activeFile.path.startsWith('/Online/')) {
        // Online Document Save
        const documentId = activeFile.path.replace('/Online/', '');
        await apiClient.updateOnlineDoc({
          documentId,
          content: activeFile.content
        });
        updateOpenFile(activeFile.path, { isDirty: false });
        Toast.success('在线文档已保存');
      } else {
        // Workspace File Save
        const workspace = '/workspace'; // This should come from store
        await apiClient.writeFile(workspace, activeFile.path, activeFile.content);
        updateOpenFile(activeFile.path, { isDirty: false });
        Toast.success('文件已保存');
      }
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

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const toggle = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm';
      if (toggle) {
        e.preventDefault();
        // setPreviewHidden((v) => !v); // Removed unused functionality
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
      <div className="flex items-center bg-muted h-9 border-b flex-shrink-0">
        <div className="flex-1 flex overflow-x-auto h-full no-scrollbar">
          {openFiles.map((file) => (
            <div
              key={file.path}
              className={cn(
                "flex items-center gap-2 px-3 border-r cursor-pointer min-w-0 h-full",
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
              <span className="text-xs truncate flex-1 font-medium">
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
          
          <button
            onClick={handleNewFile}
            className="flex items-center justify-center w-8 h-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="新建文档"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        
        <div className="flex items-center gap-2 ml-auto pr-2 h-full">
          {activeFile && activeFile.originalContent && (
            <div className="flex items-center gap-1 mr-2 bg-muted rounded-md p-1">
                <button
                    onClick={handleAcceptDiff}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                    <Check className="h-3 w-3" />
                    Accept Changes
                </button>
                <button
                    onClick={handleRejectDiff}
                    className="flex items-center gap-1 px-2 py-1 text-xs hover:bg-destructive/10 text-destructive transition-colors"
                >
                    <RotateCcw className="h-3 w-3" />
                    Reject Changes
                </button>
            </div>
          )}
          {activeFile && pendingDiffs[activeFile.path] && pendingDiffs[activeFile.path].length > 0 && (
            <div className="flex items-center gap-1 mr-2 bg-muted rounded-md p-1">
                <button
                    onClick={handleAcceptAll}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                    <Check className="h-3 w-3" />
                    接收所有
                </button>
                <button
                    onClick={() => clearPendingDiffs(activeFile.path)}
                    className="flex items-center gap-1 px-2 py-1 text-xs hover:bg-destructive/10 text-destructive transition-colors"
                >
                    <X className="h-3 w-3" />
                    拒绝所有
                </button>
            </div>
          )}
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
        {(activeFile && (activeFile.path.endsWith('.md') || activeFile.path.endsWith('.markdown')) && previewMode === 'split' ? (
          <div className={cn("grid h-full min-h-0 w-full", 'grid-cols-2')}>
            {previewMode === 'split' && (
              <div className="overflow-y-auto border-r">
                <Editor
                  height="100%"
                  language={getLanguage(activeFile.path)}
                  value={activeFile.content}
                  onChange={handleContentChange}
                  onMount={handleEditorDidMount}
                  theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                     wordWrap: 'on',
                     readOnly: false,
                   }}
                 />
               </div>
             )}
             <div className="h-full overflow-hidden bg-white text-black">
               <MarkdownPreview 
                  content={activeFile.content} 
                  renderMode={previewType} 
                  className="h-full overflow-y-auto p-4" 
               />
             </div>
          </div>
        ) : (
          <Editor
            height="100%"
            language={activeFile ? getLanguage(activeFile.path) : 'plaintext'}
            value={activeFile ? activeFile.content : ''}
            onChange={handleContentChange}
            onMount={handleEditorDidMount}
            theme={theme === 'dark' ? 'vs-dark' : 'vs'}
            options={{
              minimap: { enabled: true },
              fontSize: 14,
              wordWrap: 'on',
              readOnly: false,
            }}
          />
        ))}
      </div>
    </div>
  );
};
