import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export interface Message {
  id: string;
  type: 'user' | 'agent' | 'system' | 'error';
  content: string;
  timestamp: Date;
  sessionId?: string;
  stepId?: string;
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
  isDirty: boolean;
  language: string;
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
  
  // UI State
  isLoading: boolean;
  error: string | null;
  sidebarCollapsed: boolean;
  
  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  setCurrentSession: (sessionId: string) => void;
  setSystemPrompt: (prompt: 'TRAE_AGENT_SYSTEM_PROMPT' | 'DOCUMENT_AGENT_SYSTEM_PROMPT') => void;
  
  setWorkspaceRoot: (root: string) => void;
  setFileTree: (tree: FileNode[]) => void;
  updateFileNode: (path: string, updates: Partial<FileNode>) => void;
  
  addOpenFile: (file: EditorFile) => void;
  updateOpenFile: (path: string, updates: Partial<EditorFile>) => void;
  removeOpenFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  toggleSidebar: () => void;
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
        isLoading: false,
        error: null,
        sidebarCollapsed: false,

        // Actions
        setSessions: (sessions) => set({ sessions }),
        
        addSession: (session) => set((state) => ({
          sessions: [...state.sessions, session],
          currentSessionId: session.id
        })),
        
        updateSession: (sessionId, updates) => set((state) => ({
          sessions: state.sessions.map(session =>
            session.id === sessionId
              ? { ...session, ...updates, updatedAt: new Date() }
              : session
          )
        })),
        
        setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),
        
        setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
        
        setWorkspaceRoot: (root) => set({ workspaceRoot: root }),
        
        setFileTree: (tree) => set({ fileTree: tree }),
        
        updateFileNode: (path, updates) => set((state) => ({
          fileTree: updateNodeInTree(state.fileTree, path, updates)
        })),
        
        addOpenFile: (file) => set((state) => {
          const exists = state.openFiles.find(f => f.path === file.path);
          if (exists) {
            return { 
              openFiles: state.openFiles.map(f => 
                f.path === file.path ? file : f
              ),
              activeFilePath: file.path
            };
          }
          return {
            openFiles: [...state.openFiles, file],
            activeFilePath: file.path
          };
        }),
        
        updateOpenFile: (path, updates) => set((state) => ({
          openFiles: state.openFiles.map(file =>
            file.path === path
              ? { ...file, ...updates }
              : file
          )
        })),
        
        removeOpenFile: (path) => set((state) => {
          const newOpenFiles = state.openFiles.filter(f => f.path !== path);
          const newActiveFile = state.activeFilePath === path
            ? newOpenFiles.length > 0 ? newOpenFiles[newOpenFiles.length - 1].path : null
            : state.activeFilePath;
          
          return {
            openFiles: newOpenFiles,
            activeFilePath: newActiveFile
          };
        }),
        
        setActiveFile: (path) => set({ activeFilePath: path }),
        
        setLoading: (loading) => set({ isLoading: loading }),
        
        setError: (error) => set({ error }),
        
        toggleSidebar: () => set((state) => ({
          sidebarCollapsed: !state.sidebarCollapsed
        })),
      }),
      {
        name: 'ai-ide-storage',
        partialize: (state) => ({
          sessions: state.sessions,
          currentSessionId: state.currentSessionId,
          systemPrompt: state.systemPrompt,
          workspaceRoot: state.workspaceRoot,
          sidebarCollapsed: state.sidebarCollapsed,
        }),
      }
    )
  )
);

// Helper function to update a node in the file tree
function updateNodeInTree(tree: FileNode[], path: string, updates: Partial<FileNode>): FileNode[] {
  return tree.map(node => {
    if (node.path === path) {
      return { ...node, ...updates };
    }
    if (node.children) {
      return {
        ...node,
        children: updateNodeInTree(node.children, path, updates)
      };
    }
    return node;
  });
}
