/* eslint-disable no-console */
const REQUIRED_ENV = ['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET'];

function getEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : fallback;
}

function getBootstrapAgent() {
  const raw = getEnv('BOOTSTRAP_AI_AGENTS_JSON');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

function trimSlash(url) {
  return url.replace(/\/+$/, '');
}

function redact(text, maxLen = 600) {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

async function safeText(response) {
  try {
    return await response.text();
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

function line(title, value = '') {
  if (value) {
    console.log(`${title}: ${value}`);
    return;
  }
  console.log(title);
}

async function acquireToken() {
  const tenantId = getEnv('TENANT_ID');
  const clientId = getEnv('CLIENT_ID');
  const clientSecret = getEnv('CLIENT_SECRET');
  const scope = getEnv('FABRIC_API_SCOPE', 'https://api.fabric.microsoft.com/.default');

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

function buildAgentUrls(baseUrl) {
  const normalized = trimSlash(baseUrl);
  return [
    normalized,
    `${normalized}/chat/completions`,
    `${normalized}/v1/chat/completions`,
    `${normalized}/responses`,
  ];
}

async function checkPublishedAgent(token, publishedUrl, question) {
  if (!publishedUrl) {
    line('Published URL', 'SKIPPED (no definido)');
    return false;
  }

  line('Published URL', publishedUrl);
  const urls = buildAgentUrls(publishedUrl);
  let anySuccess = false;

  for (const url of urls) {
    const isResponses = url.endsWith('/responses');
    const body = isResponses
      ? { input: `USER: ${question}`, temperature: 0.2 }
      : {
          model: 'fabric-agent',
          messages: [{ role: 'user', content: question }],
          temperature: 0.2,
        };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const requestId = response.headers.get('x-ms-request-id') || response.headers.get('request-id') || '-';

    if (response.ok) {
      const payload = await safeJson(response);
      anySuccess = true;
      line(`  [OK] ${url}`, `status=${response.status}, requestId=${requestId}`);
      line('    payload', redact(JSON.stringify(payload)));
      continue;
    }

    const text = await safeText(response);
    line(`  [FAIL] ${url}`, `status=${response.status}, requestId=${requestId}`);
    line('    body', redact(text));
  }

  return anySuccess;
}

async function checkMcp(token, mcpUrl, toolName, question) {
  if (!mcpUrl) {
    line('MCP URL', 'SKIPPED (no definido)');
    return;
  }

  const base = trimSlash(mcpUrl);
  line('MCP URL', base);

  const listResponse = await fetch(base, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });

  const listText = await safeText(listResponse);
  if (!listResponse.ok) {
    line('  tools/list', `FAIL status=${listResponse.status}`);
    line('  body', redact(listText));
    return;
  }

  let resolvedTool = toolName;
  try {
    const payload = JSON.parse(listText);
    const tools = payload?.result?.tools ?? [];
    if (!resolvedTool && Array.isArray(tools) && tools[0]?.name) {
      resolvedTool = tools[0].name;
    }
    line('  tools/list', `OK tools=${Array.isArray(tools) ? tools.length : 0}`);
    line('  selectedTool', resolvedTool || '(none)');
  } catch {
    line('  tools/list', 'OK (respuesta no JSON)');
  }

  if (!resolvedTool) {
    line('  tools/call', 'SKIPPED (no toolName)');
    return;
  }

  const callResponse = await fetch(base, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: resolvedTool,
        arguments: { userQuestion: question },
      },
    }),
  });

  const callText = await safeText(callResponse);
  if (!callResponse.ok) {
    line('  tools/call', `FAIL status=${callResponse.status}`);
    line('  body', redact(callText));
    return;
  }

  line('  tools/call', 'OK');
  line('  body', redact(callText));
}

async function main() {
  const missing = REQUIRED_ENV.filter((name) => !getEnv(name));
  if (missing.length > 0) {
    throw new Error(`Faltan variables obligatorias: ${missing.join(', ')}`);
  }

  const bootstrapAgent = getBootstrapAgent();
  const publishedUrl =
    getEnv('FABRIC_AGENT_URL') ||
    getEnv('AI_AGENT_PUBLISHED_URL') ||
    (bootstrapAgent?.publishedUrl ?? '');
  const mcpUrl =
    getEnv('FABRIC_AGENT_MCP_URL') ||
    getEnv('AI_AGENT_MCP_URL') ||
    (bootstrapAgent?.mcpUrl ?? '');
  const mcpToolName =
    getEnv('FABRIC_AGENT_MCP_TOOL') ||
    getEnv('AI_AGENT_MCP_TOOL') ||
    (bootstrapAgent?.mcpToolName ?? '');
  const question = getEnv('FABRIC_HEALTH_QUESTION', 'Cual fue el producto mas vendido?');
  const mcpEnabled = getEnv('FABRIC_ENABLE_MCP_FALLBACK', 'true') !== 'false';

  line('Fabric Health Check');
  line('Fecha', new Date().toISOString());
  line('MCP fallback app', mcpEnabled ? 'ENABLED' : 'DISABLED');
  line('Pregunta test', question);
  console.log('');

  const token = await acquireToken();
  console.log('');

  const openAiOk = await checkPublishedAgent(token, publishedUrl, question);
  console.log('');

  if (mcpEnabled) {
    await checkMcp(token, mcpUrl, mcpToolName, question);
  } else {
    line('MCP check', 'SKIPPED (FABRIC_ENABLE_MCP_FALLBACK=false)');
  }

  console.log('');
  line('Resultado OpenAI URL', openAiOk ? 'AL MENOS 1 endpoint respondio OK' : 'NINGUN endpoint respondio OK');
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
