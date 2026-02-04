import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export interface Message {
  id: string;
  type: 'user' | 'agent' | 'system' | 'error' | 'bubble';
  content: string;
  timestamp: Date;
  sessionId?: string;
  stepId?: string;
  bubbleId?: string;
  metadata?: any;
  attachments?: string[];
  sse_step?: any;
}

export interface Session {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  workingDir: string;
  configFile: string;
  status: 'active' | 'completed' | 'error';
  messages: Message[];
  systemPrompt: 'TRAE_AGENT_SYSTEM_PROMPT' | 'DOCUMENT_AGENT_SYSTEM_PROMPT';
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  children?: FileNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

export interface EditorFile {
  path: string;
  content: string;
  originalContent?: string; // For Diff View
  isDirty: boolean;
  language: string;
}

export interface DiffItem {
  id: string;
  start: number;
  end: number;
  original_content: string;
  new_content: string;
  metadata?: {
      command?: 'replace' | 'insert' | 'delete';
      paragraph_id?: string;
      [key: string]: any;
  };
}

export interface Attachment {
  type: 'file' | 'context';
  content: string; // For file: path; For context: xml content
  metadata?: any;
}

export interface ParagraphContext {
  id: string;
  path: string;
  start: number;
  end: number;
  content: string;
}

interface AppState {
  // Sessions
  sessions: Session[];
  currentSessionId: string | null;
  systemPrompt: 'TRAE_AGENT_SYSTEM_PROMPT' | 'DOCUMENT_AGENT_SYSTEM_PROMPT';
  
  // Files
  workspaceRoot: string;
  fileTree: FileNode[];
  openFiles: EditorFile[];
  activeFilePath: string | null;
  
  // Interaction
  pendingDiffs: Record<string, DiffItem[]>;
  chatInput: string;
  inputAttachments: Attachment[];

  // UI State
  isLoading: boolean;
  error: string | null;
  sidebarCollapsed: boolean;
  chatPanelCollapsed: boolean;
  theme: 'light' | 'dark';
  isFullscreen: boolean;
  enabledTools: string[];
  setEnabledTools: (tools: string[]) => void;
  
  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  appendSessionMessage: (sessionId: string, message: Message) => void;
  upsertSessionBubble: (sessionId: string, bubbleId: string, updates: Partial<Message>) => void;
  setCurrentSession: (sessionId: string) => void;
  setSystemPrompt: (prompt: 'TRAE_AGENT_SYSTEM_PROMPT' | 'DOCUMENT_AGENT_SYSTEM_PROMPT') => void;
  
  setWorkspaceRoot: (root: string) => void;
  setFileTree: (tree: FileNode[]) => void;
  updateFileNode: (path: string, updates: Partial<FileNode>) => void;
  
  addOpenFile: (file: EditorFile) => void;
  updateOpenFile: (path: string, updates: Partial<EditorFile>) => void;
  removeOpenFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  
  setChatInput: (input: string) => void;
  addInputAttachment: (attachment: Attachment) => void;
  removeInputAttachment: (index: number) => void;
  clearInputAttachments: () => void;

  addPendingDiff: (path: string, diff: DiffItem) => void;
  removePendingDiff: (path: string, diffId: string) => void;
  clearPendingDiffs: (path: string) => void;

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  toggleSidebar: () => void;
  toggleChatPanel: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleFullscreen: () => void;
}

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        // Initial state
        sessions: [],
        currentSessionId: null,
        systemPrompt: 'DOCUMENT_AGENT_SYSTEM_PROMPT',
        workspaceRoot: '/workspace',
        fileTree: [],
        openFiles: [],
        activeFilePath: null,
        pendingDiffs: {},
        chatInput: '',
        inputAttachments: [],
        isLoading: false,
        error: null,
        sidebarCollapsed: false,
        chatPanelCollapsed: false,
        theme: 'light',
        isFullscreen: false,
        enabledTools: [],
        
        setSessions: (sessions) => set({ sessions }),
        addSession: (session) => set((state) => ({ 
          sessions: [...state.sessions, session],
          currentSessionId: session.id 
        })),
        updateSession: (sessionId, updates) => set((state) => ({
          sessions: state.sessions.map((s) => 
            s.id === sessionId ? { ...s, ...updates, updatedAt: new Date() } : s
          )
        })),
        appendSessionMessage: (sessionId, message) => set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id === sessionId) {
              const exists = s.messages.some(m => m.id === message.id);
              if (exists) return s;
              return { ...s, messages: [...s.messages, message], updatedAt: new Date() };
            }
            return s;
          })
        })),
        upsertSessionBubble: (sessionId, bubbleId, updates) => set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id === sessionId) {
              const idx = s.messages.findIndex(m => m.id === bubbleId);
              if (idx >= 0) {
                const newMsgs = [...s.messages];
                newMsgs[idx] = { ...newMsgs[idx], ...updates };
                return { ...s, messages: newMsgs, updatedAt: new Date() };
              } else {
                // Create new if not exists (assuming it's a new bubble)
                // But we need 'type', 'content' etc. from updates if it's new.
                // Usually upsert implies create if missing.
                const newMsg = {
                   id: bubbleId,
                   type: updates.type || 'agent', 
                   content: updates.content || '',
                   timestamp: new Date(),
                   sessionId,
                   ...updates
                } as Message;
                return { ...s, messages: [...s.messages, newMsg], updatedAt: new Date() };
              }
            }
            return s;
          })
        })),
        setCurrentSession: (currentSessionId) => set({ currentSessionId }),
        setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
        
        setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),
        setFileTree: (fileTree) => set({ fileTree }),
        updateFileNode: (path, updates) => set((state) => {
          const updateNode = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(node => {
              if (node.path === path) {
                return { ...node, ...updates };
              }
              if (node.children) {
                return { ...node, children: updateNode(node.children) };
              }
              return node;
            });
          };
          return { fileTree: updateNode(state.fileTree) };
        }),
        
        addOpenFile: (file) => set((state) => {
          if (state.openFiles.some(f => f.path === file.path)) return state;
          return { openFiles: [...state.openFiles, file] };
        }),
        updateOpenFile: (path, updates) => set((state) => ({
          openFiles: state.openFiles.map(f => 
            f.path === path ? { ...f, ...updates } : f
          )
        })),
        removeOpenFile: (path) => set((state) => {
          const newFiles = state.openFiles.filter(f => f.path !== path);
          // If closing active file, activate another one
          let newActive = state.activeFilePath;
          if (state.activeFilePath === path) {
            newActive = newFiles.length > 0 ? newFiles[newFiles.length - 1].path : null;
          }
          return { 
            openFiles: newFiles,
            activeFilePath: newActive
          };
        }),
        setActiveFile: (activeFilePath) => set({ activeFilePath }),

        setChatInput: (chatInput) => set({ chatInput }),
        addInputAttachment: (attachment) => set((state) => ({ 
          inputAttachments: [...state.inputAttachments, attachment] 
        })),
        removeInputAttachment: (index) => set((state) => ({
          inputAttachments: state.inputAttachments.filter((_, i) => i !== index)
        })),
        clearInputAttachments: () => set({ inputAttachments: [] }),

        addPendingDiff: (path, diff) => set((state) => {
          const existing = state.pendingDiffs[path] || [];
          // Check if already exists
          if (existing.some(d => d.id === diff.id)) return state;
          return {
            pendingDiffs: {
              ...state.pendingDiffs,
              [path]: [...existing, diff]
            }
          };
        }),
        removePendingDiff: (path, diffId) => set((state) => {
          const existing = state.pendingDiffs[path] || [];
          return {
            pendingDiffs: {
              ...state.pendingDiffs,
              [path]: existing.filter(d => d.id !== diffId)
            }
          };
        }),
        clearPendingDiffs: (path) => set((state) => {
           const { [path]: _, ...rest } = state.pendingDiffs;
           return { pendingDiffs: rest };
        }),

        setLoading: (isLoading) => set({ isLoading }),
        
        setError: (error) => set({ error }),
        
        toggleSidebar: () => set((state) => ({
          sidebarCollapsed: !state.sidebarCollapsed
        })),
        toggleChatPanel: () => set((state) => ({
          chatPanelCollapsed: !state.chatPanelCollapsed
        })),
        setTheme: (theme) => set({ theme }),
        toggleFullscreen: () => set((state) => ({
          isFullscreen: !state.isFullscreen
        })),
        setEnabledTools: (enabledTools) => set({ enabledTools }),
      }),
      {
        name: 'ai-ide-storage',
        partialize: (state) => ({
          sessions: state.sessions,
          currentSessionId: state.currentSessionId,
          systemPrompt: state.systemPrompt,
          workspaceRoot: state.workspaceRoot,
          sidebarCollapsed: state.sidebarCollapsed,
          chatPanelCollapsed: state.chatPanelCollapsed,
          theme: state.theme,
          fileTree: state.fileTree,
          openFiles: state.openFiles,
          activeFilePath: state.activeFilePath,
          enabledTools: state.enabledTools,
        }),
      }
    )
  )
);
