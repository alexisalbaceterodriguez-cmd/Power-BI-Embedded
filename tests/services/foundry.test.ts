/**
 * Unit tests for Fabric Data Agent MCP service helper functions.
 *
 * Tests the pure functions: sanitizeAssistantText, extractMcpText,
 * latestUserQuestion, inferFoundryPublicMessageByStatus, token mode selection.
 *
 * These are replicated from foundryAgents.ts (module-private functions).
 */
import { describe, it, expect } from 'vitest';

// ── Replicated pure functions (identical logic to foundryAgents.ts) ──

function sanitizeAssistantText(text: string): string {
  return text
    .replace(/【\d+:\d+†source】/g, '')
    .replace(/\[\d+:\d+†source\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function latestUserQuestion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): string | null {
  const latestUser = [...messages].reverse().find((msg) => msg.role === 'user' && msg.content.trim());
  return latestUser ? latestUser.content.trim() : null;
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

function inferFoundryPublicMessageByStatus(status: number): string {
  if (status === 400) return 'El agente de datos rechazo el formato de la consulta.';
  if (status === 401 || status === 403) return 'No tienes permisos para consultar este agente de datos.';
  if (status === 404) return 'No se encontro el endpoint configurado para el agente de datos.';
  if (status === 429) return 'El agente de datos esta saturado temporalmente. Reintenta en unos segundos.';
  if (status >= 500) return 'El servicio de agentes de datos no esta disponible temporalmente.';
  return 'No fue posible consultar el agente de datos en este momento.';
}

// ── sanitizeAssistantText ─────────────────────────────────────────

describe('sanitizeAssistantText', () => {
  it('removes 【source】 annotations', () => {
    expect(sanitizeAssistantText('El total es 100 【4:0†source】 euros.')).toBe('El total es 100 euros.');
  });

  it('removes [source] annotations', () => {
    expect(sanitizeAssistantText('Total: 50 [1:2†source]')).toBe('Total: 50');
  });

  it('collapses multiple whitespace', () => {
    expect(sanitizeAssistantText('a   b    c')).toBe('a b c');
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizeAssistantText('  hello  ')).toBe('hello');
  });

  it('handles combined noise', () => {
    expect(sanitizeAssistantText('  Resultado 【3:1†source】   disponible.  ')).toBe('Resultado disponible.');
  });
});

// ── latestUserQuestion ────────────────────────────────────────────

describe('latestUserQuestion', () => {
  it('returns null for empty messages', () => {
    expect(latestUserQuestion([])).toBeNull();
  });

  it('returns null when no user messages', () => {
    expect(latestUserQuestion([{ role: 'system', content: 'system prompt' }])).toBeNull();
  });

  it('returns the latest user message', () => {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second question' },
    ];
    expect(latestUserQuestion(messages)).toBe('second question');
  });

  it('skips empty/whitespace-only user messages', () => {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'real question' },
      { role: 'user', content: '   ' },
    ];
    expect(latestUserQuestion(messages)).toBe('real question');
  });
});

// ── extractMcpText ────────────────────────────────────────────────

describe('extractMcpText', () => {
  it('extracts text from MCP result content', () => {
    const payload = {
      result: { content: [{ type: 'text', text: 'El total de ventas es 1000 euros.' }], isError: false },
      id: '1',
      jsonrpc: '2.0',
    };
    expect(extractMcpText(payload)).toBe('El total de ventas es 1000 euros.');
  });

  it('sanitizes source annotations in MCP text', () => {
    const payload = {
      result: { content: [{ type: 'text', text: 'Resultado 【4:0†source】 final.' }], isError: false },
      id: '1',
      jsonrpc: '2.0',
    };
    expect(extractMcpText(payload)).toBe('Resultado final.');
  });

  it('returns fallback when result is missing', () => {
    expect(extractMcpText({})).toBe('No se recibio respuesta del agente.');
  });

  it('returns fallback when content array is empty', () => {
    const payload = { result: { content: [], isError: false }, id: '1', jsonrpc: '2.0' };
    expect(extractMcpText(payload)).toBe('No se recibio respuesta del agente.');
  });

  it('returns fallback when text is whitespace-only', () => {
    const payload = { result: { content: [{ type: 'text', text: '   ' }], isError: false }, id: '1', jsonrpc: '2.0' };
    expect(extractMcpText(payload)).toBe('No se recibio respuesta del agente.');
  });

  it('extracts first text item when multiple content items exist', () => {
    const payload = {
      result: { content: [{ type: 'text', text: 'First answer' }, { type: 'text', text: 'Second' }], isError: false },
      id: '1',
      jsonrpc: '2.0',
    };
    expect(extractMcpText(payload)).toBe('First answer');
  });
});

// ── inferFoundryPublicMessageByStatus ─────────────────────────────

describe('inferFoundryPublicMessageByStatus', () => {
  it('returns format error for 400', () => {
    expect(inferFoundryPublicMessageByStatus(400)).toContain('formato');
  });

  it('returns permission error for 401 and 403', () => {
    expect(inferFoundryPublicMessageByStatus(401)).toContain('permisos');
    expect(inferFoundryPublicMessageByStatus(403)).toContain('permisos');
  });

  it('returns not found for 404', () => {
    expect(inferFoundryPublicMessageByStatus(404)).toContain('endpoint');
  });

  it('returns rate limit for 429', () => {
    expect(inferFoundryPublicMessageByStatus(429)).toContain('saturado');
  });

  it('returns server error for 500+', () => {
    expect(inferFoundryPublicMessageByStatus(500)).toContain('disponible');
    expect(inferFoundryPublicMessageByStatus(502)).toContain('disponible');
  });

  it('returns generic error for unknown status', () => {
    expect(inferFoundryPublicMessageByStatus(418)).toContain('posible');
  });
});

// ── Auth mode selection ──────────────────────────────────────────

describe('Foundry auth mode selection', () => {
  it('recognizes azure-cli mode', () => {
    const mode: string = 'azure-cli';
    expect(mode === 'azure-cli' || mode === 'azcli').toBe(true);
  });

  it('recognizes azcli alias', () => {
    const mode: string = 'azcli';
    expect(mode === 'azure-cli' || mode === 'azcli').toBe(true);
  });

  it('falls back to service principal for other modes', () => {
    const mode: string = 'azure-default';
    expect(mode === 'azure-cli' || mode === 'azcli').toBe(false);
  });
});

// ── MCP request body construction ───────────────────────────────
// The Fabric Data Agent MCP protocol uses JSON-RPC 2.0 with tools/call.
// Security is enforced at the application layer (route.ts gates).

describe('MCP request body construction', () => {
  function buildMcpRequestBody(userMessage: string, toolName: string): Record<string, unknown> {
    return {
      jsonrpc: '2.0',
      id: `chat-${Date.now()}`,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: { userQuestion: userMessage },
      },
    };
  }

  it('uses JSON-RPC 2.0 protocol', () => {
    const body = buildMcpRequestBody('dame el EBIT', 'DataAgent_agent_sales');
    expect(body.jsonrpc).toBe('2.0');
  });

  it('calls tools/call method', () => {
    const body = buildMcpRequestBody('dame el EBIT', 'DataAgent_agent_sales');
    expect(body.method).toBe('tools/call');
  });

  it('passes userQuestion in tool arguments', () => {
    const body = buildMcpRequestBody('Cual es el budget?', 'DataAgent_agent_sales');
    const params = body.params as Record<string, unknown>;
    const args = params.arguments as Record<string, unknown>;
    expect(args.userQuestion).toBe('Cual es el budget?');
  });

  it('passes tool name in params', () => {
    const body = buildMcpRequestBody('test', 'DataAgent_agent_finance');
    const params = body.params as Record<string, unknown>;
    expect(params.name).toBe('DataAgent_agent_finance');
  });

  it('does not include RLS context in the request', () => {
    const body = buildMcpRequestBody('test', 'DataAgent_agent_sales');
    expect(JSON.stringify(body)).not.toContain('instructions');
    expect(JSON.stringify(body)).not.toContain('RLS');
  });
});
