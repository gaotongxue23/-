import {
  callUpstream,
  createSseFromText,
  jsonError,
  proxyCatchMessage,
  proxyCatchStatus,
  readChatContent,
  upstreamErrorBody,
  validatePayload,
  type ProxyPayload
} from './_proxy';

export async function onRequestPost(context: { request: Request }) {
  let payload: ProxyPayload;
  try {
    payload = await context.request.json();
  } catch {
    return jsonError('请求体必须是 JSON。');
  }

  const validationError = validatePayload(payload);
  if (validationError) return jsonError(validationError);

  try {
    const upstream = await callUpstream(payload, true);
    if (!upstream.ok) {
      return Response.json(await upstreamErrorBody(upstream, payload.key), { status: upstream.status });
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream') && upstream.body) {
      return new Response(upstream.body, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform'
        }
      });
    }

    let content = await readChatContent(upstream);
    if (!content) {
      const retry = await callUpstream(payload, false);
      if (!retry.ok) {
        return Response.json(await upstreamErrorBody(retry, payload.key), { status: retry.status });
      }
      content = await readChatContent(retry);
    }
    return new Response(createSseFromText(content ?? ''), {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform'
      }
    });
  } catch (error) {
    return Response.json({ error: proxyCatchMessage(error) }, { status: proxyCatchStatus(error) });
  }
}
