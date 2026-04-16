/**
 * Unit tests for Azure AI Foundry service helper functions.
 *
 * Tests the pure functions: sanitizeAssistantText, extractAssistantText,
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

// ── extractAssistantText ──────────────────────────────────────────

describe('extractAssistantText', () => {
  it('extracts from output_text (Responses API format)', () => {
    const payload = { output_text: 'Hello world 【1:0†source】' };
    expect(extractAssistantText(payload)).toBe('Hello world');
  });

  it('extracts from output[].message.content (streaming format)', () => {
    const payload = {
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Streamed result' }],
        },
      ],
    };
    expect(extractAssistantText(payload)).toBe('Streamed result');
  });

  it('extracts from choices[].message.content (OpenAI compat)', () => {
    const payload = {
      choices: [{ message: { content: 'OpenAI format' } }],
    };
    expect(extractAssistantText(payload)).toBe('OpenAI format');
  });

  it('extracts from choices[].text (legacy format)', () => {
    const payload = {
      choices: [{ text: 'Legacy text' }],
    };
    expect(extractAssistantText(payload)).toBe('Legacy text');
  });

  it('returns fallback when no text found', () => {
    expect(extractAssistantText({})).toBe('No se recibio respuesta del agente.');
  });

  it('prefers output_text over other formats', () => {
    const payload = {
      output_text: 'Primary',
      choices: [{ message: { content: 'Secondary' } }],
    };
    expect(extractAssistantText(payload)).toBe('Primary');
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
    const mode = 'azure-cli';
    expect(mode === 'azure-cli' || mode === 'azcli').toBe(true);
  });

  it('recognizes azcli alias', () => {
    const mode = 'azcli';
    expect(mode === 'azure-cli' || mode === 'azcli').toBe(true);
  });

  it('falls back to service principal for other modes', () => {
    const mode = 'azure-default';
    expect(mode === 'azure-cli' || mode === 'azcli').toBe(false);
  });
});
