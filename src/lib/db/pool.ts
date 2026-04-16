import 'server-only';

import sql, { ConnectionPool, IResult } from 'mssql';

let pool: ConnectionPool | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var for Azure SQL backend: ${name}`);
  return value;
}

function getBoolEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  return value === 'true' || value === '1' || value === 'yes';
}

function buildSqlConfig(): sql.config {
  const authMode = (process.env.AZURE_SQL_AUTH_MODE ?? 'azure-default').trim().toLowerCase();

  const base: sql.config = {
    server: getRequiredEnv('AZURE_SQL_SERVER'),
    database: getRequiredEnv('AZURE_SQL_DATABASE'),
    options: {
      encrypt: getBoolEnv('AZURE_SQL_ENCRYPT', true),
      trustServerCertificate: getBoolEnv('AZURE_SQL_TRUST_SERVER_CERTIFICATE', false),
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };

  if (authMode === 'sql') {
    return {
      ...base,
      user: getRequiredEnv('AZURE_SQL_USER'),
      password: getRequiredEnv('AZURE_SQL_PASSWORD'),
    };
  }

  return {
    ...base,
    authentication: {
      type: 'azure-active-directory-default',
      options: {},
    },
  };
}

export async function getPool(): Promise<ConnectionPool> {
  if (pool) return pool;
  pool = await new sql.ConnectionPool(buildSqlConfig()).connect();
  return pool;
}

export async function queryRows<T>(query: string, binder?: (request: sql.Request) => void): Promise<T[]> {
  const p = await getPool();
  const request = p.request();
  binder?.(request);
  const result: IResult<T> = await request.query(query);
  return result.recordset;
}

export async function queryOne<T>(query: string, binder?: (request: sql.Request) => void): Promise<T | undefined> {
  const rows = await queryRows<T>(query, binder);
  return rows[0];
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim();
}

export function normalizeClientId(clientId?: string | null): string | undefined {
  if (!clientId) return undefined;
  const normalized = clientId.trim().toLowerCase();
  return normalized || undefined;
}

export function isFutureDate(value?: string | null): boolean {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

export function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function toBit(value: boolean | number): number {
  return value ? 1 : 0;
}

export function toBoolean(value: boolean | number | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  return Number(value ?? 0) === 1;
}

export function normalizeIdList(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

export { sql };
