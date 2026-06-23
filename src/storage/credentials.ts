import type { LocalCredentials } from './types';

const KEY = 'soothsay-byok';
const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-pro';

export function normalizeCredentials(credentials: LocalCredentials): LocalCredentials {
  const baseUrl = credentials.baseUrl.trim();
  const apiKey = credentials.apiKey.trim();
  let model = credentials.model.trim() || OPENAI_DEFAULT_MODEL;

  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if ((hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) && model === OPENAI_DEFAULT_MODEL) {
      model = DEEPSEEK_DEFAULT_MODEL;
    }
  } catch {
    // validateCredentials reports malformed URLs; keep normalization side-effect free.
  }

  return { baseUrl, apiKey, model };
}

export function getCredentials(): LocalCredentials | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalCredentials>;
    if (!parsed.baseUrl || !parsed.apiKey || !parsed.model) return null;
    return normalizeCredentials({
      baseUrl: parsed.baseUrl,
      apiKey: parsed.apiKey,
      model: parsed.model
    });
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: LocalCredentials) {
  const normalized = normalizeCredentials(credentials);
  localStorage.setItem(
    KEY,
    JSON.stringify({
      baseUrl: normalized.baseUrl,
      apiKey: normalized.apiKey,
      model: normalized.model
    })
  );
}

export function clearCredentials() {
  localStorage.removeItem(KEY);
}

export function validateCredentials(credentials: LocalCredentials): string | null {
  if (!credentials.baseUrl.trim()) return '请先填写 base_url';
  if (!/^https?:\/\//i.test(credentials.baseUrl.trim())) return 'base_url 必须以 http:// 或 https:// 开头';
  if (!credentials.apiKey.trim()) return '请先填写 key';
  if (!credentials.model.trim()) return '请填写模型名称';
  return null;
}
