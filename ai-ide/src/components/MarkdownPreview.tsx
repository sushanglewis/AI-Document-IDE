import React from 'react'
import { cn } from '../lib/utils'

interface MarkdownPreviewProps {
  content: string
  className?: string
  onToggleFullscreen?: () => void
  isFullscreen?: boolean
  showToolbar?: boolean
  onRefresh?: () => void
  onContentChange?: (content: string) => void
  showWordCount?: boolean
  showReadingTime?: boolean
  enableAutoScroll?: boolean
  customStyles?: {
    fontSize?: 'sm' | 'base' | 'lg'
    lineHeight?: 'tight' | 'normal' | 'relaxed'
    theme?: 'light' | 'dark' | 'auto'
  }
  renderMode?: 'markdown' | 'html'
  filePath?: string
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  className,
  onToggleFullscreen,
  isFullscreen = false,
  showToolbar = false,
  onRefresh,
  
  showWordCount = false,
  showReadingTime = false,
  enableAutoScroll = false,
  customStyles = { fontSize: 'base', lineHeight: 'relaxed', theme: 'auto' },
  renderMode = 'markdown',
  filePath = '',
}) => {
  const contentRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.toString().length === 0) return;
      
      const selectedText = selection.toString();
      
      // Create custom context menu
      const menu = document.createElement('div');
      menu.className = 'fixed z-[9999] bg-popover text-popover-foreground border rounded-md shadow-md py-1 min-w-[120px] text-sm';
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;
      
      const item = document.createElement('div');
      item.className = 'px-3 py-1.5 hover:bg-accent hover:text-accent-foreground cursor-pointer flex items-center gap-2';
      item.innerHTML = '<span>Insert to session</span>';
      
      item.onclick = () => {
          // Try to parse line numbers from selection if it looks like cat -n output (e.g. "   1\tContent")
          let start = 0;
          let end = 0;
          let cleanContent = selectedText;
          
          const lines = selectedText.split('\n');
          if (lines.length > 0) {
              const parseLine = (l: string) => {
                  const m = l.match(/^\s*(\d+)\t/);
                  return m ? parseInt(m[1]) : null;
              };
              const s = parseLine(lines[0]);
              if (s) start = s;
              const e = parseLine(lines[lines.length - 1]);
              if (e) end = e;
              
              // If we detected line numbers, strip them from content
              if (start && end) {
                  cleanContent = lines.map(l => l.replace(/^\s*\d+\t/, '')).join('\n');
              }
          }

          // Fallback: if no line numbers found but we have file content, try to find location?
          // This is hard without full content context. For now, trust cat -n or user selection.
          // If start/end are 0, backend might fail to use them for disambiguation, which is fine (falls back to string match).

          const event = new CustomEvent('insert-capsule', { 
              detail: { 
                  type: 'context', 
                  content: cleanContent,
                  metadata: {
                      path: filePath,
                      start: start > 0 ? start : undefined,
                      end: end > 0 ? end : undefined
                  }
              } 
          });
          window.dispatchEvent(event);
          document.body.removeChild(menu);
      };
      
      menu.appendChild(item);
      document.body.appendChild(menu);
      
      const cleanup = () => {
          if (document.body.contains(menu)) {
              document.body.removeChild(menu);
          }
          document.removeEventListener('click', cleanup);
      };
      
      // Delay slightly to avoid immediate trigger
      setTimeout(() => {
          document.addEventListener('click', cleanup);
      }, 10);
    };

    const el = contentRef.current;
    if (el) {
        el.addEventListener('contextmenu', handleContextMenu);
    }
    return () => {
        if (el) el.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [filePath]);

  // Handle Copy as Capsule
  React.useEffect(() => {
      const handleCopy = (e: ClipboardEvent) => {
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0 || selection.toString().length === 0) return;
          
          // Check if selection is within our component
          if (contentRef.current && contentRef.current.contains(selection.anchorNode)) {
               e.preventDefault();
               const text = selection.toString();
               
               // Construct capsule
               const capsuleType = 'context';
               const capsuleDesc = '这是用户引用的文档片段';
               const innerContent = `<paragraph_capsule>\n  <paragraph path="${filePath}">\n    <command>str_replace</command>\n    <content>${text}</content>\n  </paragraph>\n</paragraph_capsule>`;
               const clipboardText = ` \`\`\`{type=${capsuleType}, description=${capsuleDesc}}${innerContent}\`\`\` `;
               
               if (e.clipboardData) {
                   e.clipboardData.setData('text/plain', clipboardText);
               }
          }
      };
      
      const el = contentRef.current;
      if (el) {
          el.addEventListener('copy', handleCopy);
      }
      return () => {
          if (el) el.removeEventListener('copy', handleCopy);
      };
  }, [filePath]);


  React.useEffect(() => {
    if (enableAutoScroll && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [content, enableAutoScroll])

  return (
    <div className={cn(
      'flex flex-col h-full',
      customStyles.theme === 'dark' ? 'bg-[#1e1e1e] text-[#d4d4d4]' : 'bg-[#fffffe] text-black',
      className
    )}>
      {showToolbar && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
          <div className="flex items-center gap-3">
            {showWordCount && <span className="text-xs text-muted-foreground">{content.length} 字符</span>}
            {showReadingTime && (
              <span className="text-xs text-muted-foreground">📖 {Math.ceil(content.trim().split(/\s+/).length / 200)} 分钟阅读</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <button onClick={onRefresh} className="px-2 py-1 text-xs hover:bg-accent rounded">刷新</button>
            )}
            {onToggleFullscreen && (
              <button onClick={onToggleFullscreen} className="px-2 py-1 text-xs hover:bg-accent rounded">
                {isFullscreen ? '退出全屏' : '全屏'}
              </button>
            )}
          </div>
        </div>
      )}

      <div
        ref={contentRef}
        className={cn(
          'flex-1 overflow-y-auto text-foreground',
          customStyles.fontSize === 'sm' && 'text-sm',
          customStyles.fontSize === 'base' && 'text-base',
          customStyles.fontSize === 'lg' && 'text-lg',
          customStyles.lineHeight === 'tight' && 'leading-tight',
          customStyles.lineHeight === 'normal' && 'leading-normal',
          customStyles.lineHeight === 'relaxed' && 'leading-relaxed'
        )}
      >
        {renderMode === 'html' ? (
          <div
            className={cn(
              'prose max-w-none p-6 bg-transparent',
              customStyles.theme === 'dark' ? 'prose-invert text-[#d4d4d4]' : 'text-black'
            )}
            dangerouslySetInnerHTML={{ __html: content || '' }}
          />
        ) : (
          <pre className="p-6 whitespace-pre-wrap break-words">{content}</pre>
        )}
      </div>
    </div>
  )
}
