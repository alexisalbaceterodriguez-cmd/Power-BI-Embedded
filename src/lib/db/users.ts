import { randomUUID } from 'node:crypto';
import { queryRows, queryOne, sql, nowIso, normalizeEmail, normalizeUsername, normalizeIdList, isFutureDate, toBit, toBoolean } from '@/lib/db/pool';
import type { DbUser } from '@/lib/db/types';
import type { CreateUserInput, SessionAuthUser, UpdateUserInput, UserRole } from '@/lib/dal';
import { ensureDataLayer } from '@/lib/db/schema';
import { ensureClientExists } from '@/lib/db/clients';
import { validateReportIdsBelongToClient } from '@/lib/db/reports';

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

  const [rows, allReportAccess, allRlsRoles] = await Promise.all([
    queryRows<DbUser>(
      `SELECT id, username, email, role, client_id, is_active, expires_at
       FROM users
       ORDER BY username ASC`
    ),
    queryRows<{ user_id: string; report_id: string }>(
      'SELECT user_id, report_id FROM user_report_access'
    ),
    queryRows<{ user_id: string; role_name: string }>(
      'SELECT user_id, role_name FROM user_rls_roles'
    ),
  ]);

  const reportMap = new Map<string, string[]>();
  for (const r of allReportAccess) {
    const list = reportMap.get(r.user_id) ?? [];
    list.push(r.report_id);
    reportMap.set(r.user_id, list);
  }

  const rlsMap = new Map<string, string[]>();
  for (const r of allRlsRoles) {
    const list = rlsMap.get(r.user_id) ?? [];
    list.push(r.role_name);
    rlsMap.set(r.user_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email ?? undefined,
    role: row.role,
    clientId: row.client_id ?? undefined,
    isActive: toBoolean(row.is_active),
    expiresAt: row.expires_at ?? undefined,
    reportIds: reportMap.get(row.id) ?? [],
    rlsRoles: rlsMap.get(row.id) ?? [],
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
