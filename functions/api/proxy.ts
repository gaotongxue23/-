import {
  callUpstream,
  classifyStatus,
  createSseFromText,
  jsonError,
  proxyCatchMessage,
  proxyCatchStatus,
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
      return Response.json({ error: classifyStatus(upstream.status), status: upstream.status }, { status: upstream.status });
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

    const json = await upstream.json().catch(() => null);
    const content =
      json?.choices?.[0]?.message?.content ??
      json?.choices?.[0]?.delta?.content ??
      (typeof json === 'string' ? json : JSON.stringify(json ?? {}));
    return new Response(createSseFromText(String(content)), {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform'
      }
    });
  } catch (error) {
    return Response.json({ error: proxyCatchMessage(error) }, { status: proxyCatchStatus(error) });
  }
}

