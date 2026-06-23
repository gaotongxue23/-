const PROXY_TIMEOUT_MS = 60_000;
const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-pro';

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

export interface ModelListPayload {
  base_url?: string;
  key?: string;
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

export function normalizeModelsUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/models')) return trimmed;
  if (trimmed.endsWith('/chat/completions')) return `${trimmed.slice(0, -'/chat/completions'.length)}/models`;
  return `${trimmed}/models`;
}

export function fallbackModelsUrl(baseUrl: string) {
  const primary = normalizeModelsUrl(baseUrl);
  const url = new URL(primary);
  if (url.pathname.endsWith('/v1/models')) {
    url.pathname = `${url.pathname.slice(0, -'/v1/models'.length)}/models`;
    return url.toString();
  }
  return null;
}

export function modelUrlCandidates(baseUrl: string) {
  const primary = normalizeModelsUrl(baseUrl);
  const candidates = [primary];
  const fallback = fallbackModelsUrl(baseUrl);
  if (fallback) candidates.push(fallback);

  const url = new URL(primary);
  if (url.pathname.endsWith('/models') && !url.pathname.endsWith('/v1/models')) {
    const withV1 = new URL(primary);
    withV1.pathname = `${withV1.pathname.slice(0, -'/models'.length).replace(/\/+$/, '')}/v1/models`;
    candidates.push(withV1.toString());
  }
  return [...new Set(candidates)];
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

export function validateModelListPayload(payload: ModelListPayload) {
  if (!payload.base_url?.trim()) return '缺少 base_url，请先配置模型端点。';
  if (!payload.key?.trim()) return '缺少 key，请先配置模型凭据。';
  try {
    new URL(payload.base_url.trim());
  } catch {
    return 'base_url 格式不正确。';
  }
  return null;
}

export function normalizeProviderModel(baseUrl: string, model: string) {
  const trimmedModel = model.trim();
  try {
    const hostname = new URL(baseUrl.trim()).hostname.toLowerCase();
    if ((hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) && trimmedModel === OPENAI_DEFAULT_MODEL) {
      return DEEPSEEK_DEFAULT_MODEL;
    }
  } catch {
    // URL validation happens before upstream calls.
  }
  return trimmedModel;
}

export function knownProviderModels(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl.trim()).hostname.toLowerCase();
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
      return ['deepseek-v4-pro', 'deepseek-v4-flash'];
    }
    if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) {
      return ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'];
    }
  } catch {
    return [];
  }
  return [];
}

export function preferredModelScore(id: string) {
  const lower = id.toLowerCase();
  if (lower === 'gpt-5-codex') return 0;
  if (lower === 'deepseek-v4-pro') return 0;
  if (lower === 'deepseek-v4-flash') return 1;
  if (lower === 'gpt-4o-mini') return 1;
  if (lower.includes('chat')) return 4;
  if (lower.includes('gpt') || lower.includes('deepseek') || lower.includes('qwen') || lower.includes('glm')) return 5;
  return 8;
}

export function normalizeModelIds(json: any): string[] {
  const rawModels = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : Array.isArray(json) ? json : [];
  const ids: string[] = rawModels
    .map((item: any) => (typeof item === 'string' ? item : item?.id ?? item?.name))
    .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id: string) => id.trim());
  return Array.from(new Set<string>(ids)).sort((a, b) => preferredModelScore(a) - preferredModelScore(b) || a.localeCompare(b));
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
    const upstream = await fetch(normalizeChatUrl(payload.base_url!), chatRequestInit(payload, stream, controller.signal));
    const fallback = upstream.status === 404 ? fallbackChatUrl(payload.base_url!) : null;
    if (fallback) return fetch(fallback, chatRequestInit(payload, stream, controller.signal));
    return upstream;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callModelsEndpoint(payload: ModelListPayload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const init = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${payload.key}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    };
    let lastResponse: Response | null = null;
    for (const url of modelUrlCandidates(payload.base_url!)) {
      const upstream = await fetch(url, init);
      if (upstream.ok || upstream.status !== 404) return upstream;
      lastResponse = upstream;
    }
    return lastResponse ?? fetch(normalizeModelsUrl(payload.base_url!), init);
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
  return error?.name === 'AbortError' ? 408 : 424;
}

export function proxyCatchMessage(error: any) {
  return error?.name === 'AbortError' ? '上游请求超时' : '无法连接上游，请检查 base_url。';
}
