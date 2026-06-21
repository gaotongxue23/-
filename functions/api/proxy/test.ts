import {
  callUpstream,
  clientErrorStatus,
  jsonError,
  proxyCatchMessage,
  proxyCatchStatus,
  readChatContent,
  unreadableUpstreamBody,
  upstreamErrorBody,
  validatePayload,
  type ProxyPayload
} from '../_proxy';

export async function onRequestPost(context: { request: Request }) {
  let payload: ProxyPayload;
  try {
    payload = await context.request.json();
  } catch {
    return jsonError('请求体必须是 JSON。');
  }

  const testPayload: ProxyPayload = {
    ...payload,
    messages: [{ role: 'user', content: '请只回复 ok' }],
    temperature: 0
  };
  const validationError = validatePayload(testPayload);
  if (validationError) return jsonError(validationError);

  try {
    const upstream = await callUpstream(testPayload, false);
    if (!upstream.ok) {
      return Response.json(await upstreamErrorBody(upstream, testPayload.key), { status: clientErrorStatus(upstream.status) });
    }
    if (!(await readChatContent(upstream))) {
      return Response.json(unreadableUpstreamBody(), { status: 424 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: proxyCatchMessage(error) }, { status: proxyCatchStatus(error) });
  }
}
