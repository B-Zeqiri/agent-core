export type GenerationMode = 'creative' | 'deterministic';

export interface GenerationConfig {
  mode: GenerationMode;
  temperature?: number;
  maxTokens?: number;
  seed?: number;
}

export interface ModelCallOverrides {
  temperature?: number;
  maxTokens?: number;
  seed?: number;
  signal?: AbortSignal;
  taskId?: string;
  agentId?: string;
  agentVersion?: string;
}
