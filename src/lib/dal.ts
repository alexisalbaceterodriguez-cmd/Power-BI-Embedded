import 'server-only';

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as azureRuntime from '@/lib/dalAzureRuntime';

export type UserRole = 'admin' | 'client';

interface DbUser {
  id: string;
  username: string;
  email: string | null;
  password_hash: string | null;
  role: UserRole;
  is_active: number;
  expires_at: string | null;
}

interface DbReport {
  id: string;
  display_name: string;
  workspace_id: string;
  report_id: string;
  rls_roles_json: string | null;
  admin_rls_roles_json: string | null;
  admin_rls_username: string | null;
  is_active: number;
}

interface DbAIAgent {
  id: string;
  name: string;
  published_url: string;
  mcp_url: string | null;
  mcp_tool_name: string | null;
  is_active: number;
}

export interface SessionAuthUser {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  reportIds: string[];
  rlsRoles?: string[];
}

export interface PublicReport {
  id: string;
  displayName: string;
  hasAiAgents?: boolean;
  aiAgentCount?: number;
}

export interface SecureReportConfig {
  id: string;
  displayName: string;
  workspaceId: string;
  reportId: string;
  rlsRoles?: string[];
  adminRlsRoles?: string[];
  adminRlsUsername?: string;
}

export interface CreateUserInput {
  username: string;
  email: string;
  role: UserRole;
  reportIds: string[];
  rlsRoles?: string[];
  isActive?: boolean;
  expiresAt?: string;
}

export interface CreateReportInput {
  id: string;
  displayName: string;
  workspaceId: string;
  reportId: string;
  rlsRoles?: string[];
  adminRlsRoles?: string[];
  adminRlsUsername?: string;
  isActive?: boolean;
}

export interface AIAgentConfig {
  id: string;
  name: string;
  publishedUrl: string;
  mcpUrl?: string;
  mcpToolName?: string;
  reportIds: string[];
  isActive: boolean;
}

export interface CreateAIAgentInput {
  name: string;
  publishedUrl: string;
  mcpUrl?: string;
  mcpToolName?: string;
  reportIds: string[];
  isActive?: boolean;
}

interface BootstrapUserInput {
  id?: string;
  username: string;
  email?: string;
  role: UserRole;
  reportIds?: string[];
  rlsRoles?: string[];
  isActive?: boolean;
  expiresAt?: string;
}

type BetterDb = Database.Database;

let db: BetterDb | null = null;
let initialized = false;

function isAzureSqlBackend(): boolean {
  return Boolean(process.env.AZURE_SQL_SERVER?.trim() && process.env.AZURE_SQL_DATABASE?.trim());
}

function nowIso(): string {
  return new Date().toISOString();
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

function normalizeEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string): string {
  return username.trim();
}

function isFutureDate(value?: string | null): boolean {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

function getDbPath(): string {
  const configured = process.env.APP_DB_PATH?.trim();
  const resolved = configured ? path.resolve(configured) : path.join(process.cwd(), 'data', 'security.db');
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function getDb(): BetterDb {
  if (db) return db;
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function migrate(currentDb: BetterDb): void {
  currentDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'client')),
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      rls_roles_json TEXT,
      admin_rls_roles_json TEXT,
      admin_rls_username TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_report_access (
      user_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, report_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_rls_roles (
      user_id TEXT NOT NULL,
      role_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, role_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      published_url TEXT NOT NULL,
      mcp_url TEXT,
      mcp_tool_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_agent_reports (
      agent_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, report_id),
      FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE CASCADE,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_attempts (
      attempt_key TEXT PRIMARY KEY,
      fail_count INTEGER NOT NULL,
      lock_until TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_id TEXT,
      ip TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const aiAgentColumns = currentDb.prepare(`PRAGMA table_info(ai_agents)`).all() as Array<{ name: string }>;
  const hasMcpToolName = aiAgentColumns.some((column) => column.name === 'mcp_tool_name');
  if (!hasMcpToolName) {
    currentDb.exec(`ALTER TABLE ai_agents ADD COLUMN mcp_tool_name TEXT;`);
  }
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

  // Legacy single-report fallback from env vars.
  if (process.env.WORKSPACE_ID && process.env.REPORT_ID) {
    return [
      {
        id: 'default-report',
        displayName: 'Default Report',
        workspaceId: process.env.WORKSPACE_ID,
        reportId: process.env.REPORT_ID,
        isActive: true,
      },
    ];
  }

  return [];
}

function getBootstrapUsers(): BootstrapUserInput[] {
  const fromEnv = process.env.BOOTSTRAP_USERS_JSON;
  if (!fromEnv) return [];
  try {
    const parsed = JSON.parse(fromEnv) as BootstrapUserInput[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function getBootstrapAIAgents(): CreateAIAgentInput[] {
  const fromEnv = process.env.BOOTSTRAP_AI_AGENTS_JSON;
  if (!fromEnv) return [];
  try {
    const parsed = JSON.parse(fromEnv) as CreateAIAgentInput[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

async function seedBootstrapData(currentDb: BetterDb): Promise<void> {
  const reportCount = (currentDb.prepare('SELECT COUNT(*) as count FROM reports').get() as { count: number }).count;
  if (reportCount === 0) {
    const insertReport = currentDb.prepare(`
      INSERT INTO reports (
        id, display_name, workspace_id, report_id,
        rls_roles_json, admin_rls_roles_json, admin_rls_username,
        is_active, created_at, updated_at
      ) VALUES (@id, @display_name, @workspace_id, @report_id, @rls_roles_json, @admin_rls_roles_json, @admin_rls_username, @is_active, @created_at, @updated_at)
    `);

    for (const report of getBootstrapReports()) {
      insertReport.run({
        id: report.id,
        display_name: report.displayName,
        workspace_id: report.workspaceId,
        report_id: report.reportId,
        rls_roles_json: JSON.stringify(report.rlsRoles ?? []),
        admin_rls_roles_json: JSON.stringify(report.adminRlsRoles ?? []),
        admin_rls_username: report.adminRlsUsername ?? null,
        is_active: report.isActive === false ? 0 : 1,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
  }

  const userCount = (currentDb.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  if (userCount > 0) return;

  const adminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME ?? 'admin';
  const adminEmail = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);

  if (!adminEmail) {
    return;
  }

  const adminId = randomUUID();
  currentDb.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, is_active, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'admin', 1, NULL, ?, ?)
  `).run(adminId, normalizeUsername(adminUsername), adminEmail, null, nowIso(), nowIso());

  const reportIds = currentDb.prepare('SELECT id FROM reports WHERE is_active = 1').all() as { id: string }[];
  const insertAccess = currentDb.prepare('INSERT INTO user_report_access (user_id, report_id, created_at) VALUES (?, ?, ?)');
  for (const report of reportIds) {
    insertAccess.run(adminId, report.id, nowIso());
  }

  const bootstrapUsers = getBootstrapUsers();
  for (const user of bootstrapUsers) {
    const normalizedEmail = normalizeEmail(user.email);
    if (!normalizedEmail) continue;

    const normalizedUsername = normalizeUsername(user.username);
    if (!normalizedUsername || normalizedUsername.toLowerCase() === normalizeUsername(adminUsername).toLowerCase()) {
      continue;
    }

    const userId = user.id ?? randomUUID();
    currentDb.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, is_active, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      normalizedUsername,
      normalizedEmail,
      null,
      user.role,
      user.isActive === false ? 0 : 1,
      user.expiresAt ?? null,
      nowIso(),
      nowIso()
    );

    const assignedReports = user.reportIds ?? [];
    for (const reportId of assignedReports) {
      insertAccess.run(userId, reportId, nowIso());
    }

    const insertRls = currentDb.prepare('INSERT OR IGNORE INTO user_rls_roles (user_id, role_name, created_at) VALUES (?, ?, ?)');
    for (const roleName of user.rlsRoles ?? []) {
      if (!roleName.trim()) continue;
      insertRls.run(userId, roleName.trim(), nowIso());
    }
  }

  const aiAgentCount = (currentDb.prepare('SELECT COUNT(*) as count FROM ai_agents').get() as { count: number }).count;
  if (aiAgentCount === 0) {
    const agents = getBootstrapAIAgents();
    if (agents.length > 0) {
      const insertAgent = currentDb.prepare(`
        INSERT INTO ai_agents (id, name, published_url, mcp_url, mcp_tool_name, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertAgentReport = currentDb.prepare(`
        INSERT OR IGNORE INTO ai_agent_reports (agent_id, report_id, created_at)
        VALUES (?, ?, ?)
      `);

      for (const agent of agents) {
        const agentId = randomUUID();
        insertAgent.run(
          agentId,
          agent.name,
          agent.publishedUrl,
          agent.mcpUrl ?? null,
          agent.mcpToolName ?? null,
          agent.isActive === false ? 0 : 1,
          nowIso(),
          nowIso()
        );

        for (const reportId of agent.reportIds) {
          insertAgentReport.run(agentId, reportId, nowIso());
        }
      }
    }
  }
}

export async function ensureDataLayer(): Promise<void> {
  if (isAzureSqlBackend()) {
    await azureRuntime.ensureDataLayer();
    return;
  }

  if (initialized) return;
  const currentDb = getDb();
  migrate(currentDb);
  await seedBootstrapData(currentDb);
  initialized = true;
}

function userIsActive(user: DbUser): boolean {
  if (user.is_active !== 1) return false;
  if (!user.expires_at) return true;
  return isFutureDate(user.expires_at);
}

function getUserReportIds(userId: string): string[] {
  const rows = getDb().prepare('SELECT report_id FROM user_report_access WHERE user_id = ?').all(userId) as { report_id: string }[];
  return rows.map((row) => row.report_id);
}

function getUserRlsRoles(userId: string): string[] {
  const rows = getDb().prepare('SELECT role_name FROM user_rls_roles WHERE user_id = ?').all(userId) as { role_name: string }[];
  return rows.map((row) => row.role_name);
}

function toSessionUser(user: DbUser): SessionAuthUser {
  const role = user.role;
  const reportIds = role === 'admin' ? ['*'] : getUserReportIds(user.id);
  const rlsRoles = getUserRlsRoles(user.id);

  return {
    id: user.id,
    name: user.username,
    email: user.email ?? undefined,
    role,
    reportIds,
    rlsRoles: rlsRoles.length > 0 ? rlsRoles : undefined,
  };
}

export async function findUserByEmailForMicrosoft(email: string): Promise<SessionAuthUser | null> {
  if (isAzureSqlBackend()) {
    return azureRuntime.findUserByEmailForMicrosoft(email);
  }

  await ensureDataLayer();
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const user = getDb().prepare(`
    SELECT id, username, email, password_hash, role, is_active, expires_at
    FROM users
    WHERE LOWER(email) = LOWER(?)
  `).get(normalized) as DbUser | undefined;

  if (!user || !userIsActive(user)) return null;
  return toSessionUser(user);
}

export async function findUserByMicrosoftClaims(claimCandidates: string[]): Promise<SessionAuthUser | null> {
  if (isAzureSqlBackend()) {
    return azureRuntime.findUserByMicrosoftClaims(claimCandidates);
  }

  await ensureDataLayer();

  const normalizedCandidates = Array.from(
    new Set(
      claimCandidates
        .map((claim) => normalizeEmail(claim))
        .filter((claim): claim is string => Boolean(claim))
    )
  );

  for (const candidate of normalizedCandidates) {
    const mapped = await findUserByEmailForMicrosoft(candidate);
    if (mapped) return mapped;
  }

  return null;
}

export async function getSessionUserById(userId: string): Promise<SessionAuthUser | null> {
  if (isAzureSqlBackend()) {
    return azureRuntime.getSessionUserById(userId);
  }

  await ensureDataLayer();
  const user = getDb().prepare(`
    SELECT id, username, email, password_hash, role, is_active, expires_at
    FROM users
    WHERE id = ?
  `).get(userId) as DbUser | undefined;

  if (!user || !userIsActive(user)) return null;
  return toSessionUser(user);
}

export async function getAccessibleReportsForUser(userId: string, role: UserRole): Promise<PublicReport[]> {
  if (isAzureSqlBackend()) {
    return azureRuntime.getAccessibleReportsForUser(userId, role);
  }

  await ensureDataLayer();

  const rows = role === 'admin'
    ? (getDb().prepare(`
        SELECT
          r.id,
          r.display_name,
          COUNT(a.id) AS ai_agent_count
        FROM reports r
        LEFT JOIN ai_agent_reports ar ON ar.report_id = r.id
        LEFT JOIN ai_agents a ON a.id = ar.agent_id AND a.is_active = 1
        WHERE r.is_active = 1
        GROUP BY r.id, r.display_name
        ORDER BY r.display_name ASC
      `).all() as { id: string; display_name: string; ai_agent_count: number }[])
    : (getDb().prepare(`
        SELECT
          r.id,
          r.display_name,
          COUNT(a.id) AS ai_agent_count
        FROM reports r
        INNER JOIN user_report_access ura ON ura.report_id = r.id
        LEFT JOIN ai_agent_reports ar ON ar.report_id = r.id
        LEFT JOIN ai_agents a ON a.id = ar.agent_id AND a.is_active = 1
        WHERE ura.user_id = ? AND r.is_active = 1
        GROUP BY r.id, r.display_name
        ORDER BY r.display_name ASC
      `).all(userId) as { id: string; display_name: string; ai_agent_count: number }[]);

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    hasAiAgents: Number(row.ai_agent_count) > 0,
    aiAgentCount: Number(row.ai_agent_count),
  }));
}

export async function getSecureReportConfigForUser(params: {
  userId: string;
  role: UserRole;
  requestedReportId: string;
}): Promise<SecureReportConfig | null> {
  if (isAzureSqlBackend()) {
    return azureRuntime.getSecureReportConfigForUser(params);
  }

  await ensureDataLayer();

  const report = getDb().prepare(`
    SELECT id, display_name, workspace_id, report_id, rls_roles_json, admin_rls_roles_json, admin_rls_username, is_active
    FROM reports
    WHERE id = ?
  `).get(params.requestedReportId) as DbReport | undefined;

  if (!report || report.is_active !== 1) return null;

  if (params.role !== 'admin') {
    const access = getDb().prepare('SELECT 1 FROM user_report_access WHERE user_id = ? AND report_id = ?').get(params.userId, params.requestedReportId);
    if (!access) return null;
  }

  return {
    id: report.id,
    displayName: report.display_name,
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
  isActive: boolean;
  expiresAt?: string;
  reportIds: string[];
  rlsRoles: string[];
}>> {
  if (isAzureSqlBackend()) {
    return azureRuntime.listUsersForAdmin();
  }

  await ensureDataLayer();
  const rows = getDb().prepare(`
    SELECT id, username, email, role, is_active, expires_at
    FROM users
    ORDER BY username ASC
  `).all() as DbUser[];

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email ?? undefined,
    role: row.role,
    isActive: row.is_active === 1,
    expiresAt: row.expires_at ?? undefined,
    reportIds: getUserReportIds(row.id),
    rlsRoles: getUserRlsRoles(row.id),
  }));
}

export async function listReportsForAdmin(): Promise<SecureReportConfig[]> {
  if (isAzureSqlBackend()) {
    return azureRuntime.listReportsForAdmin();
  }

  await ensureDataLayer();
  const rows = getDb().prepare(`
    SELECT id, display_name, workspace_id, report_id, rls_roles_json, admin_rls_roles_json, admin_rls_username, is_active
    FROM reports
    ORDER BY display_name ASC
  `).all() as DbReport[];

  return rows
    .filter((row) => row.is_active === 1)
    .map((row) => ({
      id: row.id,
      displayName: row.display_name,
      workspaceId: row.workspace_id,
      reportId: row.report_id,
      rlsRoles: parseJsonArray(row.rls_roles_json),
      adminRlsRoles: parseJsonArray(row.admin_rls_roles_json),
      adminRlsUsername: row.admin_rls_username ?? undefined,
    }));
}

export async function createUserFromAdmin(input: CreateUserInput): Promise<void> {
  if (isAzureSqlBackend()) {
    await azureRuntime.createUserFromAdmin(input);
    return;
  }

  await ensureDataLayer();

  const username = normalizeUsername(input.username);
  if (!username) throw new Error('Username is required.');
  const email = normalizeEmail(input.email);
  if (!email) throw new Error('Email is required for Microsoft authentication mapping.');

  const userId = randomUUID();
  getDb().prepare(`
    INSERT INTO users (id, username, email, password_hash, role, is_active, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    username,
    email,
    null,
    input.role,
    input.isActive === false ? 0 : 1,
    input.expiresAt ?? null,
    nowIso(),
    nowIso()
  );

  const insertAccess = getDb().prepare('INSERT OR IGNORE INTO user_report_access (user_id, report_id, created_at) VALUES (?, ?, ?)');
  for (const reportId of input.reportIds) {
    insertAccess.run(userId, reportId, nowIso());
  }

  const insertRls = getDb().prepare('INSERT OR IGNORE INTO user_rls_roles (user_id, role_name, created_at) VALUES (?, ?, ?)');
  for (const roleName of input.rlsRoles ?? []) {
    if (!roleName.trim()) continue;
    insertRls.run(userId, roleName.trim(), nowIso());
  }
}

export async function createReportFromAdmin(input: CreateReportInput): Promise<void> {
  if (isAzureSqlBackend()) {
    await azureRuntime.createReportFromAdmin(input);
    return;
  }

  await ensureDataLayer();
  getDb().prepare(`
    INSERT INTO reports (
      id, display_name, workspace_id, report_id,
      rls_roles_json, admin_rls_roles_json, admin_rls_username,
      is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.displayName,
    input.workspaceId,
    input.reportId,
    JSON.stringify(input.rlsRoles ?? []),
    JSON.stringify(input.adminRlsRoles ?? []),
    input.adminRlsUsername ?? null,
    input.isActive === false ? 0 : 1,
    nowIso(),
    nowIso()
  );
}

export async function listAIAgentsForAdmin(): Promise<AIAgentConfig[]> {
  if (isAzureSqlBackend()) {
    return azureRuntime.listAIAgentsForAdmin();
  }

  await ensureDataLayer();
  const rows = getDb().prepare(`
    SELECT id, name, published_url, mcp_url, mcp_tool_name, is_active
    FROM ai_agents
    ORDER BY name ASC
  `).all() as DbAIAgent[];

  const reportRows = getDb().prepare(`
    SELECT agent_id, report_id
    FROM ai_agent_reports
  `).all() as Array<{ agent_id: string; report_id: string }>;

  const reportMap = new Map<string, string[]>();
  for (const row of reportRows) {
    const current = reportMap.get(row.agent_id) ?? [];
    current.push(row.report_id);
    reportMap.set(row.agent_id, current);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    publishedUrl: row.published_url,
    mcpUrl: row.mcp_url ?? undefined,
    mcpToolName: row.mcp_tool_name ?? undefined,
    reportIds: reportMap.get(row.id) ?? [],
    isActive: row.is_active === 1,
  }));
}

export async function createAIAgentFromAdmin(input: CreateAIAgentInput): Promise<void> {
  if (isAzureSqlBackend()) {
    await azureRuntime.createAIAgentFromAdmin(input);
    return;
  }

  await ensureDataLayer();
  if (!input.name.trim()) throw new Error('Agent name is required.');
  if (!input.publishedUrl.trim()) throw new Error('Published URL is required.');
  if (input.reportIds.length === 0) throw new Error('At least one report must be associated.');

  const agentId = randomUUID();

  getDb().prepare(`
    INSERT INTO ai_agents (id, name, published_url, mcp_url, mcp_tool_name, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agentId,
    input.name.trim(),
    input.publishedUrl.trim(),
    input.mcpUrl?.trim() || null,
    input.mcpToolName?.trim() || null,
    input.isActive === false ? 0 : 1,
    nowIso(),
    nowIso()
  );

  const insertLink = getDb().prepare(`
    INSERT OR IGNORE INTO ai_agent_reports (agent_id, report_id, created_at)
    VALUES (?, ?, ?)
  `);
  for (const reportId of input.reportIds) {
    insertLink.run(agentId, reportId, nowIso());
  }
}

export async function getAIAgentsForReport(params: {
  userId: string;
  role: UserRole;
  reportId: string;
}): Promise<AIAgentConfig[]> {
  if (isAzureSqlBackend()) {
    return azureRuntime.getAIAgentsForReport(params);
  }

  await ensureDataLayer();

  if (params.role !== 'admin') {
    const access = getDb().prepare(`
      SELECT 1 FROM user_report_access WHERE user_id = ? AND report_id = ?
    `).get(params.userId, params.reportId);
    if (!access) return [];
  }

  const rows = getDb().prepare(`
    SELECT a.id, a.name, a.published_url, a.mcp_url, a.mcp_tool_name, a.is_active
    FROM ai_agents a
    INNER JOIN ai_agent_reports ar ON ar.agent_id = a.id
    WHERE ar.report_id = ? AND a.is_active = 1
    ORDER BY a.name ASC
  `).all(params.reportId) as DbAIAgent[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    publishedUrl: row.published_url,
    mcpUrl: row.mcp_url ?? undefined,
    mcpToolName: row.mcp_tool_name ?? undefined,
    reportIds: [params.reportId],
    isActive: row.is_active === 1,
  }));
}

export async function getAIAgentByIdForUser(params: {
  userId: string;
  role: UserRole;
  agentId: string;
  reportId?: string;
}): Promise<AIAgentConfig | null> {
  if (isAzureSqlBackend()) {
    return azureRuntime.getAIAgentByIdForUser(params);
  }

  await ensureDataLayer();

  const agent = getDb().prepare(`
    SELECT id, name, published_url, mcp_url, mcp_tool_name, is_active
    FROM ai_agents
    WHERE id = ? AND is_active = 1
  `).get(params.agentId) as DbAIAgent | undefined;
  if (!agent) return null;

  const linkedReports = getDb().prepare(`
    SELECT report_id
    FROM ai_agent_reports
    WHERE agent_id = ?
  `).all(params.agentId) as Array<{ report_id: string }>;

  const reportIds = linkedReports.map((row) => row.report_id);
  if (reportIds.length === 0) return null;

  if (params.reportId && !reportIds.includes(params.reportId)) return null;

  if (params.role !== 'admin') {
    const placeholders = reportIds.map(() => '?').join(',');
    const allowedRows = getDb().prepare(`
      SELECT report_id
      FROM user_report_access
      WHERE user_id = ? AND report_id IN (${placeholders})
    `).all(params.userId, ...reportIds) as Array<{ report_id: string }>;

    const allowedReportSet = new Set(allowedRows.map((row) => row.report_id));
    const hasAccess = params.reportId ? allowedReportSet.has(params.reportId) : allowedReportSet.size > 0;
    if (!hasAccess) return null;
  }

  return {
    id: agent.id,
    name: agent.name,
    publishedUrl: agent.published_url,
    mcpUrl: agent.mcp_url ?? undefined,
    mcpToolName: agent.mcp_tool_name ?? undefined,
    reportIds,
    isActive: agent.is_active === 1,
  };
}

export async function recordAuditEvent(params: {
  eventType: string;
  userId?: string;
  ip?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  if (isAzureSqlBackend()) {
    await azureRuntime.recordAuditEvent(params);
    return;
  }

  await ensureDataLayer();
  getDb().prepare(`
    INSERT INTO audit_log (event_type, user_id, ip, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    params.eventType,
    params.userId ?? null,
    params.ip ?? null,
    params.detail ? JSON.stringify(params.detail) : null,
    nowIso()
  );
}
