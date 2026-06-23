import {
  callModelsEndpoint,
  clientErrorStatus,
  jsonError,
  knownProviderModels,
  normalizeModelIds,
  proxyCatchMessage,
  proxyCatchStatus,
  upstreamErrorBody,
  validateModelListPayload,
  type ModelListPayload
} from '../_proxy';

export async function onRequestPost(context: { request: Request }) {
  let payload: ModelListPayload;
  try {
    payload = await context.request.json();
  } catch {
    return jsonError('请求体必须是 JSON。');
  }

  const validationError = validateModelListPayload(payload);
  if (validationError) return jsonError(validationError);

  try {
    const upstream = await callModelsEndpoint(payload);
    const knownModels = knownProviderModels(payload.base_url!);
    if (!upstream.ok) {
      if (knownModels.length) {
        return Response.json({ models: knownModels, source: 'known' });
      }
      return Response.json(await upstreamErrorBody(upstream, payload.key), { status: clientErrorStatus(upstream.status) });
    }

    const json = await upstream.json().catch(() => null);
    const models = normalizeModelIds(json);
    if (models.length) {
      return Response.json({ models, source: 'upstream' });
    }
    if (knownModels.length) {
      return Response.json({ models: knownModels, source: 'known' });
    }
    return Response.json({ error: '没有从服务商解析到可用模型。' }, { status: 424 });
  } catch (error) {
    const knownModels = knownProviderModels(payload.base_url!);
    if (knownModels.length) {
      return Response.json({ models: knownModels, source: 'known' });
    }
    return Response.json({ error: proxyCatchMessage(error) }, { status: proxyCatchStatus(error) });
  }
}
