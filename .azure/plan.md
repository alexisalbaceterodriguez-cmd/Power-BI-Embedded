# Azure Modernization Plan

## Goal
Implement Microsoft Entra ID as the only authentication method, remove local credential-based auth, and standardize multi-tenant secret management for Azure Web App.

## Scope
- Remove Credentials auth flow and local password logic.
- Keep Microsoft Entra ID mapping by email claims.
- Redesign user/admin flows to be passwordless (identity-linked users).
- Standardize environment variable naming and migration compatibility.
- Update deployment/security documentation for Azure Web App + Key Vault references.

## Decisions
- Deployment model: single Azure Web App for multiple clients.
- Identity model: dedicated app registration/service principal per client.
- Rollout model: two phases (compatibility then cleanup).

## Work Items
1. Refactor auth runtime to Microsoft-only.
2. Remove DAL local-auth and bcrypt dependencies.
3. Update admin API/UI to create users without passwords.
4. Unify env variable access (AZURE_* canonical with fallback aliases).
5. Update docs and operational manuals.
6. Validate build/lint and perform grep-based verification.

## Status
Completed
