# Entrega tecnica

## Objetivo

Portal Power BI Embedded multi-cliente con autenticacion Microsoft Entra ID, chat IA integrado via Azure AI Foundry y administracion completa desde un panel web.

## Funcionalidades entregadas

### Autenticacion y autorizacion

- Login exclusivo con Microsoft Entra ID (OIDC via Auth.js v5).
- Mapeo de usuario por email/claims contra Azure SQL.
- JWT de sesion con `role`, `clientId`, `reportIds` y `rlsRoles` (max 1 hora).
- Middleware de proxy (`src/proxy.ts`) que protege todas las rutas autenticadas.
- RLS estricto en tokens Power BI embed (sin fallback permisivo).

### Panel de administracion (`/admin`)

- CRUD de clientes, usuarios, informes y agentes IA.
- Filtro por cliente y busqueda en tiempo real.
- Validaciones de integridad (informes pertenecen al mismo cliente, emails de Entra ID, etc.).
- Asignacion de roles RLS por usuario.

### Chat con agentes Azure AI Foundry

- Chat integrado en el dashboard junto al informe Power BI.
- Selector de agente cuando hay multiples agentes disponibles para un informe.
- Comunicacion server-side (API route) con token de aplicacion hacia Foundry Responses API.
- Modo de seguridad `rls-inherit` para pasar contexto de usuario al agente.

### Seguridad

- Cabeceras HTTP globales: CSP, HSTS, X-Content-Type-Options, Referrer-Policy.
- Sanitizacion de errores en respuestas de API.
- Audit log de eventos en tabla `audit_log`.
- Secretos en Key Vault con referencias desde App Settings.

### Infraestructura como Codigo (IaC)

- Bicep completo en `infra/main.bicep`:
  - App Service Plan (Linux, Node 20 LTS)
  - App Service con todas las variables de entorno pre-configuradas
  - Azure SQL Server + Database
  - Key Vault con RBAC y secretos
  - Application Insights + Log Analytics
  - Managed Identity (User-Assigned) con acceso a Key Vault
- `infra/main.bicepparam` con parametros leidos desde `azd env`.
- `azure.yaml` para Azure Developer CLI (`azd up` = provision + deploy).

### CI/CD

- GitHub Actions (`.github/workflows/`) con trigger en push a `master` y `MVP-working`.
- Build + deploy automatico a Azure App Service.

## Optimizaciones tecnicas aplicadas

### DAL modular

El fichero monolito `dalAzureRuntime.ts` (~1500 lineas) ha sido refactorizado en modulos focalizados bajo `src/lib/db/`:

| Modulo | Contenido |
|--------|----------|
| `pool.ts` | Connection pool, helpers de query, utilidades |
| `types.ts` | Interfaces de filas de BD |
| `schema.ts` | DDL y `ensureDataLayer()` |
| `bootstrap.ts` | Seed inicial desde env vars |
| `clients.ts` | CRUD clientes |
| `users.ts` | CRUD usuarios y lookups de auth |
| `reports.ts` | CRUD informes y queries de acceso |
| `agents.ts` | CRUD agentes IA y queries de acceso |
| `audit.ts` | Registro de auditoría |

`dalAzureRuntime.ts` es ahora un barrel re-export de ~30 lineas. `dal.ts` no requirio cambios.

### Eliminacion de queries N+1

- `listUsersForAdmin`: cargaba 2 queries por usuario → ahora 3 queries totales (batch con `Promise.all`).
- `validateReportIdsBelongToClient`: una query por reporte → ahora una query `IN (...)`.
- `getAIAgentByIdForUser`: bucle de queries de acceso → ahora una query `IN (...)`.

### Componentes de administracion

`AdminConsole.tsx` (763 lineas) dividido en:

- `AdminConsole.tsx` — orquestador (~120 lineas)
- `UserManager.tsx` — tabla + formulario de usuarios
- `ReportManager.tsx` — tabla + formulario de informes
- `AgentManager.tsx` — tabla + formulario de agentes
- `types.ts` — interfaces y helpers compartidos

### Otras mejoras

- `EnrichedToken` interface en `auth.ts` elimina 5 castings verbosos.
- Helper `splitCsv` extraido a `src/lib/utils.ts` (antes duplicado en 3 ficheros).
- Eliminados `wrangler.json` y directorio `src/config/` vacios.
- Selector multi-agente en `AIAgentDrawer` (antes fijo en `agents[0]`).

## Pendientes operativos (fuera de codigo)

1. Rotar secretos historicos y almacenarlos en Key Vault.
2. Asignar rol `Azure AI Developer` a la Managed Identity sobre el recurso Foundry para eliminar la dependencia del Service Principal en produccion.
3. Configurar alertas en Application Insights sobre errores 5xx y latencia.
4. Borrado fisico de columnas `mcp_*` en `ai_agents` en una migracion controlada futura.
5. Migrar autenticacion de GitHub Actions de `AZURE_CREDENTIALS` (SP) a OIDC federated credentials.
