import axios from 'axios';

// Use relative URL to work with Vite proxy
const API_BASE_URL = '';

// Add request interceptor to handle errors
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ERR_NETWORK') {
      console.error('Network error - backend may not be accessible');
      throw new Error('无法连接到后端服务，请确保Docker容器正在运行');
    }
    return Promise.reject(error);
  }
);

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export interface RunRequest {
  task?: string;
  file_path?: string;
  provider?: string;
  model?: string;
  model_base_url?: string;
  api_key?: string;
  max_steps?: number;
  working_dir?: string;
  must_patch?: boolean;
  config_file?: string;
  trajectory_file?: string;
  patch_path?: string;
  docker_image?: string;
  docker_container_id?: string;
  dockerfile_path?: string;
  docker_image_file?: string;
  docker_keep?: boolean;
  agent_type?: string;
  console_type?: string;
  prompt?: string;
}

export interface InteractiveStartRequest {
  provider?: string;
  model?: string;
  model_base_url?: string;
  api_key?: string;
  config_file?: string;
  max_steps?: number;
  trajectory_file?: string;
  working_dir?: string;
  console_type?: string;
  agent_type?: string;
  docker_image?: string;
  docker_container_id?: string;
  dockerfile_path?: string;
  docker_image_file?: string;
  docker_keep?: boolean;
  prompt?: string;
  agent_mode_config?: { mode_name?: string; system_prompt?: string };
  enable_quality_review?: boolean;
  quality_review_rules?: string;
  use_online_mode?: boolean;
  enable_lakeview?: boolean;
  lakeview_url?: string;
  tools?: string[];
}

export interface InteractiveTaskRequest {
  session_id: string;
  task?: string;
  file_path?: string;
  working_dir?: string;
  must_patch?: boolean;
  patch_path?: string;
  prompt?: string;
  agent_mode_config?: { mode_name?: string; system_prompt?: string };
  enable_quality_review?: boolean;
  quality_review_rules?: string;
}

export interface CreateConfigRequest {
  name: string;
  default_provider?: string;
  model?: string;
  base_url?: string;
  api_key?: string;
  max_steps?: number;
  enable_lakeview?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  parallel_tool_calls?: boolean;
  max_retries?: number;
}

export interface SessionResponse {
  session_id: string;
  status: string;
  working_dir: string;
  config_file: string;
}

export interface AgentStep {
  step_id: string;
  state: 'COMPLETED' | 'ERROR' | 'RUNNING';
  llm_response?: {
    content_excerpt: string;
    content?: string; // Full content from backend
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
    finish_reason?: string;
    tool_calls?: Array<{
      name: string;
      parameters: any;
    }>;
  };
  tool_calls?: Array<{
    name: string;
    parameters: any;
  }>;
  tool_results?: Array<{
    name: string;
    result: any;
    error?: string;
  }>;
  reflection?: string;
  timestamp: string;
  message_units?: Array<{
    type: 'think' | 'tool_call' | 'tool_result' | 'agent_output';
    call_id?: string;
    name?: string;
    arguments?: any;
    success?: boolean;
    markdown?: string;
    content?: string;
  }>;
}

export interface TrajectoryData {
  session_id: string;
  working_dir: string;
  config_file: string;
  steps: AgentStep[];
  success: boolean;
  final_result?: string;
  execution_time: number;
  steps_count: number;
}

class ApiClient {
  private client = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
    // Add CORS handling
    withCredentials: false,
  });

  // Health check
  async healthCheck(): Promise<{ status: string }> {
    const response = await this.client.get('/health');
    return response.data;
  }

  // Workspace operations
  async getWorkspace(): Promise<{ workspace: string }> {
    try {
      const response = await this.client.get('/workspace');
      return response.data;
    } catch (error) {
      console.error('Failed to get workspace:', error);
      // Fallback to container workspace
      return { workspace: '/workspace' };
    }
  }

  async listWorkspaces(): Promise<string[]> {
    try {
      const response = await this.client.get('/workspaces');
      if (Array.isArray(response.data)) {
        return response.data as string[];
      }
      if (response.data && typeof response.data.workspace === 'string') {
        return [response.data.workspace];
      }
      return ['/workspace'];
    } catch (error) {
      return ['/workspace'];
    }
  }

  async listFiles(workspace: string, relativeDir?: string): Promise<FileItem[]> {
    try {
      const response = await this.client.get('/api/files', {
        params: { workspace, relative_dir: relativeDir }
      });
      // Backend returns {items: [...], count: N}, extract items array
      if (response.data && response.data.items) {
        return response.data.items.map((item: any) => {
          const container: string = item.container_path || '';
          const rel = typeof container === 'string' && container.startsWith('/workspace')
            ? container.replace(/^\/workspace\/?/, '')
            : container;
          return {
            name: item.name,
            path: rel,
            type: item.is_dir ? 'directory' : 'file',
            size: item.size,
            modified: item.modified
          } as FileItem;
        });
      }
      return response.data || [];
    } catch (error) {
      console.error('Failed to list files:', error);
      return [];
    }
  }

  async listWorkspaceFiles(workspace: string, relativeDir?: string): Promise<Array<{ name: string; relative_path: string; is_dir: boolean }>> {
    try {
      const response = await this.client.get('/workspaces/files', {
        params: { workspace, relative_dir: relativeDir }
      });
      if (response.data && Array.isArray(response.data.files)) {
        return response.data.files as Array<{ name: string; relative_path: string; is_dir: boolean }>;
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  async readFile(workspace: string, file: string): Promise<{ content: string }> {
    const response = await this.client.get('/api/file', {
      params: { workspace, file }
    });
    return response.data;
  }

  async writeFile(workspace: string, file: string, content: string): Promise<void> {
    // Backend requires absolute file path for write
    const absFile = file.startsWith('/') ? file : `${workspace}/${file}`;
    await this.client.post('/api/file', {
      file: absFile,
      content
    });
  }

  async deleteFile(workspace: string, file: string): Promise<void> {
    await this.client.delete('/api/file', {
      params: { workspace, file }
    });
  }

  // Agent operations
  async startInteractiveSession(request: InteractiveStartRequest): Promise<SessionResponse> {
    const response = await this.client.post('/agent/interactive/start', request);
    return response.data;
  }

  async runInteractiveTask(request: InteractiveTaskRequest): Promise<TrajectoryData> {
    const response = await this.client.post('/agent/interactive/task', request);
    return response.data;
  }

  async runInteractiveTaskStream(
    request: InteractiveTaskRequest,
    onMessage: (data: any) => void,
    onError?: (error: Error) => void,
    onComplete?: () => void
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${protocol}://${window.location.host}/ws/agent/interactive/task`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(request));
        } catch (e) {
          onError?.(e as Error);
        }
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          onMessage(msg);
          if (msg && msg.type === 'end') {
            onComplete?.();
            ws.close();
            resolve();
          }
        } catch (e) {
          // ignore non-JSON frames
        }
      };

      ws.onerror = () => {
        onError?.(new Error('WebSocket error'));
      };

      ws.onclose = () => {
        resolve();
      };
    });
  }

  async runAgent(request: RunRequest): Promise<TrajectoryData> {
    const response = await this.client.post('/api/agent/run', request);
    return response.data;
  }

  async runAgentWithUpload(request: RunRequest, configFile?: File): Promise<TrajectoryData> {
    const formData = new FormData();
    
    // Add JSON data
    formData.append('body', JSON.stringify(request));
    
    // Add file if provided
    if (configFile) {
      formData.append('config_file_file', configFile);
    }

    const response = await this.client.post('/agent/run', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    
    return response.data;
  }

  async runAgentStream(
    request: RunRequest,
    onMessage: (data: any) => void,
    onError?: (error: Error) => void,
    onComplete?: () => void
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${protocol}://${window.location.host}/ws/agent/run/stream`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(request));
        } catch (e) {
          onError?.(e as Error);
        }
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          onMessage(msg);
          if (msg && msg.type === 'end') {
            onComplete?.();
            ws.close();
            resolve();
          }
        } catch (e) {
          // ignore non-JSON frames
        }
      };

      ws.onerror = () => {
        onError?.(new Error('WebSocket error'));
      };

      ws.onclose = () => {
        resolve();
      };
    });
  }

  async runInteractiveTaskWS(
    request: InteractiveTaskRequest,
    onMessage: (data: any) => void,
    onError?: (error: Error) => void,
    onComplete?: () => void
  ): Promise<void> {
    return this.runInteractiveTaskStream(request, onMessage, onError, onComplete);
  }

  async runAgentCLI(request: { workspace: string; command: string }): Promise<{ output: string }> {
    const response = await this.client.post('/api/agent/cli', request);
    return response.data;
  }

  async createConfig(request: CreateConfigRequest): Promise<{ message: string; path: string }> {
    const response = await this.client.post('/config/create', request);
    return response.data;
  }

  async getConfig(configFile: string): Promise<any> {
    const response = await this.client.get('/agent/config', {
      params: { config_file: configFile }
    });
    return response.data;
  }

  async testModelConnectivity(params: { provider?: string; model?: string; model_base_url?: string; api_key?: string }): Promise<any> {
    const response = await this.client.get('/agent/test-model', {
      params: {
        provider: params.provider,
        model_base_url: params.model_base_url,
        api_key: params.api_key,
      },
    });
    return response.data;
  }

  async uploadConfig(): Promise<{ container_path: string; url: string }> {
    throw new Error('Deprecated: frontend no longer supports uploading config files');
  }

  async getPrompt(name: 'DOCUMENT_AGENT_SYSTEM_PROMPT' | 'TRAE_AGENT_SYSTEM_PROMPT'): Promise<string> {
    try {
      const response = await this.client.get('/agent/prompt', {
        params: { name }
      });
      return response.data?.prompt || '';
    } catch (e) {
      return '';
    }
  }

  async listStoredPrompts(): Promise<Array<{ id: number; name: string }>> {
    const res = await this.client.get('/storage/prompt/list');
    return (res.data?.prompts || []) as Array<{ id: number; name: string }>;
  }

  async getStoredPromptById(id: number): Promise<{ id: number; name: string; content: string; enable_review?: boolean; review_rules?: string }> {
    const res = await this.client.post('/storage/prompt/get', { id });
    return res.data as { id: number; name: string; content: string; enable_review?: boolean; review_rules?: string };
  }

  async writeStoredPrompt(name: string, content: string): Promise<{ id: number; name: string }> {
    const res = await this.client.post('/storage/prompt/write', { name, content });
    return res.data as { id: number; name: string };
  }

  async deleteStoredPrompt(name: string): Promise<{ deleted: boolean }> {
    const res = await this.client.post('/storage/prompt/delete', { name });
    return res.data as { deleted: boolean };
  }


  async getAvailableTools(): Promise<{ tools: Array<{ name: string; description: string; custom_name?: string; initial_name_zh?: string }> }> {
    const response = await this.client.get('/agent/tools');
    return response.data;
  }

  async updateToolConfig(name: string, custom_name: string): Promise<{ status: string; custom_name: string }> {
    const response = await this.client.post('/agent/tools/config', { name, custom_name });
    return response.data;
  }

  async closeInteractiveSession(sessionId: string): Promise<{ session_id: string; closed: boolean }> {
    const response = await this.client.post('/agent/interactive/close', null, {
      params: { session_id: sessionId }
    });
    return response.data;
  }

  // Git Integration
  async gitInit(workspace: string): Promise<void> {
    await this.client.post('/api/git/init', { workspace });
  }

  async gitStatus(workspace: string): Promise<{ branch: string; files: Array<{ path: string; status: string }> }> {
    const res = await this.client.post('/api/git/status', { workspace });
    return res.data;
  }

  async gitDiff(workspace: string, path: string, contextLines = 3, requestId?: string): Promise<{ diff: string; request_id?: string }> {
    const res = await this.client.post('/api/git/diff', { workspace, path, context_lines: contextLines, request_id: requestId });
    return res.data;
  }

  async gitShow(workspace: string, path: string, revision: string = "HEAD"): Promise<{ content: string }> {
    const res = await this.client.post('/api/git/show', { workspace, path, revision });
    return res.data;
  }

  async gitAdd(workspace: string, files: string[]): Promise<void> {
    await this.client.post('/api/git/add', { workspace, files });
  }

  async gitCommit(workspace: string, message: string): Promise<void> {
    await this.client.post('/api/git/commit', { workspace, message });
  }

  async gitCheckout(workspace: string, files: string[]): Promise<void> {
    await this.client.post('/api/git/checkout', { workspace, files });
  }

  async gitReset(workspace: string, files: string[]): Promise<void> {
    await this.client.post('/api/git/reset', { workspace, files });
  }
  
  async gitLog(workspace: string, limit = 10, offset = 0): Promise<{ commits: Array<{ hash: string; author: string; date: string; message: string }> }> {
    const res = await this.client.post('/api/git/log', { workspace, limit, offset });
    return res.data;
  }

  async searchOnlineDocs(): Promise<any> {
    const payload = {
      pageNum: 1,
      pageSize: 100,
      orderBy: 'updateTime',
      order: 'desc',
      userId: 'user',
    };
    const res = await axios.post('http://localhost:8090/online/docs/search', payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    return res.data;
  }

  async getOnlineDocDetail(params: { userId: string; documentId: string }): Promise<any> {
    const res = await this.client.post('/online/docs/detail', {
      userId: params.userId,
      documentId: params.documentId,
    });
    return res.data;
  }

  async createOnlineReport(params: { title: string; description?: string; userId?: string; content?: string }): Promise<any> {
    const payload = {
      title: params.title,
      description: params.description,
      userId: params.userId,
      content: params.content
    };
    const res = await this.client.post('/online/report/create', payload);
    return res.data;
  }

  async createCustomTool(tool: {
    name: string;
    description: string;
    api_url: string;
    api_key: string;
    request_body_template: string;
    parameter_schema?: string;
    curl_example?: string;
    app_id?: string;
  }): Promise<{ id: number; name: string }> {
    const response = await this.client.post('/api/custom-tools', tool);
    return response.data;
  }

  async updateCustomTool(id: number, tool: {
    name?: string;
    description?: string;
    api_url?: string;
    api_key?: string;
    request_body_template?: string;
    parameter_schema?: string;
    curl_example?: string;
    app_id?: string;
  }): Promise<{ id: number; name: string }> {
    const response = await this.client.put(`/api/custom-tools/${id}`, tool);
    return response.data;
  }

  async deleteCustomTool(id: number): Promise<{ success: boolean }> {
    const response = await this.client.delete(`/api/custom-tools/${id}`);
    return response.data;
  }

  // Knowledge Base Operations
  async listKnowledgeBases(): Promise<Array<{
    id: number;
    name: string;
    description?: string;
    dataset_id: string;
    api_key: string;
    api_url: string;
    created_at?: string;
    updated_at?: string;
  }>> {
    const response = await this.client.get('/knowledge-bases');
    return response.data;
  }

  async createKnowledgeBase(kb: {
    name: string;
    description?: string;
    dataset_id: string;
    api_key: string;
    api_url: string;
  }): Promise<{ id: number; name: string }> {
    const response = await this.client.post('/knowledge-bases', kb);
    return response.data;
  }

  async updateKnowledgeBase(id: number, kb: {
    name?: string;
    description?: string;
    dataset_id?: string;
    api_key?: string;
    api_url?: string;
  }): Promise<{ id: number; name: string }> {
    const response = await this.client.put(`/knowledge-bases/${id}`, kb);
    return response.data;
  }

  async deleteKnowledgeBase(id: number): Promise<{ success: boolean }> {
    const response = await this.client.delete(`/knowledge-bases/${id}`);
    return response.data;
  }

  async testKnowledgeRetrieval(id: number, query: string): Promise<{ result: string }> {
    const response = await this.client.post(`/knowledge-bases/${id}/retrieve`, { query });
    return response.data;
  }

  async updateOnlineDoc(params: { documentId: string; content: string }): Promise<any> {
    const payload = {
      document_id: params.documentId,
      content: params.content
    };
    const res = await this.client.post('/online/report/edit', payload);
    return res.data;
  }

  async getOnlineBaseUrl(): Promise<{ base_url: string }>{
    const res = await this.client.get('/online/base-url');
    return res.data as { base_url: string };
  }

  async setOnlineBaseUrl(base_url: string): Promise<{ base_url: string }>{
    const res = await this.client.post('/online/base-url', { base_url });
    return res.data as { base_url: string };
  }


  // Removed: ws/trajectory/stream client

  async uploadFile(sessionId: string | null, file: File, relativePath?: string, workspace?: string): Promise<any> {
    const form = new FormData();
    form.append('file', file);
    const response = await axios.post(`${API_BASE_URL}/files/upload`, form, {
      params: { session_id: sessionId || undefined, relative_path: relativePath, workspace },
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }
  async getSessionMessages(sessionId: string): Promise<any[]> {
    const response = await this.client.get(`/api/sessions/${sessionId}/messages`);
    return response.data;
  }

  async listSessions(): Promise<any[]> {
    const response = await this.client.get('/api/sessions');
    return response.data;
  }
}

export const apiClient = new ApiClient();
