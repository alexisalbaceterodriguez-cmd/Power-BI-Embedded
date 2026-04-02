# Manual Operativo (Foundry-Only)

Este manual describe la operacion de usuarios, reportes y agentes Azure AI Foundry.

## 1) Alcance

1. Gestion de usuarios y permisos de reportes.
2. Configuracion RLS por usuario.
3. Alta y mantenimiento de agentes IA Foundry.
4. Troubleshooting y validaciones de produccion.

Fuente de verdad: Azure SQL.

## 2) Requisitos previos

1. Aplicacion desplegada o en local (`npm run dev`).
2. Login con usuario `admin`.
3. Endpoint admin disponible en `/admin`.

Tablas clave:

- `users`
- `reports`
- `user_report_access`
- `user_rls_roles`
- `ai_agents`
- `ai_agent_reports`
- `audit_log`

## 3) Gestion de usuarios

En `/admin` > pestaña `Usuarios`:

1. Crear usuario con `username`, `email`, `role` y `cliente`.
2. Asignar reportes autorizados.
3. Definir `RLS roles` (csv) cuando aplique.
4. Activar o desactivar usuario.

Validaciones:

- El email debe corresponder a claims de Microsoft Entra ID.
- Usuarios `client` solo deben tener reportes de su cliente.

## 4) Gestion de reportes

En `/admin` > pestaña `Informes`:

1. Definir `id`, `displayName`, `workspaceId`, `reportId`, `clientId`.
2. Configurar `rlsRoles` y `adminRlsRoles` cuando corresponda.
3. Activar/desactivar reporte.

## 5) Gestion de agentes Foundry

En `/admin` > pestaña `Agentes IA`:

Campos del agente:

1. `Nombre`.
2. `Cliente`.
3. `Responses Endpoint` de la aplicación publicada en Foundry.
4. `Activity Endpoint` (opcional).
5. `Proyecto Foundry` (opcional).
6. `Nombre de agente Foundry` (opcional).
7. `Version de agente` (opcional).
8. `Modo de seguridad`:
   - `Sin RLS`
   - `RLS heredado del usuario`
9. `Informes vinculados`.

Nota:

- En esta release, columnas legacy de Fabric quedan deprecadas en BD para compatibilidad temporal, pero no se usan en UI ni runtime.

## 6) Flujos de validacion

1. Verificar schema y migracion:
   - `npm run db:azure:init`
2. Seed inicial (solo entorno limpio):
   - `npm run db:azure:seed`
3. Validar salud de Foundry:
   - `npm run foundry:health`
4. Build de regresion:
   - `npm run build`

## 7) Troubleshooting rapido

1. `401/403` en chat Foundry:
   - Revisar `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`.
   - Revisar RBAC en recurso/proyecto Foundry.
2. Usuario no ve informes:
   - Revisar `user_report_access`, cliente y estado activo.
3. Error de datos con RLS:
   - Revisar `user_rls_roles` y modo de seguridad del agente.

## 8) Seguridad operativa

1. Guardar secretos en Key Vault.
2. Rotar `AZURE_CLIENT_SECRET` y `NEXTAUTH_SECRET`.
3. Activar logs y alertas sobre `audit_log` y errores de chat.
4. Aplicar principio de minimo privilegio en roles de Azure.
