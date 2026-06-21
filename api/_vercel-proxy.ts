const PROXY_TIMEOUT_MS = 60_000;

export interface ProxyPayload {
  base_url?: string;
  key?: string;
  model?: string;
  messages?: unknown[];
  temperature?: number;
}

export function sendJson(res: any, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function readBodyBuffer(req: any) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: any): Promise<ProxyPayload> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return JSON.parse(req.body);
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
    return req.body;
  }
  const body = await readBodyBuffer(req);
  if (body.length === 0) return {};
  return JSON.parse(body.toString('utf8'));
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
      model: payload.model,
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
    const upstream = await fetch(normalizeChatUrl(payload.base_url!), chatRequestInit(payload, stream, controller.signal));
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

export function unreadableUpstreamBody() {
  return {
    error: '上游返回了无法解析的内容，可能是 HTML 防护页、空响应，或该服务不支持服务器代理调用。',
    status: 502
  };
}

export function sendSseHeaders(res: any) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
}

export async function pipeWebStream(res: any, stream: ReadableStream<Uint8Array>) {
  sendSseHeaders(res);
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

export function sendSseText(res: any, content: string) {
  sendSseHeaders(res);
  res.write(`event: message\ndata: ${JSON.stringify({ content })}\n\n`);
  res.write('event: done\ndata: [DONE]\n\n');
  res.end();
}

export function proxyCatchStatus(error: any) {
  return error?.name === 'AbortError' ? 504 : 502;
}

export function proxyCatchMessage(error: any) {
  return error?.name === 'AbortError' ? '上游请求超时' : '无法连接上游，请检查 base_url。';
}
