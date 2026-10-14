import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import type { LLMGenerateJsonParams, LLMProvider } from './LLMProvider.js';

type OllamaGenerateRequest = {
  model: string;
  prompt: string;
  stream: boolean;
  format?: 'json';
  options?: {
    temperature?: number;
  };
};

type OllamaGenerateResponse = {
  response: string;
  done: boolean;
};

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly defaultModel: string,
  ) {}

  async generateJson<T>(params: LLMGenerateJsonParams): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 30_000);
    try {
      const requestBody: OllamaGenerateRequest = {
        model: params.model || this.defaultModel,
        prompt: params.prompt,
        stream: false,
        format: 'json',
        options: params.temperature === undefined ? undefined : { temperature: params.temperature },
      };

      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/generate`, {
        method: HttpRequestMethods.Post,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Ollama error ${response.status}: ${body || response.statusText}`);
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      const text = data?.response ?? '';
      try {
        return JSON.parse(text) as T;
      } catch (err) {
        const preview = text.slice(0, 500);
        throw new Error(`Ollama returned non-JSON response. Preview: ${preview}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
