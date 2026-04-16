import type { UserRole } from '@/lib/dal';

export interface DbUser {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  client_id: string | null;
  is_active: boolean | number;
  expires_at: string | null;
}

export interface DbClient {
  id: string;
  display_name: string;
  is_active: boolean | number;
}

export interface DbReport {
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

export interface DbAIAgent {
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
