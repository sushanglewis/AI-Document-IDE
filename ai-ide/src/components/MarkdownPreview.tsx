import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Download, Maximize2, Minimize2, RefreshCw, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  onCopy?: () => void;
  onDownload?: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  showToolbar?: boolean;
  onRefresh?: () => void;
  onContentChange?: (content: string) => void;
  showWordCount?: boolean;
  showReadingTime?: boolean;
  enableAutoScroll?: boolean;
  customStyles?: {
    fontSize?: 'sm' | 'base' | 'lg';
    lineHeight?: 'tight' | 'normal' | 'relaxed';
    theme?: 'light' | 'dark' | 'auto';
  };
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  className,
  onCopy,
  onDownload,
  onToggleFullscreen,
  isFullscreen = false,
  showToolbar = true,
  onRefresh,
  onContentChange,
  showWordCount = true,
  showReadingTime = true,
  enableAutoScroll = false,
  customStyles = {
    fontSize: 'base',
    lineHeight: 'relaxed',
    theme: 'auto'
  }
}) => {
  const [showSettings, setShowSettings] = React.useState(false);
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Calculate reading time (average 200 words per minute)
  const readingTime = React.useMemo(() => {
    if (!showReadingTime) return null;
    const words = content.trim().split(/\s+/).length;
    const minutes = Math.ceil(words / 200);
    return minutes;
  }, [content, showReadingTime]);

  // Auto-scroll to bottom when content changes
  React.useEffect(() => {
    if (enableAutoScroll && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, enableAutoScroll]);

  // Auto-refresh functionality
  React.useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      onRefresh?.();
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, onRefresh]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success('Markdown内容已复制到剪贴板');
      onCopy?.();
    } catch (error) {
      toast.error('复制失败');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Markdown文件已下载');
    onDownload?.();
  };

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Markdown 预览</span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {showWordCount && (
                <span className="bg-muted px-2 py-1 rounded">
                  {content.length} 字符
                </span>
              )}
              {showReadingTime && readingTime && (
                <span className="bg-muted px-2 py-1 rounded">
                  📖 {readingTime} 分钟阅读
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                title="刷新内容"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={handleCopy}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
              title="复制内容"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              onClick={handleDownload}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
              title="下载文件"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "p-2 rounded transition-colors",
                showSettings 
                  ? "text-primary bg-primary/10" 
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
              title="预览设置"
            >
              <Settings className="h-4 w-4" />
            </button>
            {onToggleFullscreen && (
              <button
                onClick={onToggleFullscreen}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                title={isFullscreen ? "退出全屏" : "全屏预览"}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && showToolbar && (
        <div className="px-4 py-3 border-b bg-muted/30">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-muted-foreground mb-1">字体大小</label>
              <select 
                value={customStyles.fontSize}
                onChange={() => onContentChange?.(content)}
                className="w-full px-2 py-1 border rounded bg-background text-xs"
              >
                <option value="sm">小</option>
                <option value="base">中</option>
                <option value="lg">大</option>
              </select>
            </div>
            <div>
              <label className="block text-muted-foreground mb-1">行高</label>
              <select 
                value={customStyles.lineHeight}
                onChange={() => onContentChange?.(content)}
                className="w-full px-2 py-1 border rounded bg-background text-xs"
              >
                <option value="tight">紧凑</option>
                <option value="normal">正常</option>
                <option value="relaxed">宽松</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded"
                />
                <span className="text-muted-foreground">自动刷新 (5秒)</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Preview Content */}
      <div 
        ref={contentRef}
        className={cn(
          "flex-1 overflow-y-auto text-foreground",
          customStyles.fontSize === 'sm' && 'text-sm',
          customStyles.fontSize === 'base' && 'text-base', 
          customStyles.fontSize === 'lg' && 'text-lg',
          customStyles.lineHeight === 'tight' && 'leading-tight',
          customStyles.lineHeight === 'normal' && 'leading-normal',
          customStyles.lineHeight === 'relaxed' && 'leading-relaxed'
        )}
      >
        <div className={cn(
          "prose max-w-none p-6 dark:prose-invert",
          customStyles.theme === 'light' && 'prose',
          customStyles.theme === 'dark' && 'prose-invert'
        )}>
          {content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeHighlight]}
              components={{
                // Enhanced custom components with better styling
                h1: ({ children }) => (
                  <h1 className={cn(
                    "font-bold mt-6 mb-4 pb-2 border-b border-border",
                    customStyles.fontSize === 'sm' && "text-2xl",
                    customStyles.fontSize === 'base' && "text-3xl", 
                    customStyles.fontSize === 'lg' && "text-4xl"
                  )}>
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className={cn(
                    "font-semibold mt-5 mb-3",
                    customStyles.fontSize === 'sm' && "text-xl",
                    customStyles.fontSize === 'base' && "text-2xl", 
                    customStyles.fontSize === 'lg' && "text-3xl"
                  )}>
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className={cn(
                    "font-medium mt-4 mb-2",
                    customStyles.fontSize === 'sm' && "text-lg",
                    customStyles.fontSize === 'base' && "text-xl", 
                    customStyles.fontSize === 'lg' && "text-2xl"
                  )}>
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className={cn(
                    "font-medium mt-3 mb-2",
                    customStyles.fontSize === 'sm' && "text-base",
                    customStyles.fontSize === 'base' && "text-lg", 
                    customStyles.fontSize === 'lg' && "text-xl"
                  )}>
                    {children}
                  </h4>
                ),
                h5: ({ children }) => (
                  <h5 className={cn(
                    "font-medium mt-2 mb-1",
                    customStyles.fontSize === 'sm' && "text-sm",
                    customStyles.fontSize === 'base' && "text-base", 
                    customStyles.fontSize === 'lg' && "text-lg"
                  )}>
                    {children}
                  </h5>
                ),
                h6: ({ children }) => (
                  <h6 className={cn(
                    "font-medium mt-2 mb-1",
                    customStyles.fontSize === 'sm' && "text-xs",
                    customStyles.fontSize === 'base' && "text-sm", 
                    customStyles.fontSize === 'lg' && "text-base"
                  )}>
                    {children}
                  </h6>
                ),
                p: ({ children }) => (
                  <p className={cn(
                    "my-3",
                    customStyles.lineHeight === 'tight' && "leading-tight",
                    customStyles.lineHeight === 'normal' && "leading-normal",
                    customStyles.lineHeight === 'relaxed' && "leading-relaxed"
                  )}>
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="my-3 ml-6 space-y-1">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="my-3 ml-6 space-y-1">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className={cn(
                    "leading-relaxed",
                    customStyles.lineHeight === 'tight' && "leading-tight",
                    customStyles.lineHeight === 'normal' && "leading-normal",
                    customStyles.lineHeight === 'relaxed' && "leading-relaxed"
                  )}>
                    {children}
                  </li>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="my-4 p-4 border-l-4 border-primary bg-muted/30 rounded-r-lg shadow-sm">
                    <div className="italic">
                      {children}
                    </div>
                  </blockquote>
                ),
                code: ({ children, className, ...props }) => {
                  const isInline = !className?.includes('language-');
                  return (
                    <code 
                      className={cn(
                        "rounded font-mono",
                        isInline && "px-1.5 py-0.5 bg-muted text-sm",
                        !isInline && "block"
                      )}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="my-4 p-4 bg-muted rounded-lg overflow-x-auto shadow-sm border border-border">
                    {children}
                  </pre>
                ),
                table: ({ children }) => (
                  <div className="my-4 overflow-x-auto">
                    <table className="w-full border-collapse border border-border rounded-lg overflow-hidden shadow-sm">
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="p-3 bg-muted/50 border border-border text-left font-medium">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="p-3 border border-border">
                    {children}
                  </td>
                ),
                a: ({ href, children }) => (
                  <a 
                    href={href} 
                    className="text-primary hover:text-primary/80 underline transition-colors hover:bg-primary/5 px-1 -mx-1 rounded"
                    target="_blank"
                    rel="noopener noreferrer"
                    title={href}
                  >
                    {children}
                    <span className="ml-1 text-xs opacity-60">↗</span>
                  </a>
                ),
                img: ({ src, alt }) => (
                  <div className="my-4 text-center">
                    <img 
                      src={src} 
                      alt={alt || 'Image'} 
                      className="rounded-lg max-w-full h-auto shadow-md hover:shadow-lg transition-shadow"
                      loading="lazy"
                    />
                    {alt && (
                      <div className="text-sm text-muted-foreground mt-2 italic">
                        {alt}
                      </div>
                    )}
                  </div>
                ),
                hr: () => (
                  <hr className="my-8 border-border" />
                ),
                // Enhanced task lists
                input: ({ type, checked, ...props }) => {
                  if (type === 'checkbox') {
                    return (
                      <input 
                        type="checkbox" 
                        checked={checked}
                        className="mr-2 rounded"
                        {...props}
                        disabled
                      />
                    );
                  }
                  return <input type={type} {...props} />;
                },
              }}
            >
              {content}
            </ReactMarkdown>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <div className="text-4xl mb-4">📝</div>
                <div className="text-lg font-medium mb-2">Markdown 预览</div>
                <div className="text-sm">开始编写 Markdown 内容，实时预览效果</div>
                <div className="mt-4 text-xs text-muted-foreground">
                  <div>支持 GitHub Flavored Markdown</div>
                  <div>数学公式、代码高亮、表格等</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
