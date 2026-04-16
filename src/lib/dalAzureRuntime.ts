/**
 * dalAzureRuntime.ts - Barrel re-export from modular db/ directory.
 *
 * Previously a ~1500-line monolith. Now split into focused modules:
 *   db/pool.ts      - Connection pool, query helpers, utility functions
 *   db/types.ts     - Database row interfaces
 *   db/schema.ts    - Schema DDL and ensureDataLayer()
 *   db/bootstrap.ts - Bootstrap/seed data from env vars
 *   db/clients.ts   - Client CRUD
 *   db/users.ts     - User CRUD and auth lookups
 *   db/reports.ts   - Report CRUD and access queries
 *   db/agents.ts    - AI Agent CRUD and access queries
 *   db/audit.ts     - Audit log
 */
export {
  ensureDataLayer,
  listClientsForAdmin,
  createClientFromAdmin,
  updateClientFromAdmin,
  findUserByEmailForMicrosoft,
  findUserByMicrosoftClaims,
  getSessionUserById,
  listUsersForAdmin,
  createUserFromAdmin,
  updateUserFromAdmin,
  deleteUserFromAdmin,
  getAccessibleReportsForUser,
  getSecureReportConfigForUser,
  listReportsForAdmin,
  createReportFromAdmin,
  updateReportFromAdmin,
  deleteReportFromAdmin,
  listAIAgentsForAdmin,
  createAIAgentFromAdmin,
  updateAIAgentFromAdmin,
  deleteAIAgentFromAdmin,
  getAIAgentsForReport,
  getAIAgentByIdForUser,
  recordAuditEvent,
} from '@/lib/db/index';
