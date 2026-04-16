/**
 * Unit tests for bootstrap JSON parsing logic.
 *
 * We test the parsing logic by directly invoking the same patterns
 * used in src/lib/db/bootstrap.ts (env-var parsing, JSON → typed arrays).
 * These functions are module-private, so we replicate the parsing logic
 * here to ensure the contract is solid.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Replicated parsing logic (mirrors bootstrap.ts exactly) ──────

function getBootstrapReports(): Array<{
  id: string;
  displayName: string;
  clientId?: string;
  workspaceId: string;
  reportId: string;
  rlsRoles?: string[];
  adminRlsRoles?: string[];
  isActive?: boolean;
}> {
  const fromEnv = process.env.BOOTSTRAP_REPORTS_JSON;
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // no-op
    }
  }
  return [];
}

function getBootstrapUsers(): Array<{
  username: string;
  email?: string;
  role: string;
  reportIds?: string[];
  rlsRoles?: string[];
}> {
  const fromEnv = process.env.BOOTSTRAP_USERS_JSON;
  if (!fromEnv) return [];
  try {
    const parsed = JSON.parse(fromEnv);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getBootstrapAIAgents(): Array<{
  name: string;
  responsesEndpoint: string;
  reportIds: string[];
}> {
  const fromEnv = process.env.BOOTSTRAP_AI_AGENTS_JSON;
  if (!fromEnv) return [];
  try {
    const parsed = JSON.parse(fromEnv);
    if (!Array.isArray(parsed)) return [];
    const output: Array<{ name: string; responsesEndpoint: string; reportIds: string[] }> = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const responsesEndpoint =
        (typeof entry.responsesEndpoint === 'string' ? entry.responsesEndpoint : undefined) ??
        (typeof entry.publishedUrl === 'string' ? entry.publishedUrl : undefined) ??
        '';
      if (!responsesEndpoint.trim()) continue;
      output.push({
        name: typeof entry.name === 'string' ? entry.name : 'foundry-agent',
        responsesEndpoint,
        reportIds: Array.isArray(entry.reportIds)
          ? entry.reportIds.filter((v: unknown): v is string => typeof v === 'string')
          : [],
      });
    }
    return output;
  } catch {
    return [];
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('getBootstrapReports', () => {
  const original = process.env.BOOTSTRAP_REPORTS_JSON;
  afterEach(() => {
    if (original !== undefined) process.env.BOOTSTRAP_REPORTS_JSON = original;
    else delete process.env.BOOTSTRAP_REPORTS_JSON;
  });

  it('returns empty array when env var missing', () => {
    delete process.env.BOOTSTRAP_REPORTS_JSON;
    expect(getBootstrapReports()).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    process.env.BOOTSTRAP_REPORTS_JSON = 'not-json';
    expect(getBootstrapReports()).toEqual([]);
  });

  it('returns empty array for non-array JSON', () => {
    process.env.BOOTSTRAP_REPORTS_JSON = '{"id":"x"}';
    expect(getBootstrapReports()).toEqual([]);
  });

  it('parses valid reports JSON', () => {
    process.env.BOOTSTRAP_REPORTS_JSON = JSON.stringify([
      {
        id: 'test-report',
        displayName: 'Test Report',
        workspaceId: 'ws-1',
        reportId: 'rpt-1',
        rlsRoles: ['Role A'],
      },
    ]);
    const reports = getBootstrapReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].id).toBe('test-report');
    expect(reports[0].rlsRoles).toEqual(['Role A']);
  });
});

describe('getBootstrapUsers', () => {
  const original = process.env.BOOTSTRAP_USERS_JSON;
  afterEach(() => {
    if (original !== undefined) process.env.BOOTSTRAP_USERS_JSON = original;
    else delete process.env.BOOTSTRAP_USERS_JSON;
  });

  it('returns empty array when env var missing', () => {
    delete process.env.BOOTSTRAP_USERS_JSON;
    expect(getBootstrapUsers()).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    process.env.BOOTSTRAP_USERS_JSON = '{broken';
    expect(getBootstrapUsers()).toEqual([]);
  });

  it('parses valid users JSON', () => {
    process.env.BOOTSTRAP_USERS_JSON = JSON.stringify([
      { username: 'alice', email: 'alice@test.com', role: 'client', reportIds: ['r1'] },
    ]);
    const users = getBootstrapUsers();
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('alice');
  });
});

describe('getBootstrapAIAgents', () => {
  const original = process.env.BOOTSTRAP_AI_AGENTS_JSON;
  afterEach(() => {
    if (original !== undefined) process.env.BOOTSTRAP_AI_AGENTS_JSON = original;
    else delete process.env.BOOTSTRAP_AI_AGENTS_JSON;
  });

  it('returns empty array when env var missing', () => {
    delete process.env.BOOTSTRAP_AI_AGENTS_JSON;
    expect(getBootstrapAIAgents()).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    process.env.BOOTSTRAP_AI_AGENTS_JSON = 'nope';
    expect(getBootstrapAIAgents()).toEqual([]);
  });

  it('skips agents without responsesEndpoint', () => {
    process.env.BOOTSTRAP_AI_AGENTS_JSON = JSON.stringify([
      { name: 'no-endpoint', reportIds: ['r1'] },
    ]);
    expect(getBootstrapAIAgents()).toEqual([]);
  });

  it('parses valid agents JSON', () => {
    process.env.BOOTSTRAP_AI_AGENTS_JSON = JSON.stringify([
      {
        name: 'agent-1',
        responsesEndpoint: 'https://example.com/responses',
        reportIds: ['report-1'],
      },
    ]);
    const agents = getBootstrapAIAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('agent-1');
    expect(agents[0].responsesEndpoint).toBe('https://example.com/responses');
    expect(agents[0].reportIds).toEqual(['report-1']);
  });

  it('falls back to publishedUrl when responsesEndpoint is missing', () => {
    process.env.BOOTSTRAP_AI_AGENTS_JSON = JSON.stringify([
      {
        name: 'legacy-agent',
        publishedUrl: 'https://example.com/legacy',
        reportIds: ['r1'],
      },
    ]);
    const agents = getBootstrapAIAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].responsesEndpoint).toBe('https://example.com/legacy');
  });

  it('uses default name when name is not a string', () => {
    process.env.BOOTSTRAP_AI_AGENTS_JSON = JSON.stringify([
      { responsesEndpoint: 'https://example.com/ep', reportIds: [] },
    ]);
    const agents = getBootstrapAIAgents();
    expect(agents[0].name).toBe('foundry-agent');
  });
});
