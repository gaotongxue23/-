const PROXY_TIMEOUT_MS = 60_000;

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

export function classifyStatus(status: number) {
  if (status === 401 || status === 403) return '鉴权失败，请检查 key 与 base_url';
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

export async function callUpstream(payload: ProxyPayload, stream: boolean) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    return await fetch(normalizeChatUrl(payload.base_url!), {
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
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function proxyCatchMessage(error: unknown) {
  return (error as { name?: string })?.name === 'AbortError' ? '上游请求超时' : '无法连接上游，请检查 base_url。';
}

export function proxyCatchStatus(error: unknown) {
  return (error as { name?: string })?.name === 'AbortError' ? 504 : 502;
}

