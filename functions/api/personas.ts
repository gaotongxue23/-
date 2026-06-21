import { BUILTIN_ENGINE_DEFINITIONS, DEFAULT_PERSONAS } from '../../server/src/shared/persona';

export async function onRequestGet() {
  return Response.json({
    engines: Object.values(BUILTIN_ENGINE_DEFINITIONS).map((engine) => ({ ...engine, builtin: true })),
    personas: DEFAULT_PERSONAS
  });
}

