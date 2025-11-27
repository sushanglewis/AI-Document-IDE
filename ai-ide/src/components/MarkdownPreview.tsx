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
}) => {
  const contentRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (enableAutoScroll && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [content, enableAutoScroll])

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
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
              'prose max-w-none p-6 bg-white text-black',
              customStyles.theme === 'light' && 'prose'
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
