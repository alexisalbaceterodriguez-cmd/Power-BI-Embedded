export type Role = 'admin' | 'client';
export type AdminTab = 'users' | 'reports' | 'agents';

export interface ClientRow {
  id: string;
  displayName: string;
  isActive: boolean;
}

export interface UserRow {
  id: string;
  username: string;
  email?: string;
  role: Role;
  clientId?: string;
  isActive: boolean;
  expiresAt?: string;
  reportIds: string[];
  rlsRoles: string[];
}

export interface ReportRow {
  id: string;
  displayName: string;
  clientId: string;
  workspaceId: string;
  reportId: string;
  rlsRoles?: string[];
  adminRlsRoles?: string[];
  adminRlsUsername?: string;
  isActive?: boolean;
}

export interface AgentRow {
  id: string;
  name: string;
  clientId: string;
  responsesEndpoint: string;
  activityEndpoint?: string;
  foundryProject?: string;
  foundryAgentName?: string;
  foundryAgentVersion?: string;
  securityMode: 'none' | 'rls-inherit';
  migrationStatus: 'migrated' | 'legacy' | 'manual';
  reportIds: string[];
  isActive: boolean;
}

export function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatDateForInput(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 16);
}
