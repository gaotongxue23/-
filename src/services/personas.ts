import {
  BUILTIN_ENGINE_DEFINITIONS,
  DEFAULT_PERSONAS,
  type PersonaEngine,
  type PersonaSkin
} from '@server-shared/persona';

export interface PersonaResponse {
  engines: PersonaEngine[];
  personas: PersonaSkin[];
}

export async function fetchPersonas(): Promise<PersonaResponse> {
  try {
    const response = await fetch('/api/personas');
    if (!response.ok) {
      throw new Error('角色列表加载失败');
    }
    return response.json();
  } catch (error) {
    console.warn('Use builtin personas because /api/personas is unavailable.', error);
    return {
      engines: Object.values(BUILTIN_ENGINE_DEFINITIONS).map((engine) => ({ ...engine, builtin: true })),
      personas: DEFAULT_PERSONAS.map((persona) => ({
        ...persona,
        categories: [...persona.categories],
        tone: { ...persona.tone }
      }))
    };
  }
}
