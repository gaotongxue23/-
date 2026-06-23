import type { LlmMessage } from '@/persona/prompt';
import { normalizeCredentials } from '@/storage/credentials';
import type { LocalCredentials } from '@/storage/types';

export interface StreamRequest {
  credentials: LocalCredentials;
  messages: LlmMessage[];
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

export interface ModelListResult {
  models: string[];
  source: 'upstream' | 'known';
}

function readOpenAiDelta(payload: any): string {
  if (payload?.type === 'response.output_text.delta' && typeof payload?.delta === 'string') return payload.delta;
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return payload?.choices?.[0]?.delta?.content ?? payload?.choices?.[0]?.message?.content ?? payload?.content ?? '';
}

function formatProxyError(error: any, fallback: string) {
  const message = error?.error ?? fallback;
  return error?.detail ? `${message}：${error.detail}` : message;
}

export async function streamFortuneReading(request: StreamRequest): Promise<string> {
  const credentials = normalizeCredentials(request.credentials);
  const response = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_url: credentials.baseUrl,
      key: credentials.apiKey,
      model: credentials.model,
      messages: request.messages,
      temperature: 0.72
    }),
    signal: request.signal
  });

  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({ error: '解读请求失败' }));
    throw new Error(formatProxyError(error, '解读请求失败'));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const dataLines = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      for (const data of dataLines) {
        if (!data || data === '[DONE]') continue;
        const parsed = JSON.parse(data);
        const delta = readOpenAiDelta(parsed);
        if (delta) {
          fullText += delta;
          request.onDelta(delta);
        }
      }
    }
  }

  return fullText;
}

export async function testCredentials(credentials: LocalCredentials): Promise<void> {
  const normalized = normalizeCredentials(credentials);
  const response = await fetch('/api/proxy/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_url: normalized.baseUrl,
      key: normalized.apiKey,
      model: normalized.model,
      messages: [{ role: 'user', content: '请只回复 ok' }]
    })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '连通性测试失败' }));
    throw new Error(formatProxyError(error, '连通性测试失败'));
  }
}

export async function fetchAvailableModels(credentials: Pick<LocalCredentials, 'baseUrl' | 'apiKey'>): Promise<ModelListResult> {
  const response = await fetch('/api/proxy/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_url: credentials.baseUrl.trim(),
      key: credentials.apiKey.trim()
    })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '模型列表获取失败' }));
    throw new Error(formatProxyError(error, '模型列表获取失败'));
  }
  const payload = (await response.json()) as Partial<ModelListResult>;
  return {
    models: Array.isArray(payload.models) ? payload.models.filter((model): model is string => typeof model === 'string' && model.trim().length > 0) : [],
    source: payload.source === 'known' ? 'known' : 'upstream'
  };
}
