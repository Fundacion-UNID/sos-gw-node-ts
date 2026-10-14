import { describe, expect, it, jest } from '@jest/globals';
import { OllamaProvider } from '../../../services/llm/OllamaProvider';

describe('OllamaProvider', () => {
  it('posts to /api/generate and parses JSON response', async () => {
    const mockFetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({ response: '{"ok":true,"value":123}', done: true }),
      } as any;
    });
    (globalThis as any).fetch = mockFetch;

    const provider = new OllamaProvider('http://ollama:11434', 'gemma2:latest');
    const result = await provider.generateJson<{ ok: boolean; value: number }>({
      model: 'gemma2:latest',
      prompt: 'return json',
      temperature: 0,
      timeoutMs: 1000,
    });

    expect(result).toEqual({ ok: true, value: 123 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls.length).toBeGreaterThan(0);
    const [url, init] = mockFetch.mock.calls[0] as any;
    expect(url).toBe('http://ollama:11434/api/generate');
    expect(init?.method).toBe('POST');
    expect(init?.headers?.['Content-Type']).toBe('application/json');
  });
});
