import { randomUUID } from 'node:crypto';
import { queryRows, queryOne, sql, nowIso, normalizeClientId, normalizeIdList, toBit, toBoolean } from '@/lib/db/pool';
import type { DbAIAgent } from '@/lib/db/types';
import type { AIAgentConfig, CreateAIAgentInput, UpdateAIAgentInput, UserRole } from '@/lib/dal';
import { ensureDataLayer } from '@/lib/db/schema';
import { ensureClientExists } from '@/lib/db/clients';
import { validateReportIdsBelongToClient } from '@/lib/db/reports';

function toAgentConfig(row: DbAIAgent, reportIds: string[]): AIAgentConfig {
  return {
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
    reportIds,
    isActive: toBoolean(row.is_active),
  };
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

  return rows.map((row) => toAgentConfig(row, reportMap.get(row.id) ?? []));
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

  return rows.map((row) => toAgentConfig(row, [params.reportId]));
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
      const allowed = await queryOne<{ allowed: number }>(
        `SELECT TOP (1) 1 AS allowed
         FROM user_report_access ura
         INNER JOIN reports r ON r.id = ura.report_id
         WHERE ura.user_id = @userId AND r.client_id = @clientId
           AND ura.report_id IN (${reportIds.map((_, i) => `@rid${i}`).join(', ')})`,
        (request) => {
          request.input('userId', sql.NVarChar(64), params.userId);
          request.input('clientId', sql.NVarChar(128), userClientId);
          for (let i = 0; i < reportIds.length; i++) {
            request.input(`rid${i}`, sql.NVarChar(128), reportIds[i]);
          }
        }
      );
      if (!allowed) return null;
    }
  }

  return toAgentConfig(agent, reportIds);
}
