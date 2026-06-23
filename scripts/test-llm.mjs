const baseUrl = (process.env.LLM_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.LLM_API_KEY || '';
const model = process.env.LLM_MODEL || '';
const protocol = process.env.LLM_PROTOCOL || 'auto';
const prompt = process.env.LLM_PROMPT || '你好';

if (!baseUrl || !apiKey || !model) {
  console.error('Usage: set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, then run this script.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  Accept: 'application/json'
};

function endpoint(path) {
  if (baseUrl.endsWith(path)) return baseUrl;
  if (baseUrl.endsWith('/chat/completions') || baseUrl.endsWith('/responses')) {
    return `${baseUrl.replace(/\/(?:chat\/completions|responses)$/, '')}${path}`;
  }
  return `${baseUrl}${path}`;
}

async function requestChat() {
  const response = await fetch(endpoint('/chat/completions'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      stream: false
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`chat/completions ${response.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  return json?.choices?.[0]?.message?.content || json?.choices?.[0]?.delta?.content || '';
}

async function requestResponses() {
  const response = await fetch(endpoint('/responses'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0,
      stream: false
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`responses ${response.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  const outputText =
    json?.output_text ||
    (Array.isArray(json?.output)
      ? json.output
          .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
          .map((content) => content?.text || content?.content || '')
          .join('')
      : '');
  return outputText;
}

async function main() {
  const attempts = protocol === 'responses' ? [requestResponses] : protocol === 'chat' ? [requestChat] : [requestChat, requestResponses];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const content = await attempt();
      console.log(content || '[empty response]');
      return;
    } catch (error) {
      errors.push([error.message, error.cause?.code, error.cause?.message].filter(Boolean).join(' | '));
    }
  }
  console.error(errors.join('\n'));
  process.exit(1);
}

await main();
