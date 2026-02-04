import React, { useEffect, useRef, useState } from 'react';
import { Send, Terminal, Loader2, FileText, Wrench, ChevronDown, ChevronUp, Plus, XCircle, History } from 'lucide-react';
import { cn } from '../lib/utils';
import { Message, useAppStore } from '../lib/store';
import { Button } from './ui/button';

// Define token types
interface Token {
  type: 'text' | 'file' | 'online' | 'context' | 'knowledge' | 'dify_tool';
  content: string;
  metadata?: any;
}

interface Tool {
  name: string;
  description: string;
  custom_name?: string;
  initial_name_zh?: string;
  is_custom?: boolean;
}

interface ChatPanelProps {
  className?: string;
  messages: Message[];
  onSendMessage: (message: string, isStreaming: boolean) => void;
  isStreaming?: boolean;
  availableTools?: Tool[];
  selectedTools?: string[];
  onToolsChange?: (tools: string[]) => void;
  onCreateSession?: () => void;
  onKillSession?: () => void;
  sessions?: any[];
  onSelectSession?: (sessionId: string) => void;
}

// Custom Rich Input Component
const RichInput = ({ 
  onEnter, 
  isStreaming, 
  externalInput, 
  onClearExternalInput 
}: { 
  onEnter: (content: string) => void, 
  isStreaming: boolean,
  externalInput: string,
  onClearExternalInput: () => void
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const lastRangeRef = useRef<Range | null>(null);

  const saveSelection = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
          lastRangeRef.current = sel.getRangeAt(0).cloneRange();
      }
  };

  // Insert a capsule node at the current selection or at the end
  const insertCapsule = (token: Token) => {
    const editor = editorRef.current;
    if (!editor) return;

    const span = document.createElement('span');
    span.contentEditable = 'false';
    span.className = "inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default";
    span.dataset.type = token.type;
    span.dataset.content = token.content;
    if (token.metadata) {
      span.dataset.metadata = JSON.stringify(token.metadata);
    }

    // Icon
    const icon = document.createElement('span'); // Use span for icon placeholder to avoid complex SVG DOM manipulation issues in contentEditable
    icon.className = "w-3 h-3 inline-block mr-1";
    if (token.type === 'file' || token.type === 'context') {
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>';
        if (token.type === 'context') icon.querySelector('svg')?.classList.add('text-blue-500');
    } else if (token.type === 'knowledge') {
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-database"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>';
    } else if (token.type === 'dify_tool') {
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-workflow"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></svg>';
    } else {
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-globe"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
    }
    span.appendChild(icon);

    // Text
    const text = document.createElement('span');
    text.className = "max-w-[200px] truncate inline-block align-middle";
    
    if (token.type === 'context' && token.metadata) {
       const path = token.metadata.path || 'Context';
       const range = token.metadata.start ? `:${token.metadata.start}-${token.metadata.end}` : '';
       text.textContent = `${path.split('/').pop()}${range}`;
    } else {
       text.textContent = token.content.split('/').pop() || token.content;
    }
    span.appendChild(text);

    // Remove Button (X) - Optional, but browser backspace works too. 
    // Let's rely on backspace for simplicity in contentEditable, 
    // but adding a visual X can be helpful.
    
    // Insert
    editor.focus();
    const selection = window.getSelection();
    let range: Range | null = null;

    if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0);
    } else if (lastRangeRef.current && editor.contains(lastRangeRef.current.commonAncestorContainer)) {
      range = lastRangeRef.current;
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    // Wrapper logic
     const typeMap: Record<string, string> = {
         'context': 'context',
         'file': 'file',
         'knowledge': 'knowledge',
         'online': 'online',
         'dify_tool': 'dify_tool'
     };
     
     const typeDesc: Record<string, string> = {
         'context': '这是用户引用的文档片段',
         'file': '这是用户引用的文件路径',
         'knowledge': '这是用户挂载的知识库配置，请根据用户的需求进行知识召回',
         'online': '这是用户引用的在线资源',
         'dify_tool': '这是用户选择的Dify工具，请务必用到这个工具'
     };

     const capsuleType = typeMap[token.type] || '未知';
      const capsuleDesc = typeDesc[token.type] || '未知类型胶囊';
      
      let innerContent = '';
      if (token.type === 'context' && token.metadata) {
           innerContent = `<paragraph_capsule>\n  <paragraph path="${token.metadata.path || 'unknown'}">\n    <command>${token.metadata.command || 'str_replace'}</command>\n    <content>${(token.content.match(/<content>([\s\S]*?)<\/content>/)?.[1] || token.content).trim()}</content>\n  </paragraph>\n</paragraph_capsule>`;
      } else if (token.type === 'file') {
           innerContent = `<file_capsule>\n  <file path="${token.content}" />\n</file_capsule>`;
      } else if (token.type === 'knowledge' && token.metadata) {
           // Enhanced Knowledge Capsule
           innerContent = `<knowledge_capsule>\n  <knowledge_base name="${token.content}" config='${JSON.stringify(token.metadata)}' />\n</knowledge_capsule>`;
      } else if (token.type === 'dify_tool' && token.metadata) {
           innerContent = `<dify_tool_capsule>\n  <tool name="${token.metadata.tool?.name || token.content}" id="${token.metadata.tool?.id}" />\n</dify_tool_capsule>`;
      } else {
           innerContent = token.content;
      }
      
      // Add description to the fence info string
      // We store the FULL wrapped string in dataset.content so handleSubmit picks it up as is.
      // But we do NOT insert the text nodes into the DOM, so the user only sees the capsule.
      const wrappedContent = ` \`\`\`{type=${capsuleType}, description=${capsuleDesc}}${innerContent}\`\`\` `;
      span.dataset.content = wrappedContent;
      
      // const wrapperStart = document.createTextNode(` \`\`\`{type=${capsuleType}, description=${capsuleDesc}}`);
      // const wrapperEnd = document.createTextNode('``` ');
      
      const frag = document.createDocumentFragment();
      // frag.appendChild(wrapperStart); // Hidden from view
      frag.appendChild(span);
      // frag.appendChild(wrapperEnd); // Hidden from view

      if (range) {
      range.deleteContents();
      range.insertNode(frag);
      
      // Add a space after
      // const space = document.createTextNode('\u00A0'); // Unused variable removed
      
      // Move cursor after span
      range.setStartAfter(span);
      range.setEndAfter(span);
      selection?.removeAllRanges();
      selection?.addRange(range);
      saveSelection(); // Update saved selection
    } else {
      // Append to end if no cursor
      editor.appendChild(frag);
      editor.appendChild(document.createTextNode('\u00A0'));
      
      // Scroll to bottom to show new content
      editor.scrollTop = editor.scrollHeight;
    }
    checkEmpty();
  };

  useEffect(() => {
      const handler = (e: any) => {
          insertCapsule(e.detail);
      };
      window.addEventListener('insert-capsule', handler);
      return () => window.removeEventListener('insert-capsule', handler);
  }, []);

  const parseAndInsert = (text: string) => {
     // Regex to find tokens
     // Added support for capsule fence blocks: ```{type=...}...```
     const regex = /(<context_injection>[\s\S]*?<\/context_injection>)|( ```\{type=[^}]+\}[\s\S]*?``` )|(\[workspace:([^\]]+)\])|(\[online:([^\]]+)\])|(\[knowledge_config:({[^\]]+})\])|(\[dify_tool:({[^\]]+})\])/g;
     let lastIndex = 0;
     let match;

     while ((match = regex.exec(text)) !== null) {
        // Insert preceding text
        if (match.index > lastIndex) {
           const sub = text.substring(lastIndex, match.index);
           insertText(sub);
        }

        const fullMatch = match[0];
        if (fullMatch.startsWith('<context_injection>')) {
            // Parse XML
            const idMatch = fullMatch.match(/id="([^"]+)"/);
            const pathMatch = fullMatch.match(/path="([^"]+)"/);
            const startMatch = fullMatch.match(/<start>(\d+)<\/start>/);
            const endMatch = fullMatch.match(/<end>(\d+)<\/end>/);
            
            insertCapsule({
                type: 'context',
                content: fullMatch, // Keep full XML as content
                metadata: {
                    id: idMatch ? idMatch[1] : 'unknown',
                    path: pathMatch ? pathMatch[1] : 'unknown',
                    start: startMatch ? startMatch[1] : '',
                    end: endMatch ? endMatch[1] : ''
                }
            });
        } else if (fullMatch.startsWith(' ```{type=')) {
             // Capsule Fence Block
             try {
                 const headerEndIdx = fullMatch.indexOf('}');
                 const header = fullMatch.substring(4, headerEndIdx + 1); 
                 
                 const typeMatch = header.match(/type=([^,}]+)/);
                 const typeRaw = typeMatch ? typeMatch[1].trim() : 'unknown';
                 
                 // Map typeRaw to internal token type
                 let tokenType: Token['type'] = 'text';
                 if (typeRaw === 'context' || typeRaw === '段落') tokenType = 'context';
                 else if (typeRaw === 'file' || typeRaw === '文件') tokenType = 'file';
                 else if (typeRaw === 'knowledge' || typeRaw === '知识库') tokenType = 'knowledge';
                 else if (typeRaw === 'dify_tool' || typeRaw === 'Dify工具') tokenType = 'dify_tool';
                 else if (typeRaw === 'online' || typeRaw === '在线资源') tokenType = 'online';

                 const contentStart = headerEndIdx + 1;
                 const contentEnd = fullMatch.lastIndexOf('```');
                 const innerContent = fullMatch.substring(contentStart, contentEnd);

                 let metadata: any = {};
                 let content = innerContent; // Default content

                 if (tokenType === 'context') {
                     const xmlMatch = innerContent.match(/<paragraph_capsule>([\s\S]*?)<\/paragraph_capsule>/);
                     if (xmlMatch) {
                         const xml = xmlMatch[1];
                         const id = xml.match(/id="([^"]+)"/)?.[1] || 'unknown';
                         const path = xml.match(/path="([^"]+)"/)?.[1] || 'unknown';
                         const start = xml.match(/<start>(\d+)<\/start>/)?.[1] || '';
                         const end = xml.match(/<end>(\d+)<\/end>/)?.[1] || '';
                         // const innerText = xml.match(/<content>([\s\S]*?)<\/content>/)?.[1] || '';
                         
                         metadata = { id, path, start, end };
                         content = fullMatch; // Keep the full fence block as content for transmission
                     }
                 } else if (tokenType === 'file') {
                      const pathMatch = innerContent.match(/path="([^"]+)"/);
                      if (pathMatch) content = pathMatch[1];
                      else content = innerContent.trim();
                 } else if (tokenType === 'knowledge') {
                      const nameMatch = innerContent.match(/name="([^"]+)"/);
                      const configMatch = innerContent.match(/config='([^']+)'/);
                      content = nameMatch ? nameMatch[1] : 'Knowledge Base';
                      if (configMatch) {
                          try { metadata = JSON.parse(configMatch[1]); } catch {}
                      }
                 } else if (tokenType === 'dify_tool') {
                      const nameMatch = innerContent.match(/name="([^"]+)"/);
                      const idMatch = innerContent.match(/id="([^"]+)"/);
                      content = nameMatch ? nameMatch[1] : 'Dify Tool';
                      if (idMatch) metadata = { tool: { name: content, id: idMatch[1] } };
                 }

                 insertCapsule({
                     type: tokenType,
                     content: content,
                     metadata: Object.keys(metadata).length > 0 ? metadata : undefined
                 });

             } catch (e) {
                 insertText(fullMatch);
             }
        } else if (fullMatch.startsWith('[workspace:')) {
            const path = match[3];
            insertCapsule({ type: 'file', content: path });
        } else if (fullMatch.startsWith('[online:')) {
            const id = match[5];
            insertCapsule({ type: 'online', content: id });
        } else if (fullMatch.startsWith('[knowledge_config:')) {
             try {
                 const jsonStr = fullMatch.slice(18, -1); // Remove [knowledge_config: and ]
                 const config = JSON.parse(jsonStr);
                 insertCapsule({ type: 'knowledge', content: config.name, metadata: config });
             } catch { /* ignore */ }
        } else if (fullMatch.startsWith('[dify_tool:')) {
             try {
                 const jsonStr = fullMatch.slice(11, -1); // Remove [dify_tool: and ]
                 const config = JSON.parse(jsonStr);
                 insertCapsule({ type: 'dify_tool', content: config.tool?.name || 'Dify Tool', metadata: config });
             } catch { /* ignore */ }
        }

        lastIndex = match.index + fullMatch.length;
     }

     // Remaining text
     if (lastIndex < text.length) {
        insertText(text.substring(lastIndex));
     }
  };

  const insertText = (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      
      // Simple text append if no selection or lost focus, otherwise insert at cursor
      editor.focus();
      const selection = window.getSelection();
      let range: Range | null = null;

      if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
          range = selection.getRangeAt(0);
      } else if (lastRangeRef.current && editor.contains(lastRangeRef.current.commonAncestorContainer)) {
          range = lastRangeRef.current;
      }

      if (range) {
          range.deleteContents();
          // Unused variable removed
          // const textNode = document.createTextNode(text);
          // range.insertNode(textNode);
          // range.setStartAfter(textNode);
          // range.setEndAfter(textNode);
          // selection?.removeAllRanges();
          // selection?.addRange(range);
          // saveSelection();
          
          // User request: "段落引用到会话输入中，应该默认追加到当前的最后，而不是开头"
          // The original logic inserted at cursor. But for parseAndInsert (which handles injections),
          // we might want to append. 
          // However, insertText is generic. 
          // If we want to FORCE append for injections, we should change parseAndInsert logic to NOT use insertText at cursor.
          // But wait, parseAndInsert calls insertText for text parts and insertCapsule for tokens.
          // If we want to append, we should just append to editor.
          
          // Let's modify insertText behavior or how it's called.
          // Actually, if text is passed via externalInput (store), it usually comes from "Add to Chat".
          // The user wants this to be appended.
          // Currently insertText tries to use range (cursor).
          // If we clear range before calling parseAndInsert in the useEffect, it might work.
          // But insertText explicitly checks lastRangeRef.
          
          // Let's just append if it comes from external input?
          // No, insertText is used for mixed content.
          
          // Let's stick to cursor insertion if user is typing, but for external input, maybe we should clear selection?
          // The user said "default append to current end".
          // So let's change the behavior: if we have a range, we collapse it to end? No, that's annoying while typing.
          
          // The request specifically mentions "Paragraph reference... should be appended".
          // This usually comes via `parseAndInsert`.
          // Let's modify `parseAndInsert` to always append if the editor is not empty?
          // Or better, let's make `insertText` and `insertCapsule` support an `append` flag.
          
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          selection?.removeAllRanges();
          selection?.addRange(range);
          saveSelection();
      } else {
          editor.appendChild(document.createTextNode(text));
          editor.scrollTop = editor.scrollHeight;
      }
      checkEmpty();
  };

  // Handle external input (from store)
  useEffect(() => {
      if (externalInput) {
          // User request: Append to end instead of inserting at cursor for external input
          // Clear saved range to force append
          lastRangeRef.current = null;
          const sel = window.getSelection();
          sel?.removeAllRanges();
          
          // If editor is not empty, add a newline before appending
          if (editorRef.current && editorRef.current.textContent && editorRef.current.textContent.length > 0) {
               insertText('\n');
          }

          parseAndInsert(externalInput);
          onClearExternalInput();
      }
  }, [externalInput]);

  const checkEmpty = () => {
      if (editorRef.current) {
          const text = editorRef.current.textContent;
          setIsEmpty(!text || text.trim().length === 0);
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
          if (e.shiftKey) {
              e.preventDefault();
              handleSubmit();
          } else {
              // Allow default Enter behavior (newline)
              // No preventDefault()
          }
      }
      // Update empty state on key up/down
      setTimeout(checkEmpty, 0);
  };

  const handleSubmit = () => {
      if (!editorRef.current || isStreaming) return;
      
      // Serialize content
      let result = '';
      editorRef.current.childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
              result += node.textContent;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as HTMLElement;
              if (el.dataset.type) {
              if (el.dataset.type === 'file') {
                  if (el.dataset.content?.trim().startsWith('<')) {
                       result += `\n${el.dataset.content}\n`;
                  } else {
                       result += ` [workspace:${el.dataset.content}] `;
                  }
              } else if (el.dataset.type === 'online') {
                  result += ` [online:${el.dataset.content}] `;
              } else if (el.dataset.type === 'context') {
                  result += `\n${el.dataset.content}\n`;
              } else if (el.dataset.type === 'knowledge') {
                  if (el.dataset.content?.trim().startsWith('<')) {
                       result += `\n${el.dataset.content}\n`;
                  } else if (el.dataset.metadata) {
                      result += ` [knowledge_config:${el.dataset.metadata}] `;
                  }
              } else if (el.dataset.type === 'dify_tool') {
                  if (el.dataset.content?.trim().startsWith('<')) {
                       result += `\n${el.dataset.content}\n`;
                  } else if (el.dataset.metadata) {
                      // Fallback if not using capsule XML
                      result += ` [dify_tool:${el.dataset.metadata}] `;
                  }
              }
          } else {
              result += el.textContent;
          }
          }
      });
      
      if (!result.trim()) return;
      
      onEnter(result);
      editorRef.current.innerHTML = '';
      checkEmpty();
  };
  
  // Handle Drop on Editor
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const raw = e.dataTransfer.getData('text/plain');
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data && (data.type === 'workspace' || data.type === 'online' || data.type === 'knowledge_base' || data.type === 'dify_tool')) {
          if (data.type === 'workspace') {
             insertCapsule({ type: 'file', content: data.path });
          } else if (data.type === 'online') {
             insertCapsule({ type: 'online', content: data.documentId });
          } else if (data.type === 'knowledge_base') {
             insertCapsule({ type: 'knowledge', content: data.config.name, metadata: data.config });
          } else if (data.type === 'dify_tool') {
             insertCapsule({ type: 'dify_tool', content: data.tool.name, metadata: data });
          }
        }
      } catch (e) {
        // Not JSON, treat as plain text drop
        // Handle paragraph/text drag from other parts of the app?
        // The user requested: "support dragging selected text/paragraphs into div, maintaining semantic position"
        // If it's not JSON, insert as text
        insertText(raw);
      }
    }
  };

  // Handle Paste Event for Capsule Recovery
  const handlePaste = (e: React.ClipboardEvent) => {
      const clipboardData = e.clipboardData;
      const pastedText = clipboardData.getData('text');
      
      // Check for capsule fence format: ```{type=..., description=...}...```
      if (pastedText.trim().startsWith('```{type=') && pastedText.trim().endsWith('```')) {
          e.preventDefault();
          // Use parseAndInsert to handle the capsule string
          parseAndInsert(pastedText);
      }
  };

  return (
      <div className="relative w-full min-h-[80px] rounded-md border bg-background focus-within:ring-2 focus-within:ring-primary/50 transition-all">
          <div 
              ref={editorRef}
              contentEditable={!isStreaming}
              onKeyDown={(e) => { handleKeyDown(e); saveSelection(); }}
              onKeyUp={saveSelection}
              onMouseUp={saveSelection}
              onBlur={saveSelection}
              onInput={() => { checkEmpty(); saveSelection(); }}
              onDrop={handleDrop}
              onPaste={handlePaste}
              className="w-full h-full min-h-[80px] p-3 pr-10 text-sm font-mono outline-none whitespace-pre-wrap break-words overflow-y-auto max-h-[300px]"
              suppressContentEditableWarning
          />
          {isEmpty && (
              <div className="absolute top-3 left-3 text-muted-foreground text-sm pointer-events-none select-none">
                  输入指令或描述需求... (支持拖拽文件)
              </div>
          )}
          <Button 
            size="icon" 
            onClick={handleSubmit}
            disabled={isEmpty || isStreaming}
            className="absolute bottom-2 right-2 h-8 w-8 z-10"
          >
            <Send className="w-4 h-4" />
          </Button>
      </div>
  );
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  className,
  messages,
  onSendMessage,
  isStreaming = false,
  availableTools = [],
  selectedTools = [],
  onToolsChange,
  onCreateSession,
  onKillSession,
  sessions,
  onSelectSession
}) => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { 
    chatInput, 
    setChatInput, 
    clearInputAttachments,
    enabledTools
  } = useAppStore();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isToolSelectorOpen, setIsToolSelectorOpen] = useState(false);

  // Clear legacy attachments if any
  useEffect(() => {
      clearInputAttachments();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = (msg: string) => {
      onSendMessage(msg, true);
  };

  // Helper component for Context Injection
  const ContextInjectionCard = ({ xml }: { xml: string }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    
    // Simple parsing of the XML
    // Note: This relies on the specific format generated by CodeEditor.tsx
    const pathMatch = xml.match(/path="([^"]+)"/);
    const startMatch = xml.match(/<start>(\d+)<\/start>/);
    const endMatch = xml.match(/<end>(\d+)<\/end>/);
    const contentMatch = xml.match(/<content>([\s\S]*?)<\/content>/);

    const path = pathMatch ? pathMatch[1] : 'unknown';
    const start = startMatch ? startMatch[1] : '?';
    const end = endMatch ? endMatch[1] : '?';
    const content = contentMatch ? contentMatch[1] : '';
    const filename = path.split('/').pop() || path;

    return (
        <span 
            className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default"
            onClick={() => setIsExpanded(!isExpanded)}
        >
            <span className="w-3 h-3 inline-block mr-1">
                <FileText className="w-full h-full text-blue-500" />
            </span>
            <span className="max-w-[200px] truncate inline-block align-middle">
                {filename}:{start}-{end}
            </span>
            {isExpanded && (
                <div className="absolute z-50 mt-6 p-2 bg-popover border rounded-md shadow-md max-w-md whitespace-pre-wrap text-xs">
                    {content}
                </div>
            )}
        </span>
    );
  };

  // Helper to parse and render message content with special UI for artifacts
  const renderMessageContent = (content: string) => {
    // Fix emoji rendering issue (replace [italic] and [/italic] with robot emoji)
    const processedContent = content.replace(/\[\/?italic\]/g, '🤖');
    
    let parts: React.ReactNode[] = [];

    // Let's iterate through the content and find matches
    let match;
    // Matches JSON format (legacy), new Token format, Context Injection XML, and Capsule Fence Blocks
    // Added support for [dify_tool:...] pattern
    const combinedRegex = /(<context_injection>[\s\S]*?<\/context_injection>)|( ```\{type=[^}]+\}[\s\S]*?``` )|({"type":"workspace"[^}]+})|({"type":"online"[^}]+})|(\[workspace:([^\]]+)\])|(\[online:([^ \]]+)\])|(\[knowledge_config:({[^\]]+})\])|(\[dify_tool:({[^\]]+})\])/g;
    
    let currentIdx = 0;
    while ((match = combinedRegex.exec(processedContent)) !== null) {
        // Text before match
        if (match.index > currentIdx) {
            parts.push(<span key={`text-${currentIdx}`}>{processedContent.substring(currentIdx, match.index)}</span>);
        }
        
        const fullMatch = match[0];
        
        if (fullMatch.startsWith(' ```{type=')) {
             // Capsule Fence Block
             try {
                 // Extract type and description from header: ```{type=..., description=...}
                 const headerEndIdx = fullMatch.indexOf('}');
                 const header = fullMatch.substring(4, headerEndIdx + 1); // {type=..., description=...}
                 
                 // Parse header pseudo-json/kv
                 const typeMatch = header.match(/type=([^,}]+)/);
                 const type = typeMatch ? typeMatch[1].trim() : 'unknown';
                 
                 // Extract inner content
                 const contentStart = headerEndIdx + 1;
                 const contentEnd = fullMatch.lastIndexOf('```');
                 const innerContent = fullMatch.substring(contentStart, contentEnd);
                 
                 // Render based on type
                 if (type === 'context' || type === '段落') {
                     // Extract XML from innerContent if present
                     const xmlMatch = innerContent.match(/<paragraph_capsule>([\s\S]*?)<\/paragraph_capsule>/);
                     if (xmlMatch) {
                          const xml = xmlMatch[1];
                          // Unused variables removed to fix build error TS6133
                          // const id = xml.match(/id="([^"]+)"/)?.[1] || 'unknown';
                          const path = xml.match(/path="([^"]+)"/)?.[1] || 'unknown';
                          const start = xml.match(/<start>(\d+)<\/start>/)?.[1] || '?';
                          const end = xml.match(/<end>(\d+)<\/end>/)?.[1] || '?';
                          // const content = xml.match(/<content>([\s\S]*?)<\/content>/)?.[1] || '';
                          
                          parts.push(
                             <span key={`cap-${match.index}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default">
                                 <span className="w-3 h-3 inline-block mr-1">
                                     <FileText className="w-full h-full text-blue-500" />
                                 </span>
                                 <span className="max-w-[200px] truncate inline-block align-middle">
                                     {path.split('/').pop()}:{start}-{end}
                                 </span>
                             </span>
                         );
                     } else {
                         parts.push(<span key={`raw-${match.index}`}>{fullMatch}</span>);
                     }
                 } else if (type === 'file' || type === '文件') {
                      const pathMatch = innerContent.match(/path="([^"]+)"/);
                      const path = pathMatch ? pathMatch[1] : innerContent.trim();
                      parts.push(
                         <span key={`cap-${match.index}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default">
                             <span className="w-3 h-3 inline-block mr-1">
                                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
                             </span>
                             <span className="truncate max-w-[200px]" title={path}>{path.split('/').pop()}</span>
                         </span>
                      );
                 } else if (type === 'knowledge' || type === '知识库') {
                      const nameMatch = innerContent.match(/name="([^"]+)"/);
                      const name = nameMatch ? nameMatch[1] : 'Knowledge Base';
                      parts.push(
                         <span key={`cap-${match.index}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default">
                             <span className="w-3 h-3 inline-block mr-1">
                                 <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-database"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                             </span>
                             <span className="truncate max-w-[200px]">{name}</span>
                         </span>
                      );
                 } else if (type === 'dify_tool' || type === 'Dify工具') {
                      const nameMatch = innerContent.match(/name="([^"]+)"/);
                      const name = nameMatch ? nameMatch[1] : 'Dify Tool';
                      parts.push(
                         <span key={`cap-${match.index}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default">
                             <span className="w-3 h-3 inline-block mr-1">
                                 <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-workflow"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></svg>
                             </span>
                             <span className="truncate max-w-[200px]">{name}</span>
                         </span>
                      );
                 } else {
                      parts.push(<span key={`raw-${match.index}`}>{fullMatch}</span>);
                 }
             } catch (e) {
                 parts.push(<span key={`raw-${match.index}`}>{fullMatch}</span>);
             }
        } else if (fullMatch.startsWith('<context_injection>')) {
            // Context Injection XML
            parts.push(<ContextInjectionCard key={`ctx-${match.index}`} xml={fullMatch} />);
        } else if (fullMatch.startsWith('{')) {
            // JSON Format (Legacy)
            try {
                const data = JSON.parse(fullMatch);
                if (data.type === 'workspace') {
                    const filename = data.path.split('/').pop() || data.path;
                    parts.push(
                        <span key={`file-${match.index}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default">
                            <span className="w-3 h-3 inline-block mr-1">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
                            </span>
                            <span className="truncate max-w-[200px]" title={data.path}>{filename}</span>
                        </span>
                    );
                } else if (data.type === 'online') {
                    parts.push(
                        <span key={`online-${match.index}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default">
                            <span className="w-3 h-3 inline-block mr-1">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                            </span>
                            <span className="truncate max-w-[200px]" title={data.title}>{data.title}</span>
                        </span>
                    );
                } else {
                    parts.push(<span key={`raw-${match.index}`}>{fullMatch}</span>);
                }
            } catch (e) {
                parts.push(<span key={`raw-${match.index}`}>{fullMatch}</span>);
            }
        } else {
            // Token Format
            if (fullMatch.startsWith('[workspace:')) {
                const path = match[5]; // Group 5 captures content inside [workspace:...]
                const filename = path.split('/').pop() || path;
                parts.push(
                    <span key={`token-file-${match.index}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default">
                        <span className="w-3 h-3 inline-block mr-1">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
                        </span>
                        <span className="truncate max-w-[200px]" title={path}>{filename}</span>
                    </span>
                );
            } else if (fullMatch.startsWith('[online:')) {
                const id = match[7]; // Group 7 captures content inside [online:...]
                parts.push(
                    <span key={`token-online-${match.index}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default">
                        <span className="w-3 h-3 inline-block mr-1">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                        </span>
                        <span className="truncate max-w-[200px]">{id}</span>
                    </span>
                );
            } else if (fullMatch.startsWith('[knowledge_config:')) {
                let name = 'Knowledge Base';
                try {
                    const jsonStr = fullMatch.slice(18, -1);
                    const config = JSON.parse(jsonStr);
                    if (config.name) name = config.name;
                } catch { /* ignore */ }
                
                parts.push(
                    <span key={`token-kb-${match.index}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default">
                        <span className="w-3 h-3 inline-block mr-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-database"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                        </span>
                        <span className="truncate max-w-[200px]">{name}</span>
                    </span>
                );
            } else if (fullMatch.startsWith('[dify_tool:')) {
                let name = 'Dify Tool';
                try {
                    const jsonStr = fullMatch.slice(11, -1); // Remove [dify_tool: and ]
                    const metadata = JSON.parse(jsonStr);
                    // metadata structure: {type: "dify_tool", tool: {name: "...", ...}}
                    if (metadata.tool && metadata.tool.name) name = metadata.tool.name;
                } catch { /* ignore */ }
                
                parts.push(
                    <span key={`token-dify-${match.index}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-accent/50 border border-accent text-accent-foreground text-xs align-middle select-none cursor-default">
                        <span className="w-3 h-3 inline-block mr-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-workflow"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></svg>
                        </span>
                        <span className="truncate max-w-[200px]">{name}</span>
                    </span>
                );
            }
        }
        
        currentIdx = match.index + fullMatch.length;
    }
    
    // Remaining text
    if (currentIdx < processedContent.length) {
        parts.push(<span key={`text-${currentIdx}`}>{processedContent.substring(currentIdx)}</span>);
    }
    
    if (parts.length === 0) return processedContent;
    return <>{parts}</>;
  };

  return (
    <div className={cn("flex flex-col h-full bg-background border-l", className)}>
      {/* Header */}
      <div className="px-4 h-9 border-b flex items-center justify-between font-medium text-xs bg-muted/20 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5" />
          交互终端
        </div>
        <div className="flex items-center gap-1">
          {sessions && (
             <div className="relative">
                <button 
                  onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                  className="p-1 hover:bg-background rounded text-muted-foreground hover:text-foreground transition-colors"
                  title="历史记录"
                >
                  <History className="w-3.5 h-3.5" />
                </button>
                {isHistoryOpen && (
                  <div className="absolute top-full right-0 mt-1 w-64 bg-popover border rounded-md shadow-lg max-h-96 overflow-y-auto z-50">
                      <div className="p-2 text-xs font-semibold border-b sticky top-0 bg-popover">历史会话</div>
                      {sessions.map(s => (
                          <div 
                              key={s.id} 
                              className="p-2 hover:bg-accent cursor-pointer text-xs border-b last:border-0"
                              onClick={() => {
                                  onSelectSession?.(s.id);
                                  setIsHistoryOpen(false);
                              }}
                          >
                              <div className="font-medium truncate">{s.name || s.id}</div>
                              <div className="text-muted-foreground text-[10px] mt-1">{new Date(s.updatedAt).toLocaleString()}</div>
                          </div>
                      ))}
                  </div>
                )}
             </div>
          )}
          {onCreateSession && (
            <button 
              onClick={onCreateSession}
              className="p-1 hover:bg-background rounded text-muted-foreground hover:text-foreground transition-colors"
              title="创建新会话"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
          {onKillSession && (
            <button 
              onClick={onKillSession}
              className="p-1 hover:bg-destructive/10 hover:text-destructive rounded text-muted-foreground transition-colors"
              title="终止当前会话"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-10">
            暂无消息，输入指令开始交互
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "p-3 rounded-lg text-sm whitespace-pre-wrap break-words",
              msg.type === 'user' ? "bg-primary/10 border border-primary/20" : 
              msg.type === 'error' ? "bg-destructive/10 text-destructive border border-destructive/20" :
              msg.type === 'bubble' ? "bg-blue-50/50 border border-blue-100 dark:bg-blue-900/20 dark:border-blue-900/50" :
              "bg-muted/50 border dark:bg-zinc-900 dark:border-zinc-800"
            )}
          >
             {/* Optional: Display role label */}
             <div className="text-xs font-semibold mb-1 opacity-70">
               {msg.type === 'user' ? 'User' : msg.type === 'agent' ? 'Agent' : msg.type === 'system' ? 'System' : msg.type === 'bubble' ? 'Thought' : 'Error'}
             </div>
             {/* Content with Artifact Rendering */}
             <div className="leading-relaxed">
                {msg.type === 'bubble' && <span className="mr-1">💭</span>}
                {renderMessageContent(msg.content)}
             </div>
          </div>
        ))}
        {isStreaming && (
           <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
             <Loader2 className="w-3 h-3 animate-spin" />
             Agent is thinking...
           </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t bg-muted/10 transition-colors">
        <RichInput 
          onEnter={handleSendMessage}
          isStreaming={isStreaming}
          externalInput={chatInput}
          onClearExternalInput={() => setChatInput('')}
        />
        
        {/* Tool Selector */}
        <div className="mt-2 relative">
            <div 
                className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none w-fit"
                onClick={() => setIsToolSelectorOpen(!isToolSelectorOpen)}
            >
                <Wrench className="w-3 h-3" />
                <span>可用工具 ({selectedTools.length})</span>
                {isToolSelectorOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </div>
            
            {isToolSelectorOpen && (
                <div className="absolute bottom-full left-0 mb-2 p-2 bg-popover text-popover-foreground border rounded-md shadow-lg flex flex-col gap-2 w-56 z-50 max-h-[300px] overflow-y-auto">
                    <div className="flex items-center justify-between border-b pb-1 mb-1">
                        <span className="text-xs font-semibold">选择本轮工具</span>
                    </div>

                    {availableTools.filter(t => enabledTools.includes(t.name)).map(tool => (
                        <div key={tool.name} className="flex items-center gap-2 hover:bg-accent/50 p-1 rounded">
                            <input
                                type="checkbox"
                                id={`select-tool-${tool.name}`}
                                checked={selectedTools.includes(tool.name)}
                                onChange={(e) => {
                                    if (onToolsChange) {
                                        if (e.target.checked) {
                                            onToolsChange([...selectedTools, tool.name]);
                                        } else {
                                            onToolsChange(selectedTools.filter(t => t !== tool.name));
                                        }
                                    }
                                }}
                                className="h-3 w-3 rounded border-primary text-primary focus:ring-primary accent-primary"
                            />
                            <label htmlFor={`select-tool-${tool.name}`} className="text-xs cursor-pointer select-none flex-1 truncate" title={tool.description || tool.name}>
                                {tool.custom_name || tool.initial_name_zh || tool.name}
                            </label>
                        </div>
                    ))}
                    
                    {availableTools.filter(t => enabledTools.includes(t.name)).length === 0 && (
                        <div className="text-xs text-muted-foreground text-center py-2">
                            无启用工具，请点击"管理"添加
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
      
    </div>
  );
};
