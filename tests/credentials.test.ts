import { describe, expect, it } from 'vitest';
import { normalizeProviderModel } from '../api/_vercel-proxy';
import { normalizeCredentials } from '@/storage/credentials';

describe('credentials normalization', () => {
  it('maps the OpenAI default model to deepseek-chat for DeepSeek endpoints', () => {
    expect(
      normalizeCredentials({
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'secret',
        model: 'gpt-4o-mini'
      }).model
    ).toBe('deepseek-chat');
  });

  it('keeps an explicit DeepSeek model unchanged', () => {
    expect(
      normalizeCredentials({
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'secret',
        model: 'deepseek-reasoner'
      }).model
    ).toBe('deepseek-reasoner');
  });

  it('normalizes DeepSeek models in the proxy layer too', () => {
    expect(normalizeProviderModel('https://api.deepseek.com', 'gpt-4o-mini')).toBe('deepseek-chat');
    expect(normalizeProviderModel('https://api.deepseek.com', 'deepseek-reasoner')).toBe('deepseek-reasoner');
  });
});
