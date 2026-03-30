import 'server-only';

import * as azureRuntime from '@/lib/dalAzureRuntime';

export type UserRole = 'admin' | 'client';

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

function assertAzureSqlConfigured(): void {
  if (!process.env.AZURE_SQL_SERVER?.trim() || !process.env.AZURE_SQL_DATABASE?.trim()) {
    throw new Error('Azure SQL backend is required. Configure AZURE_SQL_SERVER and AZURE_SQL_DATABASE.');
  }
}

export async function ensureDataLayer(): Promise<void> {
  assertAzureSqlConfigured();
  await azureRuntime.ensureDataLayer();
}

export async function findUserByEmailForMicrosoft(email: string): Promise<SessionAuthUser | null> {
  await ensureDataLayer();
  return azureRuntime.findUserByEmailForMicrosoft(email);
}

export async function findUserByMicrosoftClaims(claimCandidates: string[]): Promise<SessionAuthUser | null> {
  await ensureDataLayer();
  return azureRuntime.findUserByMicrosoftClaims(claimCandidates);
}

export async function getSessionUserById(userId: string): Promise<SessionAuthUser | null> {
  await ensureDataLayer();
  return azureRuntime.getSessionUserById(userId);
}

export async function getAccessibleReportsForUser(userId: string, role: UserRole): Promise<PublicReport[]> {
  await ensureDataLayer();
  return azureRuntime.getAccessibleReportsForUser(userId, role);
}

export async function getSecureReportConfigForUser(params: {
  userId: string;
  role: UserRole;
  requestedReportId: string;
}): Promise<SecureReportConfig | null> {
  await ensureDataLayer();
  return azureRuntime.getSecureReportConfigForUser(params);
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
  await ensureDataLayer();
  return azureRuntime.listUsersForAdmin();
}

export async function listReportsForAdmin(): Promise<SecureReportConfig[]> {
  await ensureDataLayer();
  return azureRuntime.listReportsForAdmin();
}

export async function createUserFromAdmin(input: CreateUserInput): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.createUserFromAdmin(input);
}

export async function createReportFromAdmin(input: CreateReportInput): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.createReportFromAdmin(input);
}

export async function listAIAgentsForAdmin(): Promise<AIAgentConfig[]> {
  await ensureDataLayer();
  return azureRuntime.listAIAgentsForAdmin();
}

export async function createAIAgentFromAdmin(input: CreateAIAgentInput): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.createAIAgentFromAdmin(input);
}

export async function getAIAgentsForReport(params: {
  userId: string;
  role: UserRole;
  reportId: string;
}): Promise<AIAgentConfig[]> {
  await ensureDataLayer();
  return azureRuntime.getAIAgentsForReport(params);
}

export async function getAIAgentByIdForUser(params: {
  userId: string;
  role: UserRole;
  agentId: string;
  reportId?: string;
}): Promise<AIAgentConfig | null> {
  await ensureDataLayer();
  return azureRuntime.getAIAgentByIdForUser(params);
}

export async function recordAuditEvent(params: {
  eventType: string;
  userId?: string;
  ip?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.recordAuditEvent(params);
}
