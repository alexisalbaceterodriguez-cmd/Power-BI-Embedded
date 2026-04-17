import { randomUUID } from 'node:crypto';
import type { CreateAIAgentInput, CreateReportInput, UserRole } from '@/lib/dal';
import { queryRows, queryOne, sql, normalizeClientId, normalizeEmail, normalizeUsername, toBit, nowIso } from '@/lib/db/pool';

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
        agentType: entry.agentType === 'foundry-responses' ? 'foundry-responses' : 'fabric-mcp',
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

export async function backfillDefaultClientsAndAssignments(): Promise<void> {
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

}

export async function seedBootstrapData(): Promise<void> {
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
    const normalizedEmail2 = normalizeEmail(user.email);
    if (!normalizedEmail2) continue;

    const normalizedUsername2 = normalizeUsername(user.username);
    if (!normalizedUsername2 || normalizedUsername2.toLowerCase() === adminUsername.toLowerCase()) continue;

    const userId = user.id ?? randomUUID();
    const userClientId = normalizeClientId(user.clientId) ?? 'cliente-1';
    await queryRows(
      `INSERT INTO users
        (id, username, email, password_hash, role, client_id, is_active, expires_at, created_at, updated_at)
       VALUES (@id, @username, @email, NULL, @role, @client_id, @is_active, @expires_at, @created_at, @updated_at)`,
      (request) => {
        request.input('id', sql.NVarChar(64), userId);
        request.input('username', sql.NVarChar(128), normalizedUsername2);
        request.input('email', sql.NVarChar(256), normalizedEmail2);
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
        (id, name, client_id, responses_endpoint, activity_endpoint, foundry_project, foundry_agent_name, foundry_agent_version, security_mode, migration_status, published_url, is_active, created_at, updated_at)
       VALUES (@id, @name, @client_id, @responses_endpoint, @activity_endpoint, @foundry_project, @foundry_agent_name, @foundry_agent_version, @security_mode, @migration_status, @published_url, @is_active, @created_at, @updated_at)`,
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
