import { PowerBIServiceError } from '@/services/powerbi';
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

export async function getFoundryApiToken(): Promise<string> {
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
  const scope = process.env.FOUNDRY_API_SCOPE?.trim() || 'https://ai.azure.com/.default';

  if (!tenantId || !clientId || !clientSecret) {
    throw new PowerBIServiceError('Missing AZURE_* credentials for Foundry.', 'El servicio de agentes de datos no esta configurado.', 500);
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

export async function chatWithFoundryAgent(params: {
  responsesEndpoint: string;
  securityMode: 'none' | 'rls-inherit';
  userName?: string;
  rlsRoles?: string[];
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  const userMessage = latestUserQuestion(params.messages);
  if (!userMessage) {
    throw new PowerBIServiceError(
      'Foundry responses call skipped: missing user message.',
      'No se pudo construir la pregunta para el agente de datos.',
      400
    );
  }

  const token = await getFoundryApiToken();

  // Build request body: send the user message clean, pass RLS context via instructions
  // to avoid contaminating the Fabric Data Agent query with prefix metadata.
  const requestBody: Record<string, unknown> = { input: userMessage };

  if (params.securityMode === 'rls-inherit' && params.rlsRoles && params.rlsRoles.length > 0) {
    const allowedCompanies = params.rlsRoles.join(', ');
    requestBody.instructions =
      `This user (${params.userName ?? 'unknown'}) has access only to data from: ${allowedCompanies}. ` +
      `Only provide information for those companies. Do not reveal data from other companies.`;
  }

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
      `Foundry responses failed (${response.status}) on ${params.responsesEndpoint}: ${rawBody}`,
      inferFoundryPublicMessageByStatus(response.status),
      502
    );
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    return extractAssistantText(payload);
  } catch {
    return sanitizeAssistantText(rawBody || 'No se recibio respuesta del agente.');
  }
}
