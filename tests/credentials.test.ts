import { describe, expect, it } from 'vitest';
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
});
