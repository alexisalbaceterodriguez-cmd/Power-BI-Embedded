import { PowerBIServiceError } from '@/services/powerbi';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface FabricTokenCache {
  token: string;
  expiresAtMs: number;
}

interface FoundryTokenCache extends FabricTokenCache {
  source: 'sp' | 'azure-cli';
}

let fabricTokenCache: FabricTokenCache | null = null;
let foundryTokenCache: FoundryTokenCache | null = null;

function cachedFabricToken(): string | null {
  if (!fabricTokenCache) return null;
  if (Date.now() + 60_000 >= fabricTokenCache.expiresAtMs) return null;
  return fabricTokenCache.token;
}

function cachedFoundryToken(expectedSource?: 'sp' | 'azure-cli'): string | null {
  if (!foundryTokenCache) return null;
  if (Date.now() + 60_000 >= foundryTokenCache.expiresAtMs) return null;
  if (expectedSource && foundryTokenCache.source !== expectedSource) return null;
  return foundryTokenCache.token;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function safeText(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return text || null;
  } catch {
    return null;
  }
}

function readAzureEnv(primary: string, legacy: string): string | undefined {
  return process.env[primary]?.trim() || process.env[legacy]?.trim() || undefined;
}

export async function getFabricApiToken(): Promise<string> {
  const cached = cachedFabricToken();
  if (cached) return cached;

  const tenantId = readAzureEnv('AZURE_TENANT_ID', 'TENANT_ID');
  const clientId = readAzureEnv('AZURE_CLIENT_ID', 'CLIENT_ID');
  const clientSecret = readAzureEnv('AZURE_CLIENT_SECRET', 'CLIENT_SECRET');
  const scope = process.env.FABRIC_API_SCOPE ?? 'https://api.fabric.microsoft.com/.default';

  if (!tenantId || !clientId || !clientSecret) {
    throw new PowerBIServiceError('Missing tenant/client credentials for Fabric.', 'Fabric agent service is not configured.', 500);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope,
  });

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    cache: 'no-store',
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new PowerBIServiceError(
      `Fabric token request failed (${response.status}): ${JSON.stringify(payload)}`,
      'Authentication with Fabric failed.',
      502
    );
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new PowerBIServiceError('Fabric token missing.', 'Authentication with Fabric failed.', 502);
  }

  fabricTokenCache = {
    token: data.access_token,
    expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return data.access_token;
}

export async function getFoundryApiToken(): Promise<string> {
  const authMode = process.env.FOUNDRY_AUTH_MODE?.trim().toLowerCase();
  if (authMode === 'azure-cli' || authMode === 'azcli') {
    const cliToken = await getFoundryApiTokenFromAzureCli();
    if (cliToken) return cliToken;
    throw new PowerBIServiceError(
      'FOUNDRY_AUTH_MODE is azure-cli but Azure CLI token acquisition failed.',
      'No se pudo autenticar con Azure CLI para Foundry. Ejecuta az login y reinicia el servidor.',
      500
    );
  }

  const cached = cachedFoundryToken('sp');
  if (cached) return cached;

  const tenantId = readAzureEnv('AZURE_TENANT_ID', 'TENANT_ID');
  const clientId = readAzureEnv('AZURE_CLIENT_ID', 'CLIENT_ID');
  const clientSecret = readAzureEnv('AZURE_CLIENT_SECRET', 'CLIENT_SECRET');
  const scope = process.env.FOUNDRY_API_SCOPE ?? 'https://ai.azure.com/.default';

  if (!tenantId || !clientId || !clientSecret) {
    throw new PowerBIServiceError('Missing tenant/client credentials for Foundry.', 'Foundry agent service is not configured.', 500);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope,
  });

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    cache: 'no-store',
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new PowerBIServiceError(
      `Foundry token request failed (${response.status}): ${JSON.stringify(payload)}`,
      'Authentication with Foundry failed.',
      502
    );
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new PowerBIServiceError('Foundry token missing.', 'Authentication with Foundry failed.', 502);
  }

  foundryTokenCache = {
    token: data.access_token,
    source: 'sp',
    expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return data.access_token;
}

async function getFoundryApiTokenFromAzureCli(): Promise<string | null> {
  const cached = cachedFoundryToken('azure-cli');
  if (cached) return cached;

  try {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'cmd.exe' : 'az';
    const commandArgs = isWindows
      ? ['/d', '/s', '/c', 'az account get-access-token --resource https://ai.azure.com -o json']
      : ['account', 'get-access-token', '--resource', 'https://ai.azure.com', '-o', 'json'];

    const { stdout } = await execFileAsync(command, commandArgs, { timeout: 20_000 });

    const parsed = JSON.parse(stdout || '{}') as { accessToken?: string; expiresOn?: string };
    if (!parsed.accessToken) {
      return null;
    }

    const expiresAtMs = parsed.expiresOn ? Date.parse(parsed.expiresOn) : Date.now() + 45 * 60_000;
    foundryTokenCache = {
      token: parsed.accessToken,
      source: 'azure-cli',
      expiresAtMs: Number.isNaN(expiresAtMs) ? Date.now() + 45 * 60_000 : expiresAtMs,
    };

    return parsed.accessToken;
  } catch {
    return null;
  }
}

function extractAssistantText(payload: unknown): string {
  const record = payload as Record<string, unknown>;

  const choices = Array.isArray(record.choices) ? record.choices as Array<Record<string, unknown>> : [];
  const firstChoice = choices[0];
  if (firstChoice) {
    const msg = firstChoice.message as Record<string, unknown> | undefined;
    if (msg && typeof msg.content === 'string' && msg.content.trim()) {
      return sanitizeAssistantText(msg.content);
    }

    if (typeof firstChoice.text === 'string' && firstChoice.text.trim()) {
      return sanitizeAssistantText(firstChoice.text);
    }
  }

  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return sanitizeAssistantText(record.output_text);
  }

  const output = Array.isArray(record.output) ? record.output as Array<Record<string, unknown>> : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
    for (const fragment of content) {
      if (typeof fragment.text === 'string' && fragment.text.trim()) {
        return sanitizeAssistantText(fragment.text);
      }
    }
  }

  return 'No se recibio respuesta del agente.';
}

function sanitizeAssistantText(text: string): string {
  return text
    .replace(/【\d+:\d+†source】/g, '')
    .replace(/\[\d+:\d+†source\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractAssistantTextFromRaw(rawBody: string): string {
  if (!rawBody.trim()) return '';

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
      return sanitizeAssistantText(payload.output_text);
    }

    const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
    const messageItem = output.find((item) => item.type === 'message');
    if (messageItem) {
      const content = Array.isArray(messageItem.content) ? messageItem.content as Array<Record<string, unknown>> : [];
      const first = content[0];
      if (first && typeof first.text === 'string' && first.text.trim()) {
        return sanitizeAssistantText(first.text);
      }
    }

    const fallback = extractAssistantText(payload);
    if (fallback && fallback !== 'No se recibio respuesta del agente.') {
      return sanitizeAssistantText(fallback);
    }
  } catch {
    // Raw body isn't JSON; fallback to text directly.
  }

  return sanitizeAssistantText(rawBody.trim());
}

function isFoundryPublishedResponsesEndpoint(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return normalized.includes('.services.ai.azure.com/') && normalized.includes('/protocols/openai/responses');
}

function resolveFoundryResponsesEndpoint(agentPublishedUrl: string): string | null {
  const fromEnv = process.env.FOUNDRY_RESPONSES_ENDPOINT?.trim() || process.env.AZURE_FOUNDRY_RESPONSES_ENDPOINT?.trim();
  if (fromEnv) return fromEnv;
  if (isFoundryPublishedResponsesEndpoint(agentPublishedUrl)) return agentPublishedUrl.trim();
  return null;
}

function inferFoundryPublicMessageByStatus(status: number): string {
  if (status === 400) return 'El endpoint de Foundry rechazo el formato de la consulta.';
  if (status === 401 || status === 403) return 'Foundry rechazo la autenticacion/permisos para este agente.';
  if (status === 404) return 'No se encontro el endpoint publicado de Foundry.';
  if (status === 429) return 'El agente de Foundry esta saturado temporalmente. Reintenta en unos segundos.';
  if (status >= 500) return 'El servicio de Foundry no esta disponible temporalmente.';
  return 'No fue posible consultar el agente de Foundry en este momento.';
}

async function chatWithFoundryPublishedResponses(params: {
  responsesEndpoint: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  const userMessage = latestUserQuestion(params.messages);
  if (!userMessage) {
    throw new PowerBIServiceError(
      'Foundry responses call skipped: missing user message.',
      'No se pudo construir la pregunta para el agente IA.',
      400
    );
  }

  const token = await getFoundryApiToken();
  const response = await fetch(params.responsesEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: userMessage }),
    cache: 'no-store',
  });

  const rawBody = (await safeText(response)) ?? '';
  if (!response.ok) {
    throw new PowerBIServiceError(
      `Foundry responses failed (${response.status}) on ${params.responsesEndpoint}: ${rawBody}`,
      inferFoundryPublicMessageByStatus(response.status),
      502
    );
  }

  const text = extractAssistantTextFromRaw(rawBody);
  return sanitizeAssistantText(text || 'No se recibio respuesta del agente.');
}

function buildTargetUrls(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/+$/, '');
  return [
    normalized,
    `${normalized}/chat/completions`,
    `${normalized}/v1/chat/completions`,
    `${normalized}/responses`,
  ];
}

function inferPublicMessageByStatus(status: number): string {
  if (status === 400) return 'El agente de IA rechazo el formato de la consulta.';
  if (status === 401 || status === 403) return 'Fabric rechazo la autenticacion/permisos para este agente.';
  if (status === 404) return 'No se encontro la URL publicada del agente de IA.';
  if (status === 429) return 'El agente de IA esta saturado temporalmente. Reintenta en unos segundos.';
  if (status >= 500) return 'El servicio de agente de IA no esta disponible temporalmente.';
  return 'No fue posible consultar el agente de IA en este momento.';
}

export async function chatWithFabricAgent(params: {
  publishedUrl: string;
  mcpUrl?: string;
  mcpToolName?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  const foundryResponsesEndpoint = resolveFoundryResponsesEndpoint(params.publishedUrl);
  if (foundryResponsesEndpoint) {
    return chatWithFoundryPublishedResponses({
      responsesEndpoint: foundryResponsesEndpoint,
      messages: params.messages,
    });
  }

  const token = await getFabricApiToken();
  const urls = buildTargetUrls(params.publishedUrl);
  const mcpFallbackEnabled = process.env.FABRIC_ENABLE_MCP_FALLBACK !== 'false';

  let lastStatus = 500;
  let lastPayload: unknown = null;
  let lastTextPayload: string | null = null;
  let lastUrlTried = params.publishedUrl;

  for (const url of urls) {
    lastUrlTried = url;
    const isResponsesEndpoint = url.endsWith('/responses');
    const body = isResponsesEndpoint
      ? {
          input: params.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n'),
          temperature: 0.2,
        }
      : {
          model: 'fabric-agent',
          messages: params.messages,
          temperature: 0.2,
        };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (response.ok) {
      const payload = await safeJson(response);
      return extractAssistantText(payload);
    }

    lastStatus = response.status;
    lastPayload = await safeJson(response);
    if (!lastPayload) {
      lastTextPayload = await safeText(response);
    }

    if (response.status === 404 || response.status === 405) {
      continue;
    }

    break;
  }

  if (mcpFallbackEnabled && lastStatus === 404 && params.mcpUrl) {
    const mcpResult = await chatWithFabricMcp({
      mcpUrl: params.mcpUrl,
      mcpToolName: params.mcpToolName,
      messages: params.messages,
      token,
    });
    if (mcpResult) return mcpResult;
  }

  throw new PowerBIServiceError(
    `Fabric agent chat failed (${lastStatus}) on ${lastUrlTried}: ${JSON.stringify(lastPayload ?? lastTextPayload)}`,
    inferPublicMessageByStatus(lastStatus),
    502
  );
}

async function chatWithFabricMcp(params: {
  mcpUrl: string;
  mcpToolName?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  token: string;
}): Promise<string | null> {
  const mcpUrl = params.mcpUrl.replace(/\/+$/, '');

  const toolName = params.mcpToolName ?? await resolveMcpToolName(mcpUrl, params.token);
  if (!toolName) return null;

  const userQuestion = latestUserQuestion(params.messages);
  if (!userQuestion) {
    throw new PowerBIServiceError(
      'Fabric MCP tools/call skipped: missing user question.',
      'No se pudo construir la pregunta para el agente IA.',
      400
    );
  }

  const firstText = await invokeMcpTool(mcpUrl, params.token, toolName, userQuestion);
  if (firstText && !looksLikeAgentTechnicalFailure(firstText)) {
    return firstText;
  }

  // Retry once for transient/data-source hiccups from the agent.
  await delay(900);
  const secondText = await invokeMcpTool(
    mcpUrl,
    params.token,
    toolName,
    `Responde con los datos disponibles. Pregunta del usuario: ${userQuestion}`
  );

  if (secondText && !looksLikeAgentTechnicalFailure(secondText)) {
    return secondText;
  }

  throw new PowerBIServiceError(
    `Fabric MCP agent returned technical failure message. first=${JSON.stringify(firstText)} second=${JSON.stringify(secondText)}`,
    'El agente de Fabric esta operativo, pero fallo al consultar su origen de datos.',
    502
  );
}

function latestUserQuestion(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): string | null {
  const latestUser = [...messages].reverse().find((msg) => msg.role === 'user' && msg.content.trim());
  return latestUser ? latestUser.content.trim() : null;
}

function extractMcpJsonRpcError(payload: unknown): string | null {
  const record = payload as Record<string, unknown>;
  const err = record.error as Record<string, unknown> | undefined;
  if (!err) return null;

  const message = typeof err.message === 'string' ? err.message : 'Unknown MCP error';
  const code = typeof err.code === 'number' ? err.code : null;
  return code !== null ? `code=${code}, message=${message}` : message;
}

async function resolveMcpToolName(mcpUrl: string, token: string): Promise<string | null> {
  const listResp = await fetch(mcpUrl, {
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
    cache: 'no-store',
  });

  const payload = await safeJson(listResp);
  if (!listResp.ok) return null;

  const record = payload as Record<string, unknown>;
  const result = (record.result ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(result.tools) ? result.tools as Array<Record<string, unknown>> : [];
  const first = tools[0];
  if (!first) return null;
  return typeof first.name === 'string' ? first.name : null;
}

function extractMcpText(payload: unknown): string | null {
  const record = payload as Record<string, unknown>;
  const result = (record.result ?? {}) as Record<string, unknown>;

  if (typeof result.text === 'string' && result.text.trim()) {
    return sanitizeAssistantText(result.text);
  }

  const content = Array.isArray(result.content) ? result.content as Array<Record<string, unknown>> : [];
  for (const fragment of content) {
    if (typeof fragment.text === 'string' && fragment.text.trim()) {
      return sanitizeAssistantText(fragment.text);
    }
  }

  if (typeof result.value === 'string' && result.value.trim()) {
    return sanitizeAssistantText(result.value);
  }

  return null;
}

async function invokeMcpTool(mcpUrl: string, token: string, toolName: string, userQuestion: string): Promise<string | null> {
  const callResp = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: { userQuestion },
      },
    }),
    cache: 'no-store',
  });

  const callPayload = await safeJson(callResp);
  if (!callResp.ok) {
    throw new PowerBIServiceError(
      `Fabric MCP tools/call failed (${callResp.status}): ${JSON.stringify(callPayload)}`,
      inferPublicMessageByStatus(callResp.status),
      502
    );
  }

  const jsonRpcError = extractMcpJsonRpcError(callPayload);
  if (jsonRpcError) {
    throw new PowerBIServiceError(
      `Fabric MCP tools/call returned JSON-RPC error: ${jsonRpcError}`,
      'El agente IA devolvio un error tecnico al consultar sus datos.',
      502
    );
  }

  return extractMcpText(callPayload);
}

function looksLikeAgentTechnicalFailure(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('error técnico') ||
    normalized.includes('error tecnico') ||
    normalized.includes('problema técnico') ||
    normalized.includes('problema tecnico') ||
    normalized.includes('hubo un problema técnico') ||
    normalized.includes('hubo un problema tecnico') ||
    normalized.includes('hubo un error técnico') ||
    normalized.includes('hubo un error tecnico') ||
    normalized.includes('problema temporal') ||
    normalized.includes('inconveniente temporal') ||
    normalized.includes('no se ha podido acceder a los datos') ||
    normalized.includes('error interno en el servicio') ||
    normalized.includes('intenta nuevamente más tarde') ||
    normalized.includes('intenta nuevamente mas tarde') ||
    normalized.includes('no puedo proporcionar') ||
    normalized.includes('consulta técnica') ||
    normalized.includes('consulta tecnica')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
