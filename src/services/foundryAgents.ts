import { PowerBIServiceError } from '@/services/powerbi';
import type { AgentType } from '@/lib/db/types';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface FoundryTokenCache {
  token: string;
  source: 'sp' | 'azure-cli';
  expiresAtMs: number;
}

let foundryTokenCache: FoundryTokenCache | null = null;

function cachedFoundryToken(expectedSource?: 'sp' | 'azure-cli'): string | null {
  if (!foundryTokenCache) return null;
  if (Date.now() + 60_000 >= foundryTokenCache.expiresAtMs) return null;
  if (expectedSource && foundryTokenCache.source !== expectedSource) return null;
  return foundryTokenCache.token;
}

async function safeText(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return text || null;
  } catch {
    return null;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function sanitizeAssistantText(text: string): string {
  return text
    .replace(/【\d+:\d+†source】/g, '')
    .replace(/\[\d+:\d+†source\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function latestUserQuestion(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): string | null {
  const latestUser = [...messages].reverse().find((msg) => msg.role === 'user' && msg.content.trim());
  return latestUser ? latestUser.content.trim() : null;
}

function buildConversationPrompt(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): string {
  const normalized = messages
    .map((msg) => ({ role: msg.role, content: msg.content.trim() }))
    .filter((msg) => Boolean(msg.content));

  const latestUser = latestUserQuestion(normalized);
  if (!latestUser) return '';

  // Keep a short rolling memory to avoid oversized prompts while preserving context.
  const history = normalized.slice(-12, -1);
  if (history.length === 0) return latestUser;

  const formattedHistory = history
    .map((msg) => {
      const label = msg.role === 'assistant' ? 'Asistente' : msg.role === 'system' ? 'Sistema' : 'Usuario';
      return `${label}: ${msg.content}`;
    })
    .join('\n');

  return [
    'Contexto de conversacion previa (utilizalo para responder con continuidad):',
    formattedHistory,
    '',
    `Pregunta actual del usuario: ${latestUser}`,
  ].join('\n');
}

function extractAssistantText(payload: unknown): string {
  const record = payload as Record<string, unknown>;

  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return sanitizeAssistantText(record.output_text);
  }

  const output = Array.isArray(record.output) ? (record.output as Array<Record<string, unknown>>) : [];
  const messageItem = output.find((item) => item.type === 'message');
  if (messageItem) {
    const content = Array.isArray(messageItem.content) ? (messageItem.content as Array<Record<string, unknown>>) : [];
    for (const fragment of content) {
      if (typeof fragment.text === 'string' && fragment.text.trim()) {
        return sanitizeAssistantText(fragment.text);
      }
    }
  }

  const choices = Array.isArray(record.choices) ? (record.choices as Array<Record<string, unknown>>) : [];
  if (choices[0]) {
    const first = choices[0];
    const message = first.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === 'string' && message.content.trim()) {
      return sanitizeAssistantText(message.content);
    }
    if (typeof first.text === 'string' && first.text.trim()) {
      return sanitizeAssistantText(first.text);
    }
  }

  return 'No se recibio respuesta del agente.';
}

function inferFoundryPublicMessageByStatus(status: number): string {
  if (status === 400) return 'El agente de datos rechazo el formato de la consulta.';
  if (status === 401 || status === 403) return 'No tienes permisos para consultar este agente de datos.';
  if (status === 404) return 'No se encontro el endpoint configurado para el agente de datos.';
  if (status === 429) return 'El agente de datos esta saturado temporalmente. Reintenta en unos segundos.';
  if (status >= 500) return 'El servicio de agentes de datos no esta disponible temporalmente.';
  return 'No fue posible consultar el agente de datos en este momento.';
}

const FABRIC_SCOPE = 'https://api.fabric.microsoft.com/.default';
const FOUNDRY_SCOPE = 'https://ai.azure.com/.default';

function scopeForAgentType(agentType: AgentType): string {
  return agentType === 'foundry-responses' ? FOUNDRY_SCOPE : FABRIC_SCOPE;
}

export async function getFoundryApiToken(scope?: string): Promise<string> {
  const effectiveScope = scope ?? FABRIC_SCOPE;
  const authMode = process.env.FOUNDRY_AUTH_MODE?.trim().toLowerCase();
  if (authMode === 'azure-cli' || authMode === 'azcli') {
    const cliToken = await getFoundryApiTokenFromAzureCli();
    if (cliToken) return cliToken;
    throw new PowerBIServiceError(
      'FOUNDRY_AUTH_MODE is azure-cli but Azure CLI token acquisition failed.',
      'No se pudo autenticar el servicio de agentes de datos. Ejecuta az login y reinicia el servidor.',
      500
    );
  }

  const cached = cachedFoundryToken('sp');
  if (cached) return cached;

  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();

  if (!tenantId || !clientId || !clientSecret) {
    throw new PowerBIServiceError('Missing AZURE_* credentials for Foundry.', 'El servicio de agentes de datos no esta configurado.', 500);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: effectiveScope,
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
      'No se pudo autenticar el servicio de agentes de datos.',
      502
    );
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new PowerBIServiceError('Foundry token missing.', 'No se pudo autenticar el servicio de agentes de datos.', 502);
  }

  foundryTokenCache = {
    token: data.access_token,
    source: 'sp',
    expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return data.access_token;
}

// ── OBO: exchange user's Entra ID token for a target-scoped token ──
async function exchangeTokenViaOBO(userAccessToken: string, scope?: string): Promise<string> {
  const effectiveScope = scope ?? FABRIC_SCOPE;
  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = (process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? process.env.AZURE_CLIENT_ID)?.trim();
  const clientSecret = (process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? process.env.AZURE_CLIENT_SECRET)?.trim();

  if (!tenantId || !clientId || !clientSecret) {
    throw new PowerBIServiceError('Missing credentials for OBO token exchange.', 'No se pudo autenticar el servicio de agentes de datos.', 500);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: userAccessToken,
    scope: effectiveScope,
    requested_token_use: 'on_behalf_of',
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
      `OBO token exchange failed (${response.status}): ${JSON.stringify(payload)}`,
      'No se pudo obtener un token delegado para el agente de datos.',
      502
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new PowerBIServiceError('OBO token exchange returned no access_token.', 'No se pudo obtener un token delegado para el agente de datos.', 502);
  }

  return data.access_token;
}

async function getFoundryApiTokenFromAzureCli(): Promise<string | null> {
  const cached = cachedFoundryToken('azure-cli');
  if (cached) return cached;

  try {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'cmd.exe' : 'az';
    const commandArgs = isWindows
      ? ['/d', '/s', '/c', 'az account get-access-token --resource https://api.fabric.microsoft.com -o json']
      : ['account', 'get-access-token', '--resource', 'https://api.fabric.microsoft.com', '-o', 'json'];

    const { stdout } = await execFileAsync(command, commandArgs, { timeout: 20_000 });
    const parsed = JSON.parse(stdout || '{}') as { accessToken?: string; expiresOn?: string };
    if (!parsed.accessToken) return null;

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

// ── MCP tool name cache (per-endpoint) ──
const mcpToolNameCache = new Map<string, string>();

async function discoverMcpToolName(endpoint: string, token: string): Promise<string> {
  const cached = mcpToolNameCache.get(endpoint);
  if (cached) return cached;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'discover', method: 'tools/list', params: {} }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new PowerBIServiceError(
      `MCP tools/list failed (${response.status}) on ${endpoint}`,
      inferFoundryPublicMessageByStatus(response.status),
      502
    );
  }

  const data = (await response.json()) as { result?: { tools?: Array<{ name: string }> } };
  const toolName = data.result?.tools?.[0]?.name;
  if (!toolName) {
    throw new PowerBIServiceError(
      `MCP tools/list returned no tools for ${endpoint}`,
      'No se encontro el agente de datos configurado.',
      502
    );
  }

  mcpToolNameCache.set(endpoint, toolName);
  return toolName;
}

function extractMcpText(payload: unknown): string {
  const record = payload as Record<string, unknown>;
  const result = record.result as Record<string, unknown> | undefined;
  if (!result) return 'No se recibio respuesta del agente.';

  const content = Array.isArray(result.content) ? (result.content as Array<Record<string, unknown>>) : [];
  for (const item of content) {
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      return sanitizeAssistantText(item.text);
    }
  }

  return 'No se recibio respuesta del agente.';
}

export async function chatWithFoundryAgent(params: {
  responsesEndpoint: string;
  securityMode: 'none' | 'rls-inherit';
  userName?: string;
  rlsRoles?: string[];
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  userAccessToken?: string;
}): Promise<string> {
  const conversationPrompt = buildConversationPrompt(params.messages);
  if (!conversationPrompt) {
    throw new PowerBIServiceError(
      'Foundry responses call skipped: missing user message.',
      'No se pudo construir la pregunta para el agente de datos.',
      400
    );
  }

  // Prefer OBO (user token → Fabric token), fall back to SP / azure-cli token.
  let token: string;
  if (params.userAccessToken) {
    try {
      token = await exchangeTokenViaOBO(params.userAccessToken, FABRIC_SCOPE);
    } catch (oboError) {
      console.warn('[foundryAgents] OBO exchange failed, falling back to SP token:', oboError instanceof Error ? oboError.message : oboError);
      token = await getFoundryApiToken(FABRIC_SCOPE);
    }
  } else {
    token = await getFoundryApiToken(FABRIC_SCOPE);
  }

  const toolName = await discoverMcpToolName(params.responsesEndpoint, token);

  // MCP JSON-RPC 2.0 tools/call — security is enforced at the application layer (route.ts gates).
  const requestBody = {
    jsonrpc: '2.0',
    id: `chat-${Date.now()}`,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: { userQuestion: conversationPrompt },
    },
  };

  const response = await fetch(params.responsesEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    cache: 'no-store',
  });

  const rawBody = (await safeText(response)) ?? '';
  if (!response.ok) {
    throw new PowerBIServiceError(
      `MCP tools/call failed (${response.status}) on ${params.responsesEndpoint}: ${rawBody}`,
      inferFoundryPublicMessageByStatus(response.status),
      502
    );
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    // Check for MCP-level errors
    if (payload.error) {
      const err = payload.error as Record<string, unknown>;
      throw new PowerBIServiceError(
        `MCP error: ${JSON.stringify(err)}`,
        'El agente de datos devolvio un error al procesar la consulta.',
        502
      );
    }

    const result = payload.result as Record<string, unknown> | undefined;
    if (result?.isError === true) {
      throw new PowerBIServiceError(
        `MCP tool error: ${JSON.stringify(result)}`,
        'El agente de datos no pudo procesar la consulta.',
        502
      );
    }

    return extractMcpText(payload);
  } catch (err) {
    if (err instanceof PowerBIServiceError) throw err;
    return sanitizeAssistantText(rawBody || 'No se recibio respuesta del agente.');
  }
}

// ── Azure AI Foundry Responses API chat ──────────────────────────────────────

async function chatWithFoundryResponses(params: {
  responsesEndpoint: string;
  securityMode: 'none' | 'rls-inherit';
  userName?: string;
  rlsRoles?: string[];
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  userAccessToken?: string;
}): Promise<string> {
  const conversationPrompt = buildConversationPrompt(params.messages);
  if (!conversationPrompt) {
    throw new PowerBIServiceError(
      'Foundry responses call skipped: missing user message.',
      'No se pudo construir la pregunta para el agente de datos.',
      400
    );
  }

  let token: string;
  if (params.userAccessToken) {
    try {
      token = await exchangeTokenViaOBO(params.userAccessToken, FOUNDRY_SCOPE);
    } catch (oboError) {
      console.warn('[foundryAgents] OBO exchange failed for Foundry Responses, falling back to SP token:', oboError instanceof Error ? oboError.message : oboError);
      token = await getFoundryApiToken(FOUNDRY_SCOPE);
    }
  } else {
    token = await getFoundryApiToken(FOUNDRY_SCOPE);
  }

  const response = await fetch(params.responsesEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: conversationPrompt }),
    cache: 'no-store',
  });

  const rawBody = (await safeText(response)) ?? '';
  if (!response.ok) {
    throw new PowerBIServiceError(
      `Foundry Responses API failed (${response.status}) on ${params.responsesEndpoint}: ${rawBody}`,
      inferFoundryPublicMessageByStatus(response.status),
      502
    );
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    return extractAssistantText(payload);
  } catch {
    return sanitizeAssistantText(rawBody || 'No se recibio respuesta del agente.');
  }
}

// ── Unified dispatcher: routes to the correct protocol based on agentType ──

export async function chatWithAgent(params: {
  agentType: AgentType;
  responsesEndpoint: string;
  securityMode: 'none' | 'rls-inherit';
  userName?: string;
  rlsRoles?: string[];
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  userAccessToken?: string;
}): Promise<string> {
  if (params.agentType === 'foundry-responses') {
    return chatWithFoundryResponses(params);
  }
  return chatWithFoundryAgent(params);
}
