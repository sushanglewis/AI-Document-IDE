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
    try {
      const response = await fetch(`${API_BASE_URL}/agent/interactive/task/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not available');
      }

      const decoder = new TextDecoder();
      let currentEvent: string | null = null;
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
              continue;
            }
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data.trim()) {
                // Handle non-JSON terminal markers like 'done'
                if (data.trim() === 'done') {
                  onComplete?.();
                  currentEvent = null;
                  continue;
                }
                try {
                  const parsed = JSON.parse(data);
                  // Pass through event name to consumer
                  onMessage({ type: currentEvent || 'message', data: parsed });
                } catch (e) {
                  // Ignore non-JSON payloads silently
                }
              }
            }
          }
        }
        onComplete?.();
      } catch (error) {
        onError?.(error as Error);
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error('Stream request failed:', error);
      onError?.(error as Error);
    }
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
    const response = await fetch(`${API_BASE_URL}/agent/run/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not available');
    }

    const decoder = new TextDecoder();
    let currentEvent: string | null = null;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data.trim()) {
              if (data.trim() === 'done') {
                onComplete?.();
                currentEvent = null;
                continue;
              }
              try {
                const parsed = JSON.parse(data);
                onMessage({ type: currentEvent || 'message', data: parsed });
              } catch (e) {
                // Ignore non-JSON payloads silently
              }
            }
          }
        }
      }
      onComplete?.();
    } catch (error) {
      onError?.(error as Error);
    } finally {
      reader.releaseLock();
    }
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

  async getStoredPrompt(name: string): Promise<{ id: number; name: string; content: string }> {
    const res = await this.client.post('/storage/prompt/get', { name });
    return res.data as { id: number; name: string; content: string };
  }

  async writeStoredPrompt(name: string, content: string): Promise<{ id: number; name: string }> {
    const res = await this.client.post('/storage/prompt/write', { name, content });
    return res.data as { id: number; name: string };
  }

  async uploadFile(sessionId: string, file: File, relativePath?: string): Promise<{ path: string; container_path: string; filename: string; size?: number }>{
    const form = new FormData();
    form.append('file', file);
    const response = await this.client.post('/files/upload', form, {
      params: { session_id: sessionId, relative_path: relativePath },
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  }

  async getAvailableTools(): Promise<{ tools: Array<{ name: string; description: string }> }> {
    const response = await this.client.get('/agent/tools');
    return response.data;
  }
}

export const apiClient = new ApiClient();