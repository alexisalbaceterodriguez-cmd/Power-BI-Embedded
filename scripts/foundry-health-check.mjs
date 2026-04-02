function getEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : fallback;
}

function line(title, value = '') {
  if (value) {
    console.log(`${title}: ${value}`);
    return;
  }
  console.log(title);
}

function redact(text, maxLen = 600) {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

async function safeText(response) {
  try {
    const text = await response.text();
    return text || '';
  } catch {
    return '';
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getBootstrapAgent() {
  const raw = getEnv('BOOTSTRAP_AI_AGENTS_JSON');
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const first = parsed[0] ?? null;
    if (!first || typeof first !== 'object') return null;
    return first;
  } catch {
    return null;
  }
}

async function acquireToken() {
  const tenantId = getEnv('AZURE_TENANT_ID');
  const clientId = getEnv('AZURE_CLIENT_ID');
  const clientSecret = getEnv('AZURE_CLIENT_SECRET');
  const scope = getEnv('FOUNDRY_API_SCOPE', 'https://ai.azure.com/.default');

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope,
  });

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const payload = await safeJson(response);
  if (!response.ok || !payload?.access_token) {
    const detail = payload ? JSON.stringify(payload) : await safeText(response);
    throw new Error(`Token error ${response.status}: ${redact(detail)}`);
  }

  line('Token', `OK (expires_in=${payload.expires_in ?? 'unknown'}s)`);
  return payload.access_token;
}

async function checkResponsesEndpoint(token, endpoint, question) {
  if (!endpoint) {
    line('Responses endpoint', 'MISSING');
    return false;
  }

  line('Responses endpoint', endpoint);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: question }),
  });

  const requestId = response.headers.get('x-ms-request-id') || response.headers.get('request-id') || '-';
  const text = await safeText(response);

  if (!response.ok) {
    line('Responses check', `FAIL status=${response.status}, requestId=${requestId}`);
    line('Body', redact(text));
    return false;
  }

  line('Responses check', `OK status=${response.status}, requestId=${requestId}`);
  line('Body', redact(text));
  return true;
}

async function main() {
  const bootstrapAgent = getBootstrapAgent();
  const endpoint =
    getEnv('FOUNDRY_RESPONSES_ENDPOINT') ||
    getEnv('AZURE_FOUNDRY_RESPONSES_ENDPOINT') ||
    String(bootstrapAgent?.responsesEndpoint ?? bootstrapAgent?.publishedUrl ?? '').trim();

  const question = getEnv('FOUNDRY_HEALTH_QUESTION', 'Dime el total de ventas del informe actual.');

  line('Foundry Health Check');
  line('Fecha', new Date().toISOString());
  line('Pregunta test', question);
  console.log('');

  const token = await acquireToken();
  console.log('');

  const ok = await checkResponsesEndpoint(token, endpoint, question);
  console.log('');
  line('Resultado final', ok ? 'OK' : 'FAIL');

  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
