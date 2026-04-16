/**
 * Validates that .env.local and .env.example stay in sync.
 *
 * - Every runtime env var referenced in source code should be documented in .env.example
 * - .env.local should not contain vars that no code consumes
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');

function parseEnvFile(filepath: string): Set<string> {
  if (!existsSync(filepath)) return new Set();
  const content = readFileSync(filepath, 'utf-8');
  const vars = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match) vars.add(match[1]);
  }
  return vars;
}

/** Env vars that the Next.js runtime actually reads (process.env.*) */
const RUNTIME_VARS = new Set([
  // Azure AD / Service Principal
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',

  // Auth.js / NextAuth (implicitly consumed by the library)
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'AUTH_MICROSOFT_ENTRA_ID_ID',
  'AUTH_MICROSOFT_ENTRA_ID_SECRET',
  'AUTH_MICROSOFT_ENTRA_ID_ISSUER',

  // Azure SQL
  'AZURE_SQL_SERVER',
  'AZURE_SQL_DATABASE',
  'AZURE_SQL_AUTH_MODE',
  'AZURE_SQL_ENCRYPT',
  'AZURE_SQL_TRUST_SERVER_CERTIFICATE',

  // Bootstrap data
  'BOOTSTRAP_ADMIN_USERNAME',
  'BOOTSTRAP_ADMIN_EMAIL',
  'BOOTSTRAP_REPORTS_JSON',
  'BOOTSTRAP_USERS_JSON',
  'BOOTSTRAP_AI_AGENTS_JSON',

  // Foundry runtime
  'FOUNDRY_API_SCOPE',
  'FOUNDRY_AUTH_MODE',
]);

/** Vars that are optional / conditional and don't need to be in .env.local */
const OPTIONAL_VARS = new Set([
  'AZURE_SQL_USER',       // only if AZURE_SQL_AUTH_MODE=sql
  'AZURE_SQL_PASSWORD',   // only if AZURE_SQL_AUTH_MODE=sql
  'BOOTSTRAP_CLIENTS_JSON',
  'POWERBI_RLS_ADMIN_USERNAME',
  'NODE_ENV',
]);

describe('.env files consistency', () => {
  it('.env.example exists', () => {
    expect(existsSync(join(root, '.env.example'))).toBe(true);
  });

  it('.env.local exists', () => {
    if (process.env.CI) return; // .env.local is gitignored, not present in CI
    expect(existsSync(join(root, '.env.local'))).toBe(true);
  });

  it('every runtime var is documented in .env.example', () => {
    const example = parseEnvFile(join(root, '.env.example'));
    const missing: string[] = [];
    for (const v of RUNTIME_VARS) {
      if (!example.has(v) && !OPTIONAL_VARS.has(v)) {
        missing.push(v);
      }
    }
    expect(missing, `Missing from .env.example: ${missing.join(', ')}`).toEqual([]);
  });

  // .env.local is gitignored and not present in CI — skip these checks in CI
  const runLocalTests = !process.env.CI;

  it('.env.local only contains runtime vars (no orphan provisioning vars)', () => {
    if (!runLocalTests) return;
    const local = parseEnvFile(join(root, '.env.local'));
    const allowed = new Set([...RUNTIME_VARS, ...OPTIONAL_VARS]);
    const orphans: string[] = [];
    for (const v of local) {
      if (!allowed.has(v)) orphans.push(v);
    }
    expect(orphans, `Orphan vars in .env.local: ${orphans.join(', ')}`).toEqual([]);
  });

  it('.env.local has all required runtime vars', () => {
    if (!runLocalTests) return;
    const local = parseEnvFile(join(root, '.env.local'));
    const missing: string[] = [];
    for (const v of RUNTIME_VARS) {
      if (!local.has(v) && !OPTIONAL_VARS.has(v)) {
        missing.push(v);
      }
    }
    expect(missing, `Missing from .env.local: ${missing.join(', ')}`).toEqual([]);
  });
});
