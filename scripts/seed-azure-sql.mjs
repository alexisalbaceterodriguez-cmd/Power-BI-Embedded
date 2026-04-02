import sql from 'mssql';
import { randomUUID } from 'node:crypto';

function getEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : fallback;
}

function parseJsonArrayEnv(name) {
  const raw = getEnv(name);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeEmail(value) {
  if (!value) return null;
  const trimmed = String(value).trim().toLowerCase();
  return trimmed || null;
}

function normalizeUsername(value) {
  return String(value ?? '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeBootstrapAgent(agent) {
  const responsesEndpoint = String(agent.responsesEndpoint ?? agent.publishedUrl ?? '').trim();
  if (!responsesEndpoint) return null;

  return {
    name: String(agent.name ?? '').trim() || 'foundry-agent',
    clientId: String(agent.clientId ?? 'cliente-1').trim().toLowerCase(),
    responsesEndpoint,
    activityEndpoint: typeof agent.activityEndpoint === 'string' ? agent.activityEndpoint.trim() : '',
    foundryProject: typeof agent.foundryProject === 'string' ? agent.foundryProject.trim() : '',
    foundryAgentName: typeof agent.foundryAgentName === 'string' ? agent.foundryAgentName.trim() : '',
    foundryAgentVersion: typeof agent.foundryAgentVersion === 'string' ? agent.foundryAgentVersion.trim() : '',
    securityMode: agent.securityMode === 'rls-inherit' ? 'rls-inherit' : 'none',
    migrationStatus: 'manual',
    reportIds: Array.isArray(agent.reportIds) ? agent.reportIds : [],
    isActive: agent.isActive !== false,
  };
}

function buildConfig() {
  const authMode = getEnv('AZURE_SQL_AUTH_MODE', 'azure-default').toLowerCase();
  const server = getEnv('AZURE_SQL_SERVER');
  const database = getEnv('AZURE_SQL_DATABASE');
  if (!server || !database) {
    throw new Error('AZURE_SQL_SERVER and AZURE_SQL_DATABASE are required');
  }

  const base = {
    server,
    database,
    options: {
      encrypt: getEnv('AZURE_SQL_ENCRYPT', 'true').toLowerCase() !== 'false',
      trustServerCertificate: getEnv('AZURE_SQL_TRUST_SERVER_CERTIFICATE', 'false').toLowerCase() === 'true',
    },
  };

  if (authMode === 'sql') {
    const user = getEnv('AZURE_SQL_USER');
    const password = getEnv('AZURE_SQL_PASSWORD');
    if (!user || !password) {
      throw new Error('AZURE_SQL_USER and AZURE_SQL_PASSWORD are required for sql auth mode');
    }
    return { ...base, user, password };
  }

  return {
    ...base,
    authentication: {
      type: 'azure-active-directory-default',
      options: {},
    },
  };
}

async function run() {
  const conn = await sql.connect(buildConfig());

  const clients = parseJsonArrayEnv('BOOTSTRAP_CLIENTS_JSON');
  const reports = parseJsonArrayEnv('BOOTSTRAP_REPORTS_JSON');
  const users = parseJsonArrayEnv('BOOTSTRAP_USERS_JSON');
  const agents = parseJsonArrayEnv('BOOTSTRAP_AI_AGENTS_JSON');

  const initialClients = clients.length > 0
    ? clients
    : [
      { id: 'cliente-1', displayName: 'Cliente 1', isActive: true },
      { id: 'cliente-2', displayName: 'Cliente 2', isActive: true },
    ];

  for (const client of initialClients) {
    const id = String(client.id ?? '').trim().toLowerCase();
    const displayName = String(client.displayName ?? client.id ?? '').trim();
    if (!id || !displayName) continue;

    await conn.request()
      .input('id', sql.NVarChar(128), id)
      .input('display_name', sql.NVarChar(256), displayName)
      .input('is_active', sql.Bit, client.isActive === false ? 0 : 1)
      .input('created_at', sql.DateTime2, nowIso())
      .input('updated_at', sql.DateTime2, nowIso())
      .query(`IF NOT EXISTS (SELECT 1 FROM clients WHERE id=@id)
              INSERT INTO clients (id, display_name, is_active, created_at, updated_at)
              VALUES (@id, @display_name, @is_active, @created_at, @updated_at)`);
  }

  const existingReports = (await conn.request().query('SELECT COUNT(*) AS c FROM reports')).recordset[0].c;
  if (existingReports === 0) {
    for (const report of reports) {
      const reportClientId = String(report.clientId ?? 'cliente-1').trim().toLowerCase();
      await conn.request()
        .input('id', sql.NVarChar(128), report.id)
        .input('display_name', sql.NVarChar(256), report.displayName)
        .input('client_id', sql.NVarChar(128), reportClientId)
        .input('workspace_id', sql.NVarChar(128), report.workspaceId)
        .input('report_id', sql.NVarChar(128), report.reportId)
        .input('rls_roles_json', sql.NVarChar(sql.MAX), JSON.stringify(report.rlsRoles ?? []))
        .input('admin_rls_roles_json', sql.NVarChar(sql.MAX), JSON.stringify(report.adminRlsRoles ?? []))
        .input('admin_rls_username', sql.NVarChar(256), report.adminRlsUsername ?? null)
        .input('is_active', sql.Bit, report.isActive === false ? 0 : 1)
        .input('created_at', sql.DateTime2, nowIso())
        .input('updated_at', sql.DateTime2, nowIso())
        .query(`INSERT INTO reports (id, display_name, client_id, workspace_id, report_id, rls_roles_json, admin_rls_roles_json, admin_rls_username, is_active, created_at, updated_at)
          VALUES (@id, @display_name, @client_id, @workspace_id, @report_id, @rls_roles_json, @admin_rls_roles_json, @admin_rls_username, @is_active, @created_at, @updated_at)`);
    }
  }

  const existingUsers = (await conn.request().query('SELECT COUNT(*) AS c FROM users')).recordset[0].c;
  if (existingUsers === 0) {
    const adminUsername = normalizeUsername(getEnv('BOOTSTRAP_ADMIN_USERNAME', 'admin'));
    const adminEmail = normalizeEmail(getEnv('BOOTSTRAP_ADMIN_EMAIL'));
    if (adminEmail) {
      const adminId = randomUUID();
      await conn.request()
        .input('id', sql.NVarChar(64), adminId)
        .input('username', sql.NVarChar(128), adminUsername)
        .input('email', sql.NVarChar(256), adminEmail)
        .input('created_at', sql.DateTime2, nowIso())
        .input('updated_at', sql.DateTime2, nowIso())
        .query(`INSERT INTO users (id, username, email, password_hash, role, client_id, is_active, expires_at, created_at, updated_at)
          VALUES (@id, @username, @email, NULL, 'admin', NULL, 1, NULL, @created_at, @updated_at)`);

      const reportRows = (await conn.request().query('SELECT id FROM reports WHERE is_active = 1')).recordset;
      for (const row of reportRows) {
        await conn.request()
          .input('user_id', sql.NVarChar(64), adminId)
          .input('report_id', sql.NVarChar(128), row.id)
          .input('created_at', sql.DateTime2, nowIso())
          .query(`IF NOT EXISTS (SELECT 1 FROM user_report_access WHERE user_id=@user_id AND report_id=@report_id)
                  INSERT INTO user_report_access (user_id, report_id, created_at) VALUES (@user_id, @report_id, @created_at)`);
      }
    }

    for (const user of users) {
      const email = normalizeEmail(user.email);
      const username = normalizeUsername(user.username);
      if (!email || !username) continue;
      const userId = user.id || randomUUID();
      const userClientId = String(user.clientId ?? 'cliente-1').trim().toLowerCase();

      await conn.request()
        .input('id', sql.NVarChar(64), userId)
        .input('username', sql.NVarChar(128), username)
        .input('email', sql.NVarChar(256), email)
        .input('role', sql.NVarChar(16), user.role)
        .input('client_id', sql.NVarChar(128), user.role === 'admin' ? null : userClientId)
        .input('is_active', sql.Bit, user.isActive === false ? 0 : 1)
        .input('expires_at', sql.DateTime2, user.expiresAt ?? null)
        .input('created_at', sql.DateTime2, nowIso())
        .input('updated_at', sql.DateTime2, nowIso())
        .query(`IF NOT EXISTS (SELECT 1 FROM users WHERE id=@id)
                INSERT INTO users (id, username, email, password_hash, role, client_id, is_active, expires_at, created_at, updated_at)
                VALUES (@id, @username, @email, NULL, @role, @client_id, @is_active, @expires_at, @created_at, @updated_at)`);

      for (const reportId of user.reportIds ?? []) {
        await conn.request()
          .input('user_id', sql.NVarChar(64), userId)
          .input('report_id', sql.NVarChar(128), reportId)
          .input('created_at', sql.DateTime2, nowIso())
          .query(`IF NOT EXISTS (SELECT 1 FROM user_report_access WHERE user_id=@user_id AND report_id=@report_id)
                  INSERT INTO user_report_access (user_id, report_id, created_at) VALUES (@user_id, @report_id, @created_at)`);
      }

      for (const roleNameRaw of user.rlsRoles ?? []) {
        const roleName = String(roleNameRaw ?? '').trim();
        if (!roleName) continue;
        await conn.request()
          .input('user_id', sql.NVarChar(64), userId)
          .input('role_name', sql.NVarChar(128), roleName)
          .input('created_at', sql.DateTime2, nowIso())
          .query(`IF NOT EXISTS (SELECT 1 FROM user_rls_roles WHERE user_id=@user_id AND role_name=@role_name)
                  INSERT INTO user_rls_roles (user_id, role_name, created_at) VALUES (@user_id, @role_name, @created_at)`);
      }
    }
  }

  const existingAgents = (await conn.request().query('SELECT COUNT(*) AS c FROM ai_agents')).recordset[0].c;
  if (existingAgents === 0) {
    for (const agent of agents) {
      const normalizedAgent = normalizeBootstrapAgent(agent);
      if (!normalizedAgent) continue;
      const agentId = randomUUID();
      await conn.request()
        .input('id', sql.NVarChar(64), agentId)
        .input('name', sql.NVarChar(256), normalizedAgent.name)
        .input('client_id', sql.NVarChar(128), normalizedAgent.clientId)
        .input('responses_endpoint', sql.NVarChar(2048), normalizedAgent.responsesEndpoint)
        .input('activity_endpoint', sql.NVarChar(2048), normalizedAgent.activityEndpoint || null)
        .input('foundry_project', sql.NVarChar(256), normalizedAgent.foundryProject || null)
        .input('foundry_agent_name', sql.NVarChar(256), normalizedAgent.foundryAgentName || null)
        .input('foundry_agent_version', sql.NVarChar(64), normalizedAgent.foundryAgentVersion || null)
        .input('security_mode', sql.NVarChar(32), normalizedAgent.securityMode)
        .input('migration_status', sql.NVarChar(32), normalizedAgent.migrationStatus)
        .input('published_url', sql.NVarChar(1024), normalizedAgent.responsesEndpoint)
        .input('mcp_url', sql.NVarChar(1024), null)
        .input('mcp_tool_name', sql.NVarChar(256), null)
        .input('is_active', sql.Bit, normalizedAgent.isActive === false ? 0 : 1)
        .input('created_at', sql.DateTime2, nowIso())
        .input('updated_at', sql.DateTime2, nowIso())
        .query(`INSERT INTO ai_agents (id, name, client_id, responses_endpoint, activity_endpoint, foundry_project, foundry_agent_name, foundry_agent_version, security_mode, migration_status, published_url, mcp_url, mcp_tool_name, is_active, created_at, updated_at)
          VALUES (@id, @name, @client_id, @responses_endpoint, @activity_endpoint, @foundry_project, @foundry_agent_name, @foundry_agent_version, @security_mode, @migration_status, @published_url, @mcp_url, @mcp_tool_name, @is_active, @created_at, @updated_at)`);

      for (const reportId of normalizedAgent.reportIds ?? []) {
        await conn.request()
          .input('agent_id', sql.NVarChar(64), agentId)
          .input('report_id', sql.NVarChar(128), reportId)
          .input('created_at', sql.DateTime2, nowIso())
          .query(`IF NOT EXISTS (SELECT 1 FROM ai_agent_reports WHERE agent_id=@agent_id AND report_id=@report_id)
                  INSERT INTO ai_agent_reports (agent_id, report_id, created_at) VALUES (@agent_id, @report_id, @created_at)`);
      }
    }
  }

  await conn.request().query(`UPDATE reports SET client_id='cliente-1' WHERE client_id IS NULL AND display_name IN ('Finance Controlling','Informe Webinar')`);
  await conn.request().query(`UPDATE reports SET client_id='cliente-2' WHERE client_id IS NULL AND display_name IN ('Calculadora de precio optimo','Calculadora de precio óptimo')`);
  await conn.request().query(`UPDATE reports SET client_id='cliente-1' WHERE client_id IS NULL`);
  await conn.request().query(`UPDATE users SET client_id='cliente-1' WHERE role <> 'admin' AND client_id IS NULL`);
  await conn.request().query(`UPDATE ai_agents
                              SET client_id = COALESCE(
                                (SELECT TOP (1) r.client_id FROM ai_agent_reports ar INNER JOIN reports r ON r.id = ar.report_id WHERE ar.agent_id = ai_agents.id),
                                'cliente-1'
                              )
                              WHERE client_id IS NULL`);

  await conn.close();
  console.log('Azure SQL bootstrap seed completed successfully.');
}

run().catch((error) => {
  console.error('Failed to seed Azure SQL:', error.message);
  process.exit(1);
});
