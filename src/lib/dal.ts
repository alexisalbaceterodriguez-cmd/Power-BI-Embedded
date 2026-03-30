import 'server-only';

import * as azureRuntime from '@/lib/dalAzureRuntime';

export type UserRole = 'admin' | 'client';

export interface ClientConfig {
  id: string;
  displayName: string;
  isActive: boolean;
}

export interface SessionAuthUser {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  clientId?: string;
  reportIds: string[];
  rlsRoles?: string[];
}

export interface PublicReport {
  id: string;
  displayName: string;
  clientId?: string;
  clientName?: string;
  hasAiAgents?: boolean;
  aiAgentCount?: number;
}

export interface SecureReportConfig {
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

export interface CreateUserInput {
  username: string;
  email: string;
  role: UserRole;
  clientId?: string;
  reportIds: string[];
  rlsRoles?: string[];
  isActive?: boolean;
  expiresAt?: string;
}

export interface CreateReportInput {
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

export interface AIAgentConfig {
  id: string;
  name: string;
  clientId: string;
  publishedUrl: string;
  mcpUrl?: string;
  mcpToolName?: string;
  reportIds: string[];
  isActive: boolean;
}

export interface CreateAIAgentInput {
  name: string;
  clientId: string;
  publishedUrl: string;
  mcpUrl?: string;
  mcpToolName?: string;
  reportIds: string[];
  isActive?: boolean;
}

export interface UpdateUserInput extends CreateUserInput {
  id: string;
}

export type UpdateReportInput = CreateReportInput;

export interface UpdateAIAgentInput extends CreateAIAgentInput {
  id: string;
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

export async function listClientsForAdmin(): Promise<ClientConfig[]> {
  await ensureDataLayer();
  return azureRuntime.listClientsForAdmin();
}

export async function createClientFromAdmin(input: { id: string; displayName: string; isActive?: boolean }): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.createClientFromAdmin(input);
}

export async function updateClientFromAdmin(input: { id: string; displayName: string; isActive?: boolean }): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.updateClientFromAdmin(input);
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
  clientId?: string;
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

export async function updateUserFromAdmin(input: UpdateUserInput): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.updateUserFromAdmin(input);
}

export async function deleteUserFromAdmin(id: string): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.deleteUserFromAdmin(id);
}

export async function createReportFromAdmin(input: CreateReportInput): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.createReportFromAdmin(input);
}

export async function updateReportFromAdmin(input: UpdateReportInput): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.updateReportFromAdmin(input);
}

export async function deleteReportFromAdmin(id: string): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.deleteReportFromAdmin(id);
}

export async function listAIAgentsForAdmin(): Promise<AIAgentConfig[]> {
  await ensureDataLayer();
  return azureRuntime.listAIAgentsForAdmin();
}

export async function createAIAgentFromAdmin(input: CreateAIAgentInput): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.createAIAgentFromAdmin(input);
}

export async function updateAIAgentFromAdmin(input: UpdateAIAgentInput): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.updateAIAgentFromAdmin(input);
}

export async function deleteAIAgentFromAdmin(id: string): Promise<void> {
  await ensureDataLayer();
  await azureRuntime.deleteAIAgentFromAdmin(id);
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
