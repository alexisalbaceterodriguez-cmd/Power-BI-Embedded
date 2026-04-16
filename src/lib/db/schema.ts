import { getPool } from '@/lib/db/pool';
import { seedBootstrapData, backfillDefaultClientsAndAssignments } from '@/lib/db/bootstrap';

let initialized = false;

export const schemaSql = `
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

export async function ensureDataLayer(): Promise<void> {
  if (initialized) return;
  const p = await getPool();
  await p.request().batch(schemaSql);
  await seedBootstrapData();
  await backfillDefaultClientsAndAssignments();
  initialized = true;
}
