import 'server-only';

import sql, { ConnectionPool, IResult } from 'mssql';
import { randomUUID } from 'node:crypto';
import type {
  AIAgentConfig,
  ClientConfig,
  CreateAIAgentInput,
  CreateReportInput,
  CreateUserInput,
  PublicReport,
  SecureReportConfig,
  SessionAuthUser,
  UpdateAIAgentInput,
  UpdateReportInput,
  UpdateUserInput,
  UserRole,
} from '@/lib/dal';

interface DbUser {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  client_id: string | null;
  is_active: boolean | number;
  expires_at: string | null;
}

interface DbClient {
  id: string;
  display_name: string;
  is_active: boolean | number;
}

interface DbReport {
  id: string;
  display_name: string;
  client_id: string;
  workspace_id: string;
  report_id: string;
  rls_roles_json: string | null;
  admin_rls_roles_json: string | null;
  admin_rls_username: string | null;
  is_active: boolean | number;
}

interface DbAIAgent {
  id: string;
  name: string;
  client_id: string;
  responses_endpoint: string | null;
  activity_endpoint: string | null;
  foundry_project: string | null;
  foundry_agent_name: string | null;
  foundry_agent_version: string | null;
  security_mode: 'none' | 'rls-inherit' | null;
  migration_status: 'migrated' | 'legacy' | 'manual' | null;
  published_url: string;
  mcp_url: string | null;
  mcp_tool_name: string | null;
  is_active: boolean | number;
}

let pool: ConnectionPool | null = null;
let initialized = false;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string): string {
  return username.trim();
}

function normalizeClientId(clientId?: string | null): string | undefined {
  if (!clientId) return undefined;
  const normalized = clientId.trim().toLowerCase();
  return normalized || undefined;
}

function isFutureDate(value?: string | null): boolean {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function toBit(value: boolean | number): number {
  return value ? 1 : 0;
}

function toBoolean(value: boolean | number | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  return Number(value ?? 0) === 1;
}

function normalizeIdList(values: string[]): string[] {
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

function getBootstrapReports(): CreateReportInput[] {
  const fromEnv = process.env.BOOTSTRAP_REPORTS_JSON;
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv) as CreateReportInput[];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // no-op
    }
  }

  if (process.env.WORKSPACE_ID && process.env.REPORT_ID) {
    return [{
      id: 'default-report',
      displayName: 'Default Report',
      clientId: 'cliente-1',
      workspaceId: process.env.WORKSPACE_ID,
      reportId: process.env.REPORT_ID,
      isActive: true,
    }];
  }

  return [];
}

function getBootstrapClients(): Array<{ id: string; displayName: string; isActive?: boolean }> {
  const fromEnv = process.env.BOOTSTRAP_CLIENTS_JSON;
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv) as Array<{ id: string; displayName?: string; isActive?: boolean }>;
      if (Array.isArray(parsed)) {
        return parsed
          .map((client) => ({
            id: normalizeClientId(client.id) ?? '',
            displayName: (client.displayName ?? client.id ?? '').trim(),
            isActive: client.isActive,
          }))
          .filter((client) => Boolean(client.id && client.displayName));
      }
    } catch {
      // no-op
    }
  }

  return [
    { id: 'cliente-1', displayName: 'Cliente 1', isActive: true },
    { id: 'cliente-2', displayName: 'Cliente 2', isActive: true },
  ];
}

function getBootstrapUsers(): Array<{
  id?: string;
  username: string;
  email?: string;
  role: UserRole;
  clientId?: string;
  reportIds?: string[];
  rlsRoles?: string[];
  isActive?: boolean;
  expiresAt?: string;
}> {
  const fromEnv = process.env.BOOTSTRAP_USERS_JSON;
  if (!fromEnv) return [];
  try {
    const parsed = JSON.parse(fromEnv) as unknown;
    return Array.isArray(parsed) ? parsed as Array<{
      id?: string;
      username: string;
      email?: string;
      role: UserRole;
      clientId?: string;
      reportIds?: string[];
      rlsRoles?: string[];
      isActive?: boolean;
      expiresAt?: string;
    }> : [];
  } catch {
    return [];
  }
}

function getBootstrapAIAgents(): CreateAIAgentInput[] {
  const fromEnv = process.env.BOOTSTRAP_AI_AGENTS_JSON;
  if (!fromEnv) return [];
  try {
    const parsed = JSON.parse(fromEnv) as unknown;
    if (!Array.isArray(parsed)) return [];
    const output: CreateAIAgentInput[] = [];
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
        clientId: typeof entry.clientId === 'string' ? entry.clientId : 'cliente-1',
        responsesEndpoint,
        activityEndpoint: typeof entry.activityEndpoint === 'string' ? entry.activityEndpoint : undefined,
        foundryProject: typeof entry.foundryProject === 'string' ? entry.foundryProject : undefined,
        foundryAgentName: typeof entry.foundryAgentName === 'string' ? entry.foundryAgentName : undefined,
        foundryAgentVersion: typeof entry.foundryAgentVersion === 'string' ? entry.foundryAgentVersion : undefined,
        securityMode: entry.securityMode === 'rls-inherit' ? 'rls-inherit' : 'none',
        migrationStatus: 'manual',
        reportIds: Array.isArray(entry.reportIds)
          ? entry.reportIds.filter((value): value is string => typeof value === 'string')
          : [],
        isActive: entry.isActive !== false,
      });
    }

    return output;
  } catch {
    return [];
  }
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

async function getPool(): Promise<ConnectionPool> {
  if (pool) return pool;
  pool = await new sql.ConnectionPool(buildSqlConfig()).connect();
  return pool;
}

const schemaSql = `
IF OBJECT_ID('dbo.clients', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.clients (
    id NVARCHAR(128) NOT NULL PRIMARY KEY,
    display_name NVARCHAR(256) NOT NULL,
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL,
    updated_at DATETIME2 NOT NULL
  );
END;

IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.users (
    id NVARCHAR(64) NOT NULL PRIMARY KEY,
    username NVARCHAR(128) NOT NULL UNIQUE,
    email NVARCHAR(256) NULL UNIQUE,
    password_hash NVARCHAR(512) NULL,
    role NVARCHAR(16) NOT NULL,
    is_active BIT NOT NULL DEFAULT 1,
    expires_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL,
    updated_at DATETIME2 NOT NULL
  );
END;

IF COL_LENGTH('dbo.users', 'client_id') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD client_id NVARCHAR(128) NULL;
END;

IF OBJECT_ID('dbo.reports', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.reports (
    id NVARCHAR(128) NOT NULL PRIMARY KEY,
    display_name NVARCHAR(256) NOT NULL,
    workspace_id NVARCHAR(128) NOT NULL,
    report_id NVARCHAR(128) NOT NULL,
    rls_roles_json NVARCHAR(MAX) NULL,
    admin_rls_roles_json NVARCHAR(MAX) NULL,
    admin_rls_username NVARCHAR(256) NULL,
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL,
    updated_at DATETIME2 NOT NULL
  );
END;

IF COL_LENGTH('dbo.reports', 'client_id') IS NULL
BEGIN
  ALTER TABLE dbo.reports ADD client_id NVARCHAR(128) NULL;
END;

IF OBJECT_ID('dbo.user_report_access', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_report_access (
    user_id NVARCHAR(64) NOT NULL,
    report_id NVARCHAR(128) NOT NULL,
    created_at DATETIME2 NOT NULL,
    CONSTRAINT PK_user_report_access PRIMARY KEY (user_id, report_id),
    CONSTRAINT FK_user_report_access_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE,
    CONSTRAINT FK_user_report_access_report FOREIGN KEY (report_id) REFERENCES dbo.reports(id) ON DELETE CASCADE
  );
END;

IF OBJECT_ID('dbo.user_rls_roles', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_rls_roles (
    user_id NVARCHAR(64) NOT NULL,
    role_name NVARCHAR(128) NOT NULL,
    created_at DATETIME2 NOT NULL,
    CONSTRAINT PK_user_rls_roles PRIMARY KEY (user_id, role_name),
    CONSTRAINT FK_user_rls_roles_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
  );
END;

IF OBJECT_ID('dbo.ai_agents', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ai_agents (
    id NVARCHAR(64) NOT NULL PRIMARY KEY,
    name NVARCHAR(256) NOT NULL,
    responses_endpoint NVARCHAR(2048) NULL,
    activity_endpoint NVARCHAR(2048) NULL,
    foundry_project NVARCHAR(256) NULL,
    foundry_agent_name NVARCHAR(256) NULL,
    foundry_agent_version NVARCHAR(64) NULL,
    security_mode NVARCHAR(32) NOT NULL DEFAULT 'none',
    migration_status NVARCHAR(32) NOT NULL DEFAULT 'legacy',
    published_url NVARCHAR(1024) NOT NULL,
    mcp_url NVARCHAR(1024) NULL,
    mcp_tool_name NVARCHAR(256) NULL,
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL,
    updated_at DATETIME2 NOT NULL
  );
END;

IF COL_LENGTH('dbo.ai_agents', 'client_id') IS NULL
BEGIN
  ALTER TABLE dbo.ai_agents ADD client_id NVARCHAR(128) NULL;
END;

IF COL_LENGTH('dbo.ai_agents', 'responses_endpoint') IS NULL
BEGIN
  ALTER TABLE dbo.ai_agents ADD responses_endpoint NVARCHAR(2048) NULL;
END;

IF COL_LENGTH('dbo.ai_agents', 'activity_endpoint') IS NULL
BEGIN
  ALTER TABLE dbo.ai_agents ADD activity_endpoint NVARCHAR(2048) NULL;
END;

IF COL_LENGTH('dbo.ai_agents', 'foundry_project') IS NULL
BEGIN
  ALTER TABLE dbo.ai_agents ADD foundry_project NVARCHAR(256) NULL;
END;

IF COL_LENGTH('dbo.ai_agents', 'foundry_agent_name') IS NULL
BEGIN
  ALTER TABLE dbo.ai_agents ADD foundry_agent_name NVARCHAR(256) NULL;
END;

IF COL_LENGTH('dbo.ai_agents', 'foundry_agent_version') IS NULL
BEGIN
  ALTER TABLE dbo.ai_agents ADD foundry_agent_version NVARCHAR(64) NULL;
END;

IF COL_LENGTH('dbo.ai_agents', 'security_mode') IS NULL
BEGIN
  ALTER TABLE dbo.ai_agents ADD security_mode NVARCHAR(32) NOT NULL CONSTRAINT DF_ai_agents_security_mode DEFAULT 'none';
END;

IF COL_LENGTH('dbo.ai_agents', 'migration_status') IS NULL
BEGIN
  ALTER TABLE dbo.ai_agents ADD migration_status NVARCHAR(32) NOT NULL CONSTRAINT DF_ai_agents_migration_status DEFAULT 'legacy';
END;

IF OBJECT_ID('dbo.ai_agent_reports', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ai_agent_reports (
    agent_id NVARCHAR(64) NOT NULL,
    report_id NVARCHAR(128) NOT NULL,
    created_at DATETIME2 NOT NULL,
    CONSTRAINT PK_ai_agent_reports PRIMARY KEY (agent_id, report_id),
    CONSTRAINT FK_ai_agent_reports_agent FOREIGN KEY (agent_id) REFERENCES dbo.ai_agents(id) ON DELETE CASCADE,
    CONSTRAINT FK_ai_agent_reports_report FOREIGN KEY (report_id) REFERENCES dbo.reports(id) ON DELETE CASCADE
  );
END;

IF OBJECT_ID('dbo.audit_log', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.audit_log (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    event_type NVARCHAR(128) NOT NULL,
    user_id NVARCHAR(64) NULL,
    ip NVARCHAR(128) NULL,
    detail_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL
  );
END;

IF OBJECT_ID('dbo.auth_attempts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.auth_attempts (
    attempt_key NVARCHAR(256) NOT NULL PRIMARY KEY,
    fail_count INT NOT NULL,
    lock_until DATETIME2 NULL,
    updated_at DATETIME2 NOT NULL
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_client_id' AND object_id = OBJECT_ID('dbo.users'))
BEGIN
  CREATE INDEX IX_users_client_id ON dbo.users(client_id);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_reports_client_id' AND object_id = OBJECT_ID('dbo.reports'))
BEGIN
  CREATE INDEX IX_reports_client_id ON dbo.reports(client_id);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ai_agents_client_id' AND object_id = OBJECT_ID('dbo.ai_agents'))
BEGIN
  CREATE INDEX IX_ai_agents_client_id ON dbo.ai_agents(client_id);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ai_agents_migration_status' AND object_id = OBJECT_ID('dbo.ai_agents'))
BEGIN
  CREATE INDEX IX_ai_agents_migration_status ON dbo.ai_agents(migration_status);
END;
`;

async function queryRows<T>(query: string, binder?: (request: sql.Request) => void): Promise<T[]> {
  const p = await getPool();
  const request = p.request();
  binder?.(request);
  const result: IResult<T> = await request.query(query);
  return result.recordset;
}

async function queryOne<T>(query: string, binder?: (request: sql.Request) => void): Promise<T | undefined> {
  const rows = await queryRows<T>(query, binder);
  return rows[0];
}

function userIsActive(user: DbUser): boolean {
  if (!toBoolean(user.is_active)) return false;
  if (!user.expires_at) return true;
  return isFutureDate(user.expires_at);
}

async function getUserReportIds(userId: string): Promise<string[]> {
  const rows = await queryRows<{ report_id: string }>(
    'SELECT report_id FROM user_report_access WHERE user_id = @userId',
    (request) => request.input('userId', sql.NVarChar(64), userId)
  );
  return rows.map((row) => row.report_id);
}

async function getUserRlsRoles(userId: string): Promise<string[]> {
  const rows = await queryRows<{ role_name: string }>(
    'SELECT role_name FROM user_rls_roles WHERE user_id = @userId',
    (request) => request.input('userId', sql.NVarChar(64), userId)
  );
  return rows.map((row) => row.role_name);
}

async function toSessionUser(user: DbUser): Promise<SessionAuthUser> {
  const role = user.role;
  const reportIds = role === 'admin' ? ['*'] : await getUserReportIds(user.id);
  const rlsRoles = await getUserRlsRoles(user.id);

  return {
    id: user.id,
    name: user.username,
    email: user.email ?? undefined,
    role,
    clientId: role === 'admin' ? undefined : (user.client_id ?? undefined),
    reportIds,
    rlsRoles: rlsRoles.length > 0 ? rlsRoles : undefined,
  };
}

async function ensureClientExists(clientIdRaw: string): Promise<string> {
  const clientId = normalizeClientId(clientIdRaw);
  if (!clientId) throw new Error('Client is required.');

  const exists = await queryOne<{ id: string }>(
    'SELECT TOP (1) id FROM clients WHERE id = @id AND is_active = 1',
    (request) => request.input('id', sql.NVarChar(128), clientId)
  );
  if (!exists) throw new Error(`Client not found or inactive: ${clientId}`);
  return clientId;
}

async function getReportClientId(reportId: string): Promise<string | null> {
  const row = await queryOne<{ client_id: string | null }>(
    'SELECT TOP (1) client_id FROM reports WHERE id = @reportId',
    (request) => request.input('reportId', sql.NVarChar(128), reportId)
  );
  return row?.client_id ?? null;
}

async function validateReportIdsBelongToClient(reportIds: string[], clientId: string): Promise<void> {
  const normalizedIds = normalizeIdList(reportIds);
  if (normalizedIds.length === 0) return;

  for (const reportId of normalizedIds) {
    const reportClientId = await getReportClientId(reportId);
    if (!reportClientId) throw new Error(`Report not found: ${reportId}`);
    if (reportClientId !== clientId) {
      throw new Error(`Report ${reportId} does not belong to client ${clientId}`);
    }
  }
}

async function backfillDefaultClientsAndAssignments(): Promise<void> {
  const clients = getBootstrapClients();
  for (const client of clients) {
    await queryRows(
      `IF NOT EXISTS (SELECT 1 FROM clients WHERE id = @id)
         INSERT INTO clients (id, display_name, is_active, created_at, updated_at)
         VALUES (@id, @display_name, @is_active, @created_at, @updated_at)`,
      (request) => {
        request.input('id', sql.NVarChar(128), client.id);
        request.input('display_name', sql.NVarChar(256), client.displayName);
        request.input('is_active', sql.Bit, toBit(client.isActive !== false));
        request.input('created_at', sql.DateTime2, nowIso());
        request.input('updated_at', sql.DateTime2, nowIso());
      }
    );
  }

  await queryRows(
    `UPDATE reports
     SET client_id = 'cliente-1'
     WHERE client_id IS NULL AND display_name IN ('Finance Controlling', 'Informe Webinar')`
  );

  await queryRows(
    `UPDATE reports
     SET client_id = 'cliente-2'
      WHERE client_id IS NULL AND display_name IN ('Calculadora de precio optimo', 'Calculadora de precio óptimo')`
  );

  await queryRows(
    `UPDATE reports
     SET client_id = 'cliente-1'
     WHERE client_id IS NULL`
  );

  await queryRows(
    `UPDATE users
     SET client_id = 'cliente-1'
     WHERE role <> 'admin' AND client_id IS NULL`
  );

  await queryRows(
    `UPDATE ai_agents
     SET client_id = COALESCE(
       (SELECT TOP (1) r.client_id
        FROM ai_agent_reports ar
        INNER JOIN reports r ON r.id = ar.report_id
        WHERE ar.agent_id = ai_agents.id),
       'cliente-1'
     )
     WHERE client_id IS NULL`
  );

  await queryRows(
    `UPDATE ai_agents
     SET responses_endpoint = COALESCE(responses_endpoint, published_url),
         migration_status = CASE
           WHEN migration_status IN ('migrated', 'manual') THEN migration_status
           WHEN published_url LIKE '%services.ai.azure.com%/protocols/openai/responses%' THEN 'migrated'
           ELSE 'legacy'
         END,
         security_mode = CASE
           WHEN security_mode IN ('none', 'rls-inherit') THEN security_mode
           ELSE 'none'
         END
     WHERE responses_endpoint IS NULL OR migration_status IS NULL OR security_mode IS NULL`
  );

  const forcedFoundryEndpoint =
    process.env.AZURE_FOUNDRY_RESPONSES_ENDPOINT?.trim() ||
    process.env.FOUNDRY_RESPONSES_ENDPOINT?.trim() ||
    '';

  if (forcedFoundryEndpoint) {
    await queryRows(
      `UPDATE ai_agents
       SET responses_endpoint = @responses_endpoint,
           published_url = @responses_endpoint,
           migration_status = 'migrated'
       WHERE migration_status = 'legacy'`,
      (request) => {
        request.input('responses_endpoint', sql.NVarChar(2048), forcedFoundryEndpoint);
      }
    );
  }
}

async function seedBootstrapData(): Promise<void> {
  const reportCount = await queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM reports');
  if ((reportCount?.count ?? 0) === 0) {
    for (const report of getBootstrapReports()) {
      const reportClientId = normalizeClientId(report.clientId) ?? 'cliente-1';
      await queryRows(
        `INSERT INTO reports
          (id, display_name, client_id, workspace_id, report_id, rls_roles_json, admin_rls_roles_json, admin_rls_username, is_active, created_at, updated_at)
         VALUES (@id, @display_name, @client_id, @workspace_id, @report_id, @rls_roles_json, @admin_rls_roles_json, @admin_rls_username, @is_active, @created_at, @updated_at)`,
        (request) => {
          request.input('id', sql.NVarChar(128), report.id);
          request.input('display_name', sql.NVarChar(256), report.displayName);
          request.input('client_id', sql.NVarChar(128), reportClientId);
          request.input('workspace_id', sql.NVarChar(128), report.workspaceId);
          request.input('report_id', sql.NVarChar(128), report.reportId);
          request.input('rls_roles_json', sql.NVarChar(sql.MAX), JSON.stringify(report.rlsRoles ?? []));
          request.input('admin_rls_roles_json', sql.NVarChar(sql.MAX), JSON.stringify(report.adminRlsRoles ?? []));
          request.input('admin_rls_username', sql.NVarChar(256), report.adminRlsUsername ?? null);
          request.input('is_active', sql.Bit, toBit(report.isActive !== false));
          request.input('created_at', sql.DateTime2, nowIso());
          request.input('updated_at', sql.DateTime2, nowIso());
        }
      );
    }
  }

  const userCount = await queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM users');
  if ((userCount?.count ?? 0) > 0) return;

  const adminUsername = normalizeUsername(process.env.BOOTSTRAP_ADMIN_USERNAME ?? 'admin');
  const adminEmail = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  if (!adminEmail) return;

  const adminId = randomUUID();
  await queryRows(
    `INSERT INTO users
      (id, username, email, password_hash, role, client_id, is_active, expires_at, created_at, updated_at)
     VALUES (@id, @username, @email, NULL, 'admin', NULL, 1, NULL, @created_at, @updated_at)`,
    (request) => {
      request.input('id', sql.NVarChar(64), adminId);
      request.input('username', sql.NVarChar(128), adminUsername);
      request.input('email', sql.NVarChar(256), adminEmail);
      request.input('created_at', sql.DateTime2, nowIso());
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );

  const allReports = await queryRows<{ id: string }>('SELECT id FROM reports WHERE is_active = 1');
  for (const report of allReports) {
    await queryRows(
      `INSERT INTO user_report_access (user_id, report_id, created_at)
       SELECT @user_id, @report_id, @created_at
       WHERE NOT EXISTS (
         SELECT 1 FROM user_report_access WHERE user_id = @user_id AND report_id = @report_id
       )`,
      (request) => {
        request.input('user_id', sql.NVarChar(64), adminId);
        request.input('report_id', sql.NVarChar(128), report.id);
        request.input('created_at', sql.DateTime2, nowIso());
      }
    );
  }

  const bootstrapUsers = getBootstrapUsers();
  for (const user of bootstrapUsers) {
    const normalizedEmail = normalizeEmail(user.email);
    if (!normalizedEmail) continue;

    const normalizedUsername = normalizeUsername(user.username);
    if (!normalizedUsername || normalizedUsername.toLowerCase() === adminUsername.toLowerCase()) continue;

    const userId = user.id ?? randomUUID();
    const userClientId = normalizeClientId(user.clientId) ?? 'cliente-1';
    await queryRows(
      `INSERT INTO users
        (id, username, email, password_hash, role, client_id, is_active, expires_at, created_at, updated_at)
       VALUES (@id, @username, @email, NULL, @role, @client_id, @is_active, @expires_at, @created_at, @updated_at)`,
      (request) => {
        request.input('id', sql.NVarChar(64), userId);
        request.input('username', sql.NVarChar(128), normalizedUsername);
        request.input('email', sql.NVarChar(256), normalizedEmail);
        request.input('role', sql.NVarChar(16), user.role);
        request.input('client_id', sql.NVarChar(128), user.role === 'admin' ? null : userClientId);
        request.input('is_active', sql.Bit, toBit(user.isActive !== false));
        request.input('expires_at', sql.DateTime2, user.expiresAt ?? null);
        request.input('created_at', sql.DateTime2, nowIso());
        request.input('updated_at', sql.DateTime2, nowIso());
      }
    );

    for (const reportId of user.reportIds ?? []) {
      await queryRows(
        `INSERT INTO user_report_access (user_id, report_id, created_at)
         SELECT @user_id, @report_id, @created_at
         WHERE NOT EXISTS (
           SELECT 1 FROM user_report_access WHERE user_id = @user_id AND report_id = @report_id
         )`,
        (request) => {
          request.input('user_id', sql.NVarChar(64), userId);
          request.input('report_id', sql.NVarChar(128), reportId);
          request.input('created_at', sql.DateTime2, nowIso());
        }
      );
    }

    for (const roleNameRaw of user.rlsRoles ?? []) {
      const roleName = roleNameRaw.trim();
      if (!roleName) continue;
      await queryRows(
        `INSERT INTO user_rls_roles (user_id, role_name, created_at)
         SELECT @user_id, @role_name, @created_at
         WHERE NOT EXISTS (
           SELECT 1 FROM user_rls_roles WHERE user_id = @user_id AND role_name = @role_name
         )`,
        (request) => {
          request.input('user_id', sql.NVarChar(64), userId);
          request.input('role_name', sql.NVarChar(128), roleName);
          request.input('created_at', sql.DateTime2, nowIso());
        }
      );
    }
  }

  const aiAgentCount = await queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM ai_agents');
  if ((aiAgentCount?.count ?? 0) > 0) return;

  for (const agent of getBootstrapAIAgents()) {
    const agentId = randomUUID();
    const agentClientId = normalizeClientId(agent.clientId) ?? 'cliente-1';
    await queryRows(
      `INSERT INTO ai_agents
        (id, name, client_id, responses_endpoint, activity_endpoint, foundry_project, foundry_agent_name, foundry_agent_version, security_mode, migration_status, published_url, mcp_url, mcp_tool_name, is_active, created_at, updated_at)
       VALUES (@id, @name, @client_id, @responses_endpoint, @activity_endpoint, @foundry_project, @foundry_agent_name, @foundry_agent_version, @security_mode, @migration_status, @published_url, @mcp_url, @mcp_tool_name, @is_active, @created_at, @updated_at)`,
      (request) => {
        request.input('id', sql.NVarChar(64), agentId);
        request.input('name', sql.NVarChar(256), agent.name);
        request.input('client_id', sql.NVarChar(128), agentClientId);
        request.input('responses_endpoint', sql.NVarChar(2048), agent.responsesEndpoint.trim());
        request.input('activity_endpoint', sql.NVarChar(2048), agent.activityEndpoint?.trim() || null);
        request.input('foundry_project', sql.NVarChar(256), agent.foundryProject?.trim() || null);
        request.input('foundry_agent_name', sql.NVarChar(256), agent.foundryAgentName?.trim() || null);
        request.input('foundry_agent_version', sql.NVarChar(64), agent.foundryAgentVersion?.trim() || null);
        request.input('security_mode', sql.NVarChar(32), agent.securityMode ?? 'none');
        request.input('migration_status', sql.NVarChar(32), agent.migrationStatus ?? 'manual');
        request.input('published_url', sql.NVarChar(1024), agent.responsesEndpoint.trim());
        request.input('mcp_url', sql.NVarChar(1024), null);
        request.input('mcp_tool_name', sql.NVarChar(256), null);
        request.input('is_active', sql.Bit, toBit(agent.isActive !== false));
        request.input('created_at', sql.DateTime2, nowIso());
        request.input('updated_at', sql.DateTime2, nowIso());
      }
    );

    for (const reportId of agent.reportIds) {
      await queryRows(
        `INSERT INTO ai_agent_reports (agent_id, report_id, created_at)
         SELECT @agent_id, @report_id, @created_at
         WHERE NOT EXISTS (
           SELECT 1 FROM ai_agent_reports WHERE agent_id = @agent_id AND report_id = @report_id
         )`,
        (request) => {
          request.input('agent_id', sql.NVarChar(64), agentId);
          request.input('report_id', sql.NVarChar(128), reportId);
          request.input('created_at', sql.DateTime2, nowIso());
        }
      );
    }
  }
}

export async function ensureDataLayer(): Promise<void> {
  if (initialized) return;
  const p = await getPool();
  await p.request().batch(schemaSql);
  await seedBootstrapData();
  await backfillDefaultClientsAndAssignments();
  initialized = true;
}

export async function findUserByEmailForMicrosoft(email: string): Promise<SessionAuthUser | null> {
  await ensureDataLayer();
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const user = await queryOne<DbUser>(
    `SELECT TOP (1) id, username, email, role, client_id, is_active, expires_at
     FROM users
     WHERE LOWER(email) = LOWER(@email)`,
    (request) => request.input('email', sql.NVarChar(256), normalized)
  );

  if (!user || !userIsActive(user)) return null;
  return toSessionUser(user);
}

export async function listClientsForAdmin(): Promise<ClientConfig[]> {
  await ensureDataLayer();
  const rows = await queryRows<DbClient>(
    `SELECT id, display_name, is_active
     FROM clients
     ORDER BY display_name ASC`
  );

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    isActive: toBoolean(row.is_active),
  }));
}

export async function createClientFromAdmin(input: { id: string; displayName: string; isActive?: boolean }): Promise<void> {
  await ensureDataLayer();

  const clientId = normalizeClientId(input.id);
  if (!clientId) throw new Error('Client id is required.');
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('Client name is required.');

  await queryRows(
    `INSERT INTO clients (id, display_name, is_active, created_at, updated_at)
     VALUES (@id, @display_name, @is_active, @created_at, @updated_at)`,
    (request) => {
      request.input('id', sql.NVarChar(128), clientId);
      request.input('display_name', sql.NVarChar(256), displayName);
      request.input('is_active', sql.Bit, toBit(input.isActive !== false));
      request.input('created_at', sql.DateTime2, nowIso());
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );
}

export async function updateClientFromAdmin(input: { id: string; displayName: string; isActive?: boolean }): Promise<void> {
  await ensureDataLayer();

  const clientId = normalizeClientId(input.id);
  if (!clientId) throw new Error('Client id is required.');
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('Client name is required.');

  await queryRows(
    `UPDATE clients
     SET display_name = @display_name,
         is_active = @is_active,
         updated_at = @updated_at
     WHERE id = @id`,
    (request) => {
      request.input('id', sql.NVarChar(128), clientId);
      request.input('display_name', sql.NVarChar(256), displayName);
      request.input('is_active', sql.Bit, toBit(input.isActive !== false));
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );
}

export async function findUserByMicrosoftClaims(claimCandidates: string[]): Promise<SessionAuthUser | null> {
  await ensureDataLayer();
  const normalizedCandidates = Array.from(new Set(claimCandidates.map((claim) => normalizeEmail(claim)).filter((claim): claim is string => Boolean(claim))));

  for (const candidate of normalizedCandidates) {
    const mapped = await findUserByEmailForMicrosoft(candidate);
    if (mapped) return mapped;
  }

  return null;
}

export async function getSessionUserById(userId: string): Promise<SessionAuthUser | null> {
  await ensureDataLayer();

  const user = await queryOne<DbUser>(
    `SELECT TOP (1) id, username, email, role, client_id, is_active, expires_at
     FROM users
     WHERE id = @id`,
    (request) => request.input('id', sql.NVarChar(64), userId)
  );

  if (!user || !userIsActive(user)) return null;
  return toSessionUser(user);
}

export async function getAccessibleReportsForUser(userId: string, role: UserRole): Promise<PublicReport[]> {
  await ensureDataLayer();

  const userClient = role === 'admin'
    ? undefined
    : await queryOne<{ client_id: string | null }>(
      'SELECT TOP (1) client_id FROM users WHERE id = @userId',
      (request) => request.input('userId', sql.NVarChar(64), userId)
    );

  const rows = role === 'admin'
    ? await queryRows<{ id: string; display_name: string; client_id: string; client_display_name: string | null; ai_agent_count: number }>(
      `SELECT r.id, r.display_name, r.client_id, c.display_name AS client_display_name, COUNT(a.id) AS ai_agent_count
       FROM reports r
       LEFT JOIN clients c ON c.id = r.client_id
       LEFT JOIN ai_agent_reports ar ON ar.report_id = r.id
       LEFT JOIN ai_agents a ON a.id = ar.agent_id AND a.is_active = 1 AND a.client_id = r.client_id
       WHERE r.is_active = 1
       GROUP BY r.id, r.display_name, r.client_id, c.display_name
       ORDER BY r.display_name ASC`
    )
    : await queryRows<{ id: string; display_name: string; client_id: string; client_display_name: string | null; ai_agent_count: number }>(
      `SELECT r.id, r.display_name, r.client_id, c.display_name AS client_display_name, COUNT(a.id) AS ai_agent_count
       FROM reports r
       LEFT JOIN clients c ON c.id = r.client_id
       INNER JOIN user_report_access ura ON ura.report_id = r.id
       LEFT JOIN ai_agent_reports ar ON ar.report_id = r.id
       LEFT JOIN ai_agents a ON a.id = ar.agent_id AND a.is_active = 1 AND a.client_id = r.client_id
       WHERE ura.user_id = @userId AND r.is_active = 1 AND r.client_id = @clientId
       GROUP BY r.id, r.display_name, r.client_id, c.display_name
       ORDER BY r.display_name ASC`,
      (request) => {
        request.input('userId', sql.NVarChar(64), userId);
        request.input('clientId', sql.NVarChar(128), normalizeClientId(userClient?.client_id) ?? 'cliente-1');
      }
    );

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    clientId: row.client_id,
    clientName: row.client_display_name ?? row.client_id,
    hasAiAgents: Number(row.ai_agent_count) > 0,
    aiAgentCount: Number(row.ai_agent_count),
  }));
}

export async function getSecureReportConfigForUser(params: {
  userId: string;
  role: UserRole;
  requestedReportId: string;
}): Promise<SecureReportConfig | null> {
  await ensureDataLayer();

  const report = await queryOne<DbReport>(
    `SELECT TOP (1) id, display_name, client_id, workspace_id, report_id, rls_roles_json, admin_rls_roles_json, admin_rls_username, is_active
     FROM reports WHERE id = @reportId`,
    (request) => request.input('reportId', sql.NVarChar(128), params.requestedReportId)
  );

  if (!report || !toBoolean(report.is_active)) return null;

  if (params.role !== 'admin') {
    const user = await queryOne<{ client_id: string | null }>(
      'SELECT TOP (1) client_id FROM users WHERE id = @userId',
      (request) => request.input('userId', sql.NVarChar(64), params.userId)
    );
    const userClientId = normalizeClientId(user?.client_id);
    if (!userClientId || userClientId !== report.client_id) return null;

    const access = await queryOne<{ allowed: number }>(
      `SELECT TOP (1) 1 AS allowed
       FROM user_report_access
       WHERE user_id = @userId AND report_id = @reportId`,
      (request) => {
        request.input('userId', sql.NVarChar(64), params.userId);
        request.input('reportId', sql.NVarChar(128), params.requestedReportId);
      }
    );
    if (!access) return null;
  }

  return {
    id: report.id,
    displayName: report.display_name,
    clientId: report.client_id,
    workspaceId: report.workspace_id,
    reportId: report.report_id,
    rlsRoles: parseJsonArray(report.rls_roles_json),
    adminRlsRoles: parseJsonArray(report.admin_rls_roles_json),
    adminRlsUsername: report.admin_rls_username ?? undefined,
  };
}

export async function listUsersForAdmin(): Promise<Array<{
  id: string;
  username: string;
  email?: string;
  role: UserRole;
  clientId?: string;
  isActive: boolean;
  expiresAt?: string;
  reportIds: string[];
  rlsRoles: string[];
}>> {
  await ensureDataLayer();
  const rows = await queryRows<DbUser>(
    `SELECT id, username, email, role, client_id, is_active, expires_at
     FROM users
     ORDER BY username ASC`
  );

  const out: Array<{
    id: string;
    username: string;
    email?: string;
    role: UserRole;
    clientId?: string;
    isActive: boolean;
    expiresAt?: string;
    reportIds: string[];
    rlsRoles: string[];
  }> = [];

  for (const row of rows) {
    out.push({
      id: row.id,
      username: row.username,
      email: row.email ?? undefined,
      role: row.role,
      clientId: row.client_id ?? undefined,
      isActive: toBoolean(row.is_active),
      expiresAt: row.expires_at ?? undefined,
      reportIds: await getUserReportIds(row.id),
      rlsRoles: await getUserRlsRoles(row.id),
    });
  }

  return out;
}

export async function listReportsForAdmin(): Promise<SecureReportConfig[]> {
  await ensureDataLayer();
  const rows = await queryRows<DbReport>(
    `SELECT id, display_name, client_id, workspace_id, report_id, rls_roles_json, admin_rls_roles_json, admin_rls_username, is_active
     FROM reports
     ORDER BY display_name ASC`
  );

  return rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      clientId: row.client_id,
      workspaceId: row.workspace_id,
      reportId: row.report_id,
      rlsRoles: parseJsonArray(row.rls_roles_json),
      adminRlsRoles: parseJsonArray(row.admin_rls_roles_json),
      adminRlsUsername: row.admin_rls_username ?? undefined,
      isActive: toBoolean(row.is_active),
    }));
}

export async function createUserFromAdmin(input: CreateUserInput): Promise<void> {
  await ensureDataLayer();

  const username = normalizeUsername(input.username);
  if (!username) throw new Error('Username is required.');
  const email = normalizeEmail(input.email);
  if (!email) throw new Error('Email is required for Microsoft authentication mapping.');
  const userClientId = input.role === 'admin'
    ? undefined
    : await ensureClientExists(input.clientId ?? '');

  if (input.role !== 'admin') {
    await validateReportIdsBelongToClient(input.reportIds, userClientId!);
  }

  const userId = randomUUID();
  await queryRows(
    `INSERT INTO users (id, username, email, password_hash, role, client_id, is_active, expires_at, created_at, updated_at)
     VALUES (@id, @username, @email, NULL, @role, @client_id, @is_active, @expires_at, @created_at, @updated_at)`,
    (request) => {
      request.input('id', sql.NVarChar(64), userId);
      request.input('username', sql.NVarChar(128), username);
      request.input('email', sql.NVarChar(256), email);
      request.input('role', sql.NVarChar(16), input.role);
      request.input('client_id', sql.NVarChar(128), input.role === 'admin' ? null : userClientId!);
      request.input('is_active', sql.Bit, toBit(input.isActive !== false));
      request.input('expires_at', sql.DateTime2, input.expiresAt ?? null);
      request.input('created_at', sql.DateTime2, nowIso());
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );

  for (const reportId of normalizeIdList(input.reportIds)) {
    await queryRows(
      `INSERT INTO user_report_access (user_id, report_id, created_at)
       SELECT @user_id, @report_id, @created_at
       WHERE NOT EXISTS (
         SELECT 1 FROM user_report_access WHERE user_id = @user_id AND report_id = @report_id
       )`,
      (request) => {
        request.input('user_id', sql.NVarChar(64), userId);
        request.input('report_id', sql.NVarChar(128), reportId);
        request.input('created_at', sql.DateTime2, nowIso());
      }
    );
  }

  for (const roleNameRaw of normalizeIdList(input.rlsRoles ?? [])) {
    const roleName = roleNameRaw.trim();
    if (!roleName) continue;

    await queryRows(
      `INSERT INTO user_rls_roles (user_id, role_name, created_at)
       SELECT @user_id, @role_name, @created_at
       WHERE NOT EXISTS (
         SELECT 1 FROM user_rls_roles WHERE user_id = @user_id AND role_name = @role_name
       )`,
      (request) => {
        request.input('user_id', sql.NVarChar(64), userId);
        request.input('role_name', sql.NVarChar(128), roleName);
        request.input('created_at', sql.DateTime2, nowIso());
      }
    );
  }
}

export async function updateUserFromAdmin(input: UpdateUserInput): Promise<void> {
  await ensureDataLayer();

  const userId = input.id.trim();
  if (!userId) throw new Error('User id is required.');

  const username = normalizeUsername(input.username);
  if (!username) throw new Error('Username is required.');

  const email = normalizeEmail(input.email);
  if (!email) throw new Error('Email is required for Microsoft authentication mapping.');
  const userClientId = input.role === 'admin'
    ? undefined
    : await ensureClientExists(input.clientId ?? '');

  if (input.role !== 'admin') {
    await validateReportIdsBelongToClient(input.reportIds, userClientId!);
  }

  const existingUser = await queryOne<{ id: string }>(
    'SELECT TOP (1) id FROM users WHERE id = @id',
    (request) => request.input('id', sql.NVarChar(64), userId)
  );
  if (!existingUser) throw new Error('User not found.');

  await queryRows(
    `UPDATE users
     SET username = @username,
         email = @email,
         role = @role,
       client_id = @client_id,
         is_active = @is_active,
         expires_at = @expires_at,
         updated_at = @updated_at
     WHERE id = @id`,
    (request) => {
      request.input('id', sql.NVarChar(64), userId);
      request.input('username', sql.NVarChar(128), username);
      request.input('email', sql.NVarChar(256), email);
      request.input('role', sql.NVarChar(16), input.role);
      request.input('client_id', sql.NVarChar(128), input.role === 'admin' ? null : userClientId!);
      request.input('is_active', sql.Bit, toBit(input.isActive !== false));
      request.input('expires_at', sql.DateTime2, input.expiresAt ?? null);
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );

  await queryRows(
    'DELETE FROM user_report_access WHERE user_id = @userId',
    (request) => request.input('userId', sql.NVarChar(64), userId)
  );

  for (const reportId of normalizeIdList(input.reportIds)) {
    await queryRows(
      `INSERT INTO user_report_access (user_id, report_id, created_at)
       SELECT @user_id, @report_id, @created_at`,
      (request) => {
        request.input('user_id', sql.NVarChar(64), userId);
        request.input('report_id', sql.NVarChar(128), reportId);
        request.input('created_at', sql.DateTime2, nowIso());
      }
    );
  }

  await queryRows(
    'DELETE FROM user_rls_roles WHERE user_id = @userId',
    (request) => request.input('userId', sql.NVarChar(64), userId)
  );

  for (const roleName of normalizeIdList(input.rlsRoles ?? [])) {
    await queryRows(
      `INSERT INTO user_rls_roles (user_id, role_name, created_at)
       SELECT @user_id, @role_name, @created_at`,
      (request) => {
        request.input('user_id', sql.NVarChar(64), userId);
        request.input('role_name', sql.NVarChar(128), roleName);
        request.input('created_at', sql.DateTime2, nowIso());
      }
    );
  }
}

export async function deleteUserFromAdmin(id: string): Promise<void> {
  await ensureDataLayer();
  const userId = id.trim();
  if (!userId) throw new Error('User id is required.');

  await queryRows(
    'DELETE FROM users WHERE id = @id',
    (request) => request.input('id', sql.NVarChar(64), userId)
  );
}

export async function createReportFromAdmin(input: CreateReportInput): Promise<void> {
  await ensureDataLayer();
  const clientId = await ensureClientExists(input.clientId);

  await queryRows(
    `INSERT INTO reports
      (id, display_name, client_id, workspace_id, report_id, rls_roles_json, admin_rls_roles_json, admin_rls_username, is_active, created_at, updated_at)
     VALUES (@id, @display_name, @client_id, @workspace_id, @report_id, @rls_roles_json, @admin_rls_roles_json, @admin_rls_username, @is_active, @created_at, @updated_at)`,
    (request) => {
      request.input('id', sql.NVarChar(128), input.id);
      request.input('display_name', sql.NVarChar(256), input.displayName);
      request.input('client_id', sql.NVarChar(128), clientId);
      request.input('workspace_id', sql.NVarChar(128), input.workspaceId);
      request.input('report_id', sql.NVarChar(128), input.reportId);
      request.input('rls_roles_json', sql.NVarChar(sql.MAX), JSON.stringify(input.rlsRoles ?? []));
      request.input('admin_rls_roles_json', sql.NVarChar(sql.MAX), JSON.stringify(input.adminRlsRoles ?? []));
      request.input('admin_rls_username', sql.NVarChar(256), input.adminRlsUsername ?? null);
      request.input('is_active', sql.Bit, toBit(input.isActive !== false));
      request.input('created_at', sql.DateTime2, nowIso());
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );
}

export async function updateReportFromAdmin(input: UpdateReportInput): Promise<void> {
  await ensureDataLayer();

  const reportId = input.id.trim();
  if (!reportId) throw new Error('Report id is required.');
  const clientId = await ensureClientExists(input.clientId);

  await queryRows(
    `UPDATE reports
     SET display_name = @display_name,
         client_id = @client_id,
         workspace_id = @workspace_id,
         report_id = @report_id,
         rls_roles_json = @rls_roles_json,
         admin_rls_roles_json = @admin_rls_roles_json,
         admin_rls_username = @admin_rls_username,
         is_active = @is_active,
         updated_at = @updated_at
     WHERE id = @id`,
    (request) => {
      request.input('id', sql.NVarChar(128), reportId);
      request.input('display_name', sql.NVarChar(256), input.displayName.trim());
      request.input('client_id', sql.NVarChar(128), clientId);
      request.input('workspace_id', sql.NVarChar(128), input.workspaceId.trim());
      request.input('report_id', sql.NVarChar(128), input.reportId.trim());
      request.input('rls_roles_json', sql.NVarChar(sql.MAX), JSON.stringify(normalizeIdList(input.rlsRoles ?? [])));
      request.input('admin_rls_roles_json', sql.NVarChar(sql.MAX), JSON.stringify(normalizeIdList(input.adminRlsRoles ?? [])));
      request.input('admin_rls_username', sql.NVarChar(256), input.adminRlsUsername?.trim() || null);
      request.input('is_active', sql.Bit, toBit(input.isActive !== false));
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );
}

export async function deleteReportFromAdmin(id: string): Promise<void> {
  await ensureDataLayer();
  const reportId = id.trim();
  if (!reportId) throw new Error('Report id is required.');

  await queryRows(
    'DELETE FROM reports WHERE id = @id',
    (request) => request.input('id', sql.NVarChar(128), reportId)
  );
}

export async function listAIAgentsForAdmin(): Promise<AIAgentConfig[]> {
  await ensureDataLayer();

  const rows = await queryRows<DbAIAgent>(
    `SELECT id, name, client_id, responses_endpoint, activity_endpoint, foundry_project, foundry_agent_name, foundry_agent_version,
            security_mode, migration_status, published_url, mcp_url, mcp_tool_name, is_active
     FROM ai_agents
     ORDER BY name ASC`
  );

  const reportRows = await queryRows<{ agent_id: string; report_id: string }>(
    'SELECT agent_id, report_id FROM ai_agent_reports'
  );

  const reportMap = new Map<string, string[]>();
  for (const row of reportRows) {
    const current = reportMap.get(row.agent_id) ?? [];
    current.push(row.report_id);
    reportMap.set(row.agent_id, current);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    responsesEndpoint: (row.responses_endpoint ?? row.published_url ?? '').trim(),
    activityEndpoint: row.activity_endpoint ?? undefined,
    foundryProject: row.foundry_project ?? undefined,
    foundryAgentName: row.foundry_agent_name ?? undefined,
    foundryAgentVersion: row.foundry_agent_version ?? undefined,
    securityMode: row.security_mode === 'rls-inherit' ? 'rls-inherit' : 'none',
    migrationStatus: row.migration_status === 'migrated' || row.migration_status === 'manual' ? row.migration_status : 'legacy',
    reportIds: reportMap.get(row.id) ?? [],
    isActive: toBoolean(row.is_active),
  }));
}

export async function createAIAgentFromAdmin(input: CreateAIAgentInput): Promise<void> {
  await ensureDataLayer();
  const clientId = await ensureClientExists(input.clientId);
  if (!input.name.trim()) throw new Error('Agent name is required.');
  if (!input.responsesEndpoint.trim()) throw new Error('Foundry responses endpoint is required.');
  if (input.reportIds.length === 0) throw new Error('At least one report must be associated.');
  await validateReportIdsBelongToClient(input.reportIds, clientId);

  const agentId = randomUUID();
  await queryRows(
    `INSERT INTO ai_agents
      (id, name, client_id, responses_endpoint, activity_endpoint, foundry_project, foundry_agent_name, foundry_agent_version, security_mode, migration_status, published_url, mcp_url, mcp_tool_name, is_active, created_at, updated_at)
     VALUES (@id, @name, @client_id, @responses_endpoint, @activity_endpoint, @foundry_project, @foundry_agent_name, @foundry_agent_version, @security_mode, @migration_status, @published_url, @mcp_url, @mcp_tool_name, @is_active, @created_at, @updated_at)`,
    (request) => {
      request.input('id', sql.NVarChar(64), agentId);
      request.input('name', sql.NVarChar(256), input.name.trim());
      request.input('client_id', sql.NVarChar(128), clientId);
      request.input('responses_endpoint', sql.NVarChar(2048), input.responsesEndpoint.trim());
      request.input('activity_endpoint', sql.NVarChar(2048), input.activityEndpoint?.trim() || null);
      request.input('foundry_project', sql.NVarChar(256), input.foundryProject?.trim() || null);
      request.input('foundry_agent_name', sql.NVarChar(256), input.foundryAgentName?.trim() || null);
      request.input('foundry_agent_version', sql.NVarChar(64), input.foundryAgentVersion?.trim() || null);
      request.input('security_mode', sql.NVarChar(32), input.securityMode ?? 'none');
      request.input('migration_status', sql.NVarChar(32), input.migrationStatus ?? 'manual');
      request.input('published_url', sql.NVarChar(1024), input.responsesEndpoint.trim());
      request.input('mcp_url', sql.NVarChar(1024), null);
      request.input('mcp_tool_name', sql.NVarChar(256), null);
      request.input('is_active', sql.Bit, toBit(input.isActive !== false));
      request.input('created_at', sql.DateTime2, nowIso());
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );

  for (const reportId of normalizeIdList(input.reportIds)) {
    await queryRows(
      `INSERT INTO ai_agent_reports (agent_id, report_id, created_at)
       SELECT @agent_id, @report_id, @created_at
       WHERE NOT EXISTS (
         SELECT 1 FROM ai_agent_reports WHERE agent_id = @agent_id AND report_id = @report_id
       )`,
      (request) => {
        request.input('agent_id', sql.NVarChar(64), agentId);
        request.input('report_id', sql.NVarChar(128), reportId);
        request.input('created_at', sql.DateTime2, nowIso());
      }
    );
  }
}

export async function updateAIAgentFromAdmin(input: UpdateAIAgentInput): Promise<void> {
  await ensureDataLayer();

  const agentId = input.id.trim();
  if (!agentId) throw new Error('Agent id is required.');
  const clientId = await ensureClientExists(input.clientId);
  if (!input.name.trim()) throw new Error('Agent name is required.');
  if (!input.responsesEndpoint.trim()) throw new Error('Foundry responses endpoint is required.');
  if (input.reportIds.length === 0) throw new Error('At least one report must be associated.');
  await validateReportIdsBelongToClient(input.reportIds, clientId);

  await queryRows(
    `UPDATE ai_agents
     SET name = @name,
         client_id = @client_id,
         responses_endpoint = @responses_endpoint,
         activity_endpoint = @activity_endpoint,
         foundry_project = @foundry_project,
         foundry_agent_name = @foundry_agent_name,
         foundry_agent_version = @foundry_agent_version,
         security_mode = @security_mode,
         migration_status = @migration_status,
         published_url = @published_url,
         mcp_url = @mcp_url,
         mcp_tool_name = @mcp_tool_name,
         is_active = @is_active,
         updated_at = @updated_at
     WHERE id = @id`,
    (request) => {
      request.input('id', sql.NVarChar(64), agentId);
      request.input('name', sql.NVarChar(256), input.name.trim());
      request.input('client_id', sql.NVarChar(128), clientId);
      request.input('responses_endpoint', sql.NVarChar(2048), input.responsesEndpoint.trim());
      request.input('activity_endpoint', sql.NVarChar(2048), input.activityEndpoint?.trim() || null);
      request.input('foundry_project', sql.NVarChar(256), input.foundryProject?.trim() || null);
      request.input('foundry_agent_name', sql.NVarChar(256), input.foundryAgentName?.trim() || null);
      request.input('foundry_agent_version', sql.NVarChar(64), input.foundryAgentVersion?.trim() || null);
      request.input('security_mode', sql.NVarChar(32), input.securityMode ?? 'none');
      request.input('migration_status', sql.NVarChar(32), input.migrationStatus ?? 'manual');
      request.input('published_url', sql.NVarChar(1024), input.responsesEndpoint.trim());
      request.input('mcp_url', sql.NVarChar(1024), null);
      request.input('mcp_tool_name', sql.NVarChar(256), null);
      request.input('is_active', sql.Bit, toBit(input.isActive !== false));
      request.input('updated_at', sql.DateTime2, nowIso());
    }
  );

  await queryRows(
    'DELETE FROM ai_agent_reports WHERE agent_id = @agentId',
    (request) => request.input('agentId', sql.NVarChar(64), agentId)
  );

  for (const reportId of normalizeIdList(input.reportIds)) {
    await queryRows(
      `INSERT INTO ai_agent_reports (agent_id, report_id, created_at)
       SELECT @agent_id, @report_id, @created_at`,
      (request) => {
        request.input('agent_id', sql.NVarChar(64), agentId);
        request.input('report_id', sql.NVarChar(128), reportId);
        request.input('created_at', sql.DateTime2, nowIso());
      }
    );
  }
}

export async function deleteAIAgentFromAdmin(id: string): Promise<void> {
  await ensureDataLayer();
  const agentId = id.trim();
  if (!agentId) throw new Error('Agent id is required.');

  await queryRows(
    'DELETE FROM ai_agents WHERE id = @id',
    (request) => request.input('id', sql.NVarChar(64), agentId)
  );
}

export async function getAIAgentsForReport(params: {
  userId: string;
  role: UserRole;
  reportId: string;
}): Promise<AIAgentConfig[]> {
  await ensureDataLayer();

  if (params.role !== 'admin') {
    const user = await queryOne<{ client_id: string | null }>(
      'SELECT TOP (1) client_id FROM users WHERE id = @userId',
      (request) => request.input('userId', sql.NVarChar(64), params.userId)
    );
    const userClientId = normalizeClientId(user?.client_id);
    if (!userClientId) return [];

    const access = await queryOne<{ allowed: number }>(
      `SELECT TOP (1) 1 AS allowed
       FROM user_report_access ura
       INNER JOIN reports r ON r.id = ura.report_id
       WHERE ura.user_id = @userId AND ura.report_id = @reportId AND r.client_id = @clientId`,
      (request) => {
        request.input('userId', sql.NVarChar(64), params.userId);
        request.input('reportId', sql.NVarChar(128), params.reportId);
        request.input('clientId', sql.NVarChar(128), userClientId);
      }
    );
    if (!access) return [];
  }

  const rows = await queryRows<DbAIAgent>(
    `SELECT a.id, a.name, a.client_id, a.responses_endpoint, a.activity_endpoint, a.foundry_project, a.foundry_agent_name, a.foundry_agent_version,
            a.security_mode, a.migration_status, a.published_url, a.mcp_url, a.mcp_tool_name, a.is_active
     FROM ai_agents a
     INNER JOIN ai_agent_reports ar ON ar.agent_id = a.id
     INNER JOIN reports r ON r.id = ar.report_id
     WHERE ar.report_id = @reportId AND a.is_active = 1 AND a.client_id = r.client_id
     ORDER BY a.name ASC`,
    (request) => request.input('reportId', sql.NVarChar(128), params.reportId)
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    responsesEndpoint: (row.responses_endpoint ?? row.published_url ?? '').trim(),
    activityEndpoint: row.activity_endpoint ?? undefined,
    foundryProject: row.foundry_project ?? undefined,
    foundryAgentName: row.foundry_agent_name ?? undefined,
    foundryAgentVersion: row.foundry_agent_version ?? undefined,
    securityMode: row.security_mode === 'rls-inherit' ? 'rls-inherit' : 'none',
    migrationStatus: row.migration_status === 'migrated' || row.migration_status === 'manual' ? row.migration_status : 'legacy',
    reportIds: [params.reportId],
    isActive: toBoolean(row.is_active),
  }));
}

export async function getAIAgentByIdForUser(params: {
  userId: string;
  role: UserRole;
  agentId: string;
  reportId?: string;
}): Promise<AIAgentConfig | null> {
  await ensureDataLayer();

  const agent = await queryOne<DbAIAgent>(
    `SELECT TOP (1) id, name, client_id, responses_endpoint, activity_endpoint, foundry_project, foundry_agent_name, foundry_agent_version,
            security_mode, migration_status, published_url, mcp_url, mcp_tool_name, is_active
     FROM ai_agents
     WHERE id = @agentId AND is_active = 1`,
    (request) => request.input('agentId', sql.NVarChar(64), params.agentId)
  );
  if (!agent) return null;

  const linkedReports = await queryRows<{ report_id: string }>(
    'SELECT report_id FROM ai_agent_reports WHERE agent_id = @agentId',
    (request) => request.input('agentId', sql.NVarChar(64), params.agentId)
  );

  const reportIds = linkedReports.map((row) => row.report_id);
  if (reportIds.length === 0) return null;
  if (params.reportId && !reportIds.includes(params.reportId)) return null;

  if (params.role !== 'admin') {
    const user = await queryOne<{ client_id: string | null }>(
      'SELECT TOP (1) client_id FROM users WHERE id = @userId',
      (request) => request.input('userId', sql.NVarChar(64), params.userId)
    );
    const userClientId = normalizeClientId(user?.client_id);
    if (!userClientId || userClientId !== agent.client_id) return null;

    if (params.reportId) {
      const allowed = await queryOne<{ allowed: number }>(
        `SELECT TOP (1) 1 AS allowed
         FROM user_report_access ura
         INNER JOIN reports r ON r.id = ura.report_id
         WHERE ura.user_id = @userId AND ura.report_id = @reportId AND r.client_id = @clientId`,
        (request) => {
          request.input('userId', sql.NVarChar(64), params.userId);
          request.input('reportId', sql.NVarChar(128), params.reportId);
          request.input('clientId', sql.NVarChar(128), userClientId);
        }
      );
      if (!allowed) return null;
    } else {
      let hasAccess = false;
      for (const reportId of reportIds) {
        const allowed = await queryOne<{ allowed: number }>(
          `SELECT TOP (1) 1 AS allowed
           FROM user_report_access ura
           INNER JOIN reports r ON r.id = ura.report_id
           WHERE ura.user_id = @userId AND ura.report_id = @reportId AND r.client_id = @clientId`,
          (request) => {
            request.input('userId', sql.NVarChar(64), params.userId);
            request.input('reportId', sql.NVarChar(128), reportId);
            request.input('clientId', sql.NVarChar(128), userClientId);
          }
        );
        if (allowed) {
          hasAccess = true;
          break;
        }
      }
      if (!hasAccess) return null;
    }
  }

  return {
    id: agent.id,
    name: agent.name,
    clientId: agent.client_id,
    responsesEndpoint: (agent.responses_endpoint ?? agent.published_url ?? '').trim(),
    activityEndpoint: agent.activity_endpoint ?? undefined,
    foundryProject: agent.foundry_project ?? undefined,
    foundryAgentName: agent.foundry_agent_name ?? undefined,
    foundryAgentVersion: agent.foundry_agent_version ?? undefined,
    securityMode: agent.security_mode === 'rls-inherit' ? 'rls-inherit' : 'none',
    migrationStatus: agent.migration_status === 'migrated' || agent.migration_status === 'manual' ? agent.migration_status : 'legacy',
    reportIds,
    isActive: toBoolean(agent.is_active),
  };
}

export async function recordAuditEvent(params: {
  eventType: string;
  userId?: string;
  ip?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await ensureDataLayer();

  await queryRows(
    `INSERT INTO audit_log (event_type, user_id, ip, detail_json, created_at)
     VALUES (@event_type, @user_id, @ip, @detail_json, @created_at)`,
    (request) => {
      request.input('event_type', sql.NVarChar(128), params.eventType);
      request.input('user_id', sql.NVarChar(64), params.userId ?? null);
      request.input('ip', sql.NVarChar(128), params.ip ?? null);
      request.input('detail_json', sql.NVarChar(sql.MAX), params.detail ? JSON.stringify(params.detail) : null);
      request.input('created_at', sql.DateTime2, nowIso());
    }
  );
}
