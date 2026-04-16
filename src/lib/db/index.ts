export { ensureDataLayer } from '@/lib/db/schema';
export { listClientsForAdmin, createClientFromAdmin, updateClientFromAdmin } from '@/lib/db/clients';
export { findUserByEmailForMicrosoft, findUserByMicrosoftClaims, getSessionUserById, listUsersForAdmin, createUserFromAdmin, updateUserFromAdmin, deleteUserFromAdmin } from '@/lib/db/users';
export { getAccessibleReportsForUser, getSecureReportConfigForUser, listReportsForAdmin, createReportFromAdmin, updateReportFromAdmin, deleteReportFromAdmin } from '@/lib/db/reports';
export { listAIAgentsForAdmin, createAIAgentFromAdmin, updateAIAgentFromAdmin, deleteAIAgentFromAdmin, getAIAgentsForReport, getAIAgentByIdForUser } from '@/lib/db/agents';
export { recordAuditEvent } from '@/lib/db/audit';
