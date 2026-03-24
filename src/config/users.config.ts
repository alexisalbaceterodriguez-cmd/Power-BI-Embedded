/**
 * users.config.ts
 *
 * Central configuration file for users and Power BI reports.
 * Add/modify users and reports here — no database required.
 *
 * IMPORTANT: Passwords must be stored as bcrypt hashes.
 * To generate a hash, run in Node.js:
 *   const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('your-password', 10));
 *
 * RLS: If a report uses Row-Level Security, set `rlsUsername` to the UPN
 * that matches the DAX `USERPRINCIPALNAME()` function in Power BI Desktop,
 * and `rlsRoles` to the role name(s) defined in the model.
 */

export type UserRole = 'admin' | 'client';

export interface UserConfig {
  /** Unique identifier for the user */
  id: string;
  /** Login username */
  username: string;
  /** Optional email, useful for RLS mappings */
  email?: string;
  /** bcrypt hash of the password */
  passwordHash: string;
  /** Role: 'admin' sees all reports without RLS; 'client' sees only assigned reports */
  role: UserRole;
  /**
   * Array of report IDs this user can access.
   * Use ['*'] for admin users to grant access to all reports.
   */
  reportIds: string[];
}

export interface ReportConfig {
  /** Matches the reportIds array in UserConfig */
  id: string;
  /** Display name shown in the sidebar */
  displayName: string;
  /** Power BI Workspace (Group) GUID */
  workspaceId: string;
  /** Power BI Report GUID */
  reportId: string;
  /**
   * Optional: Overides RLS when the 'admin' views this report.
   * Useful when an admin needs to see all data using a special "View All/Permisos" role.
   */
  adminRlsUsername?: string;
  adminRlsRoles?: string[];
  /**
   * Optional: UPN for RLS (e.g. 'acme@empresa.com').
   * Must match the identity used in Power BI Desktop roles.
   * Leave undefined to skip RLS for this report.
   */
  rlsUsername?: string;
  /**
   * Optional: Role names defined in Power BI Desktop for this report.
   * Required when rlsUsername is set.
   */
  rlsRoles?: string[];
}

// ---------------------------------------------------------------------------
// USERS
// To add a new user:
//   1. Generate a bcrypt hash for the password (see instructions above).
//   2. Add an entry below with the reportIds this user should see.
// ---------------------------------------------------------------------------
export const USERS: UserConfig[] = [
  {
    id: '1',
    username: 'admin',
    // Default password: "12345" — CHANGE THIS IN PRODUCTION
    passwordHash: '$2b$10$W.tfBjBIpMktaYnN6VvXduKwXMWysTlGE1.fsGXACjNd.aE8GQBTq',
    role: 'admin',
    reportIds: ['*'],
  },
  {
    id: '2',
    username: 'AlexisAlbacete',
    email: 'alexis.albacete@seidor.com',
    // Password: "12345"
    passwordHash: '$2b$10$W.tfBjBIpMktaYnN6VvXduKwXMWysTlGE1.fsGXACjNd.aE8GQBTq',
    role: 'client',
    reportIds: ['informe-alexis'],
  },
  {
    id: '3',
    username: 'Alexderelite',
    email: 'alexderelite@gmail.com',
    // Password: "12345"
    passwordHash: '$2b$10$W.tfBjBIpMktaYnN6VvXduKwXMWysTlGE1.fsGXACjNd.aE8GQBTq',
    role: 'client',
    reportIds: ['informe-alexderelite'],
  },
  {
    id: '4',
    username: 'webinar',
    // Password: "12345"
    passwordHash: '$2b$10$W.tfBjBIpMktaYnN6VvXduKwXMWysTlGE1.fsGXACjNd.aE8GQBTq',
    role: 'client',
    reportIds: ['informe-webinar'],
  },
];

// ---------------------------------------------------------------------------
// REPORTS
// To add a new report:
//   1. Add an entry below with the workspaceId and reportId from Power BI.
//   2. If the report uses RLS, add rlsUsername and rlsRoles.
//   3. Assign the report 'id' to the user(s) who should see it.
// ---------------------------------------------------------------------------
export const REPORTS: ReportConfig[] = [
  {
    id: 'informe-alexis',
    displayName: 'Mi Informe de PBI',
    workspaceId: 'c34b3294-3de8-48db-a670-139b2e0a4741',
    reportId: 'e157b1cd-919b-4644-8cd1-aaa4a497e134',
    rlsUsername: 'alexis.albacete@seidor.com',
    rlsRoles: ['Empresa 10'],
  },
  {
    id: 'informe-alexderelite',
    displayName: 'Dashboard Empresa 02',
    workspaceId: 'c34b3294-3de8-48db-a670-139b2e0a4741',
    reportId: 'e157b1cd-919b-4644-8cd1-aaa4a497e134',
    rlsUsername: 'alexderelite@gmail.com',
    rlsRoles: ['Empresa 02'],
  },
  {
    id: 'informe-webinar',
    displayName: 'Informe Webinar',
    workspaceId: 'c34b3294-3de8-48db-a670-139b2e0a4741', // Misma área de trabajo
    reportId: '7edc7252-cf0c-4185-a0a9-b365153697d7',
    // Si el dataset tiene RLS, PBI obliga a usarlo. Usamos 'Permisos'
    rlsUsername: 'alexis.albacete@seidor.com',
    rlsRoles: ['Permisos'],
    // Y forzamos que el admin use estos para verlo todo
    adminRlsUsername: 'alexis.albacete@seidor.com',
    adminRlsRoles: ['Permisos'],
  },
];
