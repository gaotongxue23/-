import { Hono } from 'hono';

const PROXY_TIMEOUT_MS = 60_000;

interface ProxyPayload {
  base_url?: string;
  key?: string;
  model?: string;
  messages?: unknown[];
  temperature?: number;
}

export const proxyRoutes = new Hono();

function normalizeChatUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

function fallbackChatUrl(baseUrl: string) {
  const primary = normalizeChatUrl(baseUrl);
  const url = new URL(primary);
  if (url.pathname.endsWith('/v1/chat/completions')) {
    url.pathname = `${url.pathname.slice(0, -'/v1/chat/completions'.length)}/chat/completions`;
    return url.toString();
  }
  return null;
}

function classifyStatus(status: number) {
  if (status === 401 || status === 403) return '鉴权失败，请检查 key 与 base_url';
  if (status === 400) return '请求格式不被上游接受，请检查模型、base_url 和消息格式';
  if (status === 404) return '上游找不到接口或模型，请检查 base_url 是否需要去掉 /v1，以及模型名称是否正确';
  if (status === 408 || status === 504) return '上游请求超时';
  if (status === 429) return '上游限流，请稍后重试或检查套餐额度';
  if (status >= 500) return '上游服务暂时不可用';
  return '上游返回错误';
}

function validatePayload(payload: ProxyPayload) {
  if (!payload.base_url?.trim()) return '缺少 base_url，请先配置模型端点。';
  if (!payload.key?.trim()) return '缺少 key，请先配置模型凭据。';
  if (!payload.model?.trim()) return '缺少模型名称。';
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) return '缺少 messages。';
  return null;
}

function createSseFromText(content: string) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ content })}\n\n`));
      controller.enqueue(encoder.encode('event: done\ndata: [DONE]\n\n'));
      controller.close();
    }
  });
}

function extractChatContent(json: any): string | null {
  const content = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.delta?.content ?? json?.content;
  if (typeof content === 'string' && content.length > 0) return content;
  if (typeof json === 'string' && json.length > 0) return json;
  return null;
}

function extractContentFromSseText(text: string) {
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

async function readChatContent(upstream: Response) {
  const raw = await upstream.text();
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

async function callUpstream(payload: ProxyPayload, stream: boolean) {
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

async function readUpstreamError(upstream: Response, key?: string) {
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

async function upstreamErrorBody(upstream: Response, key?: string) {
  const detail = await readUpstreamError(upstream, key);
  return {
    error: classifyStatus(upstream.status),
    status: upstream.status,
    ...(detail ? { detail } : {})
  };
}

proxyRoutes.post('/proxy', async (c) => {
  let payload: ProxyPayload;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: '请求体必须是 JSON。' }, 400);
  }

  const validationError = validatePayload(payload);
  if (validationError) return c.json({ error: validationError }, 400);

  try {
    const upstream = await callUpstream(payload, true);
    if (!upstream.ok) {
      return c.json(await upstreamErrorBody(upstream, payload.key), upstream.status as any);
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream') && upstream.body) {
      return new Response(upstream.body, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive'
        }
      });
    }

    let content = await readChatContent(upstream);
    if (!content) {
      const retry = await callUpstream(payload, false);
      if (!retry.ok) {
        return c.json(await upstreamErrorBody(retry, payload.key), retry.status as any);
      }
      content = await readChatContent(retry);
    }
    return new Response(createSseFromText(content ?? ''), {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform'
      }
    });
  } catch (error: any) {
    const message = error?.name === 'AbortError' ? '上游请求超时' : '无法连接上游，请检查 base_url。';
    return c.json({ error: message }, error?.name === 'AbortError' ? 504 : 502);
  }
});

proxyRoutes.post('/proxy/test', async (c) => {
  let payload: ProxyPayload;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: '请求体必须是 JSON。' }, 400);
  }
  const testPayload: ProxyPayload = {
    ...payload,
    messages: [{ role: 'user', content: '请只回复 ok' }],
    temperature: 0
  };
  const validationError = validatePayload(testPayload);
  if (validationError) return c.json({ error: validationError }, 400);

  try {
    const upstream = await callUpstream(testPayload, false);
    if (!upstream.ok) {
      return c.json(await upstreamErrorBody(upstream, testPayload.key), upstream.status as any);
    }
    return c.json({ ok: true });
  } catch (error: any) {
    return c.json({ error: error?.name === 'AbortError' ? '上游请求超时' : '无法连接上游，请检查 base_url。' }, 502);
  }
});
