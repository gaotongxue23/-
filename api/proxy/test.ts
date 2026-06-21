import {
  callUpstream,
  proxyCatchMessage,
  readJson,
  sendJson,
  readChatContent,
  unreadableUpstreamBody,
  upstreamErrorBody,
  validatePayload
} from '../_vercel-proxy.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch {
    sendJson(res, 400, { error: '请求体必须是 JSON。' });
    return;
  }

  const testPayload = {
    ...payload,
    messages: [{ role: 'user', content: '请只回复 ok' }],
    temperature: 0
  };
  const validationError = validatePayload(testPayload);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  try {
    const upstream = await callUpstream(testPayload, false);
    if (!upstream.ok) {
      sendJson(res, upstream.status, await upstreamErrorBody(upstream, testPayload.key));
      return;
    }
    if (!(await readChatContent(upstream))) {
      sendJson(res, 502, unreadableUpstreamBody());
      return;
    }
    sendJson(res, 200, { ok: true });
  } catch (error: any) {
    sendJson(res, error?.name === 'AbortError' ? 504 : 502, { error: proxyCatchMessage(error) });
  }
}
