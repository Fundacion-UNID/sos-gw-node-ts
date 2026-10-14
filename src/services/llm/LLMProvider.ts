export type LLMGenerateJsonParams = {
  model: string;
  prompt: string;
  temperature?: number;
  timeoutMs?: number;
};

export interface LLMProvider {
  generateJson<T>(params: LLMGenerateJsonParams): Promise<T>;
}

