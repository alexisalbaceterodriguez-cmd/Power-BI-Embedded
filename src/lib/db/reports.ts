import { queryRows, queryOne, sql, nowIso, normalizeClientId, normalizeIdList, parseJsonArray, toBit, toBoolean } from '@/lib/db/pool';
import type { DbReport } from '@/lib/db/types';
import type { CreateReportInput, PublicReport, SecureReportConfig, UpdateReportInput, UserRole } from '@/lib/dal';
import { ensureDataLayer } from '@/lib/db/schema';
import { ensureClientExists } from '@/lib/db/clients';

export async function validateReportIdsBelongToClient(reportIds: string[], clientId: string): Promise<void> {
  const normalizedIds = normalizeIdList(reportIds);
  if (normalizedIds.length === 0) return;

  const rows = await queryRows<{ id: string; client_id: string | null }>(
    `SELECT id, client_id FROM reports WHERE id IN (${normalizedIds.map((_, i) => `@rid${i}`).join(', ')})`,
    (request) => {
      for (let i = 0; i < normalizedIds.length; i++) {
        request.input(`rid${i}`, sql.NVarChar(128), normalizedIds[i]);
      }
    }
  );

  const found = new Map(rows.map((r) => [r.id, r.client_id]));
  for (const reportId of normalizedIds) {
    const foundClientId = found.get(reportId);
    if (foundClientId === undefined) throw new Error(`Report not found: ${reportId}`);
    if (foundClientId !== clientId) {
      throw new Error(`Report ${reportId} does not belong to client ${clientId}`);
    }
  }
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
