import { PowerBIServiceError } from '@/services/powerbi';

interface FabricTokenCache {
  token: string;
  expiresAtMs: number;
}

let fabricTokenCache: FabricTokenCache | null = null;

function cachedFabricToken(): string | null {
  if (!fabricTokenCache) return null;
  if (Date.now() + 60_000 >= fabricTokenCache.expiresAtMs) return null;
  return fabricTokenCache.token;
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

export async function getFabricApiToken(): Promise<string> {
  const cached = cachedFabricToken();
  if (cached) return cached;

  const tenantId = process.env.TENANT_ID;
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
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

function extractAssistantText(payload: unknown): string {
  const record = payload as Record<string, unknown>;

  const choices = Array.isArray(record.choices) ? record.choices as Array<Record<string, unknown>> : [];
  const firstChoice = choices[0];
  if (firstChoice) {
    const msg = firstChoice.message as Record<string, unknown> | undefined;
    if (msg && typeof msg.content === 'string' && msg.content.trim()) {
      return msg.content;
    }

    if (typeof firstChoice.text === 'string' && firstChoice.text.trim()) {
      return firstChoice.text;
    }
  }

  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text;
  }

  const output = Array.isArray(record.output) ? record.output as Array<Record<string, unknown>> : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
    for (const fragment of content) {
      if (typeof fragment.text === 'string' && fragment.text.trim()) {
        return fragment.text;
      }
    }
  }

  return 'No se recibio respuesta del agente.';
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
    return result.text;
  }

  const content = Array.isArray(result.content) ? result.content as Array<Record<string, unknown>> : [];
  for (const fragment of content) {
    if (typeof fragment.text === 'string' && fragment.text.trim()) {
      return fragment.text;
    }
  }

  if (typeof result.value === 'string' && result.value.trim()) {
    return result.value;
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
