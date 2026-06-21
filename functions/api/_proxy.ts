const PROXY_TIMEOUT_MS = 60_000;
const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

export interface ProxyPayload {
  base_url?: string;
  key?: string;
  model?: string;
  messages?: unknown[];
  temperature?: number;
}

export function normalizeChatUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

export function fallbackChatUrl(baseUrl: string) {
  const primary = normalizeChatUrl(baseUrl);
  const url = new URL(primary);
  if (url.pathname.endsWith('/v1/chat/completions')) {
    url.pathname = `${url.pathname.slice(0, -'/v1/chat/completions'.length)}/chat/completions`;
    return url.toString();
  }
  return null;
}

export function classifyStatus(status: number) {
  if (status === 401 || status === 403) return '鉴权失败，请检查 key 与 base_url';
  if (status === 400) return '请求格式不被上游接受，请检查模型、base_url 和消息格式';
  if (status === 404) return '上游找不到接口或模型，请检查 base_url 是否需要去掉 /v1，以及模型名称是否正确';
  if (status === 408 || status === 504) return '上游请求超时';
  if (status === 429) return '上游限流，请稍后重试或检查套餐额度';
  if (status >= 500) return '上游服务暂时不可用';
  return '上游返回错误';
}

export function validatePayload(payload: ProxyPayload) {
  if (!payload.base_url?.trim()) return '缺少 base_url，请先配置模型端点。';
  if (!payload.key?.trim()) return '缺少 key，请先配置模型凭据。';
  if (!payload.model?.trim()) return '缺少模型名称。';
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) return '缺少 messages。';
  return null;
}

export function normalizeProviderModel(baseUrl: string, model: string) {
  const trimmedModel = model.trim();
  try {
    const hostname = new URL(baseUrl.trim()).hostname.toLowerCase();
    if ((hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) && trimmedModel === OPENAI_DEFAULT_MODEL) {
      return 'deepseek-chat';
    }
  } catch {
    // URL validation happens before upstream calls.
  }
  return trimmedModel;
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function createSseFromText(content: string) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ content })}\n\n`));
      controller.enqueue(encoder.encode('event: done\ndata: [DONE]\n\n'));
      controller.close();
    }
  });
}

export function extractChatContent(json: any): string | null {
  const content = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.delta?.content ?? json?.content;
  if (typeof content === 'string' && content.length > 0) return content;
  if (typeof json === 'string' && json.length > 0) return json;
  return null;
}

export function extractContentFromSseText(text: string) {
  let content = '';
  for (const event of text.split('\n\n')) {
    const dataLines = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    for (const data of dataLines) {
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        content += extractChatContent(parsed) ?? '';
      } catch {
        content += data;
      }
    }
  }
  return content || null;
}

export async function readChatContent(upstream: Response) {
  const raw = await upstream.text();
  if (/^\s*(?:<!doctype\s+html|<html)\b/i.test(raw)) return null;
  if (raw.trimStart().startsWith('data:')) return extractContentFromSseText(raw);
  try {
    return extractChatContent(JSON.parse(raw));
  } catch {
    return raw.trim() || null;
  }
}

function chatRequestInit(payload: ProxyPayload, stream: boolean, signal: AbortSignal) {
  return {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.key}`,
      Accept: stream ? 'text/event-stream, application/json' : 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: normalizeProviderModel(payload.base_url!, payload.model!),
      messages: payload.messages,
      temperature: Number.isFinite(payload.temperature) ? payload.temperature : 0.7,
      stream
    }),
    signal
  };
}

export async function callUpstream(payload: ProxyPayload, stream: boolean) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const request = chatRequestInit(payload, stream, controller.signal);
    const upstream = await fetch(normalizeChatUrl(payload.base_url!), request);
    const fallback = upstream.status === 404 ? fallbackChatUrl(payload.base_url!) : null;
    if (fallback) return fetch(fallback, chatRequestInit(payload, stream, controller.signal));
    return upstream;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readUpstreamError(upstream: Response, key?: string) {
  const raw = await upstream.text().catch(() => '');
  if (!raw) return null;
  let detail = raw;
  try {
    const json = JSON.parse(raw);
    detail = json?.error?.message ?? json?.error ?? json?.message ?? raw;
  } catch {
    detail = raw;
  }
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return text.replaceAll(key?.trim() || '\u0000', '[redacted]').slice(0, 500);
}

export async function upstreamErrorBody(upstream: Response, key?: string) {
  const detail = await readUpstreamError(upstream, key);
  return {
    error: classifyStatus(upstream.status),
    status: upstream.status,
    ...(detail ? { detail } : {})
  };
}

export function clientErrorStatus(status: number) {
  return status >= 500 ? 424 : status;
}

export function unreadableUpstreamBody() {
  return {
    error: '上游返回了无法解析的内容，可能是 HTML 防护页、空响应，或该服务不支持服务器代理调用。',
    status: 424
  };
}

export function proxyCatchMessage(error: unknown) {
  return (error as { name?: string })?.name === 'AbortError' ? '上游请求超时' : '无法连接上游，请检查 base_url。';
}

export function proxyCatchStatus(error: unknown) {
  return (error as { name?: string })?.name === 'AbortError' ? 408 : 424;
}
