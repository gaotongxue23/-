import {
  callModelsEndpoint,
  clientErrorStatus,
  knownProviderModels,
  normalizeModelIds,
  proxyCatchMessage,
  proxyCatchStatus,
  readJson,
  sendJson,
  upstreamErrorBody,
  validateModelListPayload,
  type ModelListPayload
} from '../_vercel-proxy.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  let payload: ModelListPayload;
  try {
    payload = await readJson(req);
  } catch {
    sendJson(res, 400, { error: '请求体必须是 JSON。' });
    return;
  }

  const validationError = validateModelListPayload(payload);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  try {
    const upstream = await callModelsEndpoint(payload);
    const knownModels = knownProviderModels(payload.base_url!);
    if (!upstream.ok) {
      if (knownModels.length) {
        sendJson(res, 200, { models: knownModels, source: 'known' });
        return;
      }
      sendJson(res, clientErrorStatus(upstream.status), await upstreamErrorBody(upstream, payload.key));
      return;
    }

    const json = await upstream.json().catch(() => null);
    const models = normalizeModelIds(json);
    if (models.length) {
      sendJson(res, 200, { models, source: 'upstream' });
      return;
    }
    if (knownModels.length) {
      sendJson(res, 200, { models: knownModels, source: 'known' });
      return;
    }
    sendJson(res, 424, { error: '没有从服务商解析到可用模型。' });
  } catch (error: any) {
    const knownModels = knownProviderModels(payload.base_url!);
    if (knownModels.length) {
      sendJson(res, 200, { models: knownModels, source: 'known' });
      return;
    }
    sendJson(res, proxyCatchStatus(error), { error: proxyCatchMessage(error) });
  }
}
