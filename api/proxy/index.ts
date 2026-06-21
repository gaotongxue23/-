import {
  callUpstream,
  clientErrorStatus,
  pipeWebStream,
  proxyCatchMessage,
  proxyCatchStatus,
  readChatContent,
  readJson,
  sendJson,
  sendSseText,
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

  const validationError = validatePayload(payload);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  try {
    const upstream = await callUpstream(payload, true);
    if (!upstream.ok) {
      sendJson(res, clientErrorStatus(upstream.status), await upstreamErrorBody(upstream, payload.key));
      return;
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream') && upstream.body) {
      await pipeWebStream(res, upstream.body);
      return;
    }

    let content = await readChatContent(upstream);
    if (!content) {
      const retry = await callUpstream(payload, false);
      if (!retry.ok) {
        sendJson(res, clientErrorStatus(retry.status), await upstreamErrorBody(retry, payload.key));
        return;
      }
      content = await readChatContent(retry);
    }
    if (!content) {
      sendJson(res, 424, unreadableUpstreamBody());
      return;
    }
    sendSseText(res, content ?? '');
  } catch (error: any) {
    sendJson(res, proxyCatchStatus(error), { error: proxyCatchMessage(error) });
  }
}
