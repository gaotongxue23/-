import type { LlmMessage } from '@/persona/prompt';
import { normalizeCredentials } from '@/storage/credentials';
import type { LocalCredentials } from '@/storage/types';

export interface StreamRequest {
  credentials: LocalCredentials;
  messages: LlmMessage[];
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

function readOpenAiDelta(payload: any): string {
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
