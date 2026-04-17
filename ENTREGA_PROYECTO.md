# Entrega tecnica

## Objetivo

Portal Power BI Embedded multi-cliente con autenticacion Microsoft Entra ID, chat IA integrado via Fabric Data Agents (MCP) y administracion completa desde un panel web.

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

### Chat con Fabric Data Agents

- Chat integrado en el dashboard junto al informe Power BI.
- Selector de agente cuando hay multiples agentes disponibles para un informe.
- Comunicacion server-side (API route) con el agente via **MCP JSON-RPC 2.0** sobre HTTPS.
- Flujo **OBO (On-Behalf-Of)**: el token del usuario se intercambia por un token con scope Fabric para que el agente se autentique como el usuario real. Si el intercambio falla (p.ej. token de sesion caducado), la llamada cae a token de Service Principal como fallback.
- Permisos delegados registrados en Entra ID: `DataAgent.Execute.All` y `SemanticModel.Execute.All` (admin consent otorgado).
- Modo de seguridad `rls-inherit` para pasar contexto de usuario al agente.
- Panel de chat completamente rediseñado: historial persistente por agente, indicador de pensando con tiempo transcurrido, timestamps en cada mensaje, atajo Enter-to-send y estado de bienvenida.

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

- `EnrichedToken` interface en `auth.ts` elimina 5 castings verbosos; incluye `accessToken`, `refreshToken` y `accessTokenExpires` para el flujo OBO.
- Helper `splitCsv` extraido a `src/lib/utils.ts` (antes duplicado en 3 ficheros).
- Eliminados `wrangler.json` y directorio `src/config/` vacios.
- Selector multi-agente en `AIAgentDrawer` (antes fijo en `agents[0]`).
- `getToken` en `/api/ai-agents/chat/route.ts` envuelto en try/catch propio con secret explicito (`NEXTAUTH_SECRET`) para evitar crash `MissingSecret` cuando el entorno no tiene `AUTH_SECRET`.

### Modernizacion de UI

- `AIAgentDrawer.tsx` reescrito con historial de chat por agente (`historyMap`), componente `ThinkingIndicator` con puntos animados y contador de tiempo transcurrido, timestamps en cada burbuja, auto-scroll, auto-focus, Enter-to-send (Shift+Enter para salto de linea) y estado de bienvenida cuando no hay mensajes.
- CSS completamente modernizado: glassmorphism en header, sidebar y drawer (backdrop-filter), animaciones de entrada, burbujas con animacion `bubbleIn`, scrollbar personalizado, boton de envio con gradiente, `.login-btn` con sombra y efecto hover lift, `.header-ai-btn` con borde de color, avatares con bordes redondeados y gradiente.
- La capa de estilos es **Vanilla CSS** con custom properties en `globals.css` (~1200 lineas); Tailwind v4 esta instalado pero no se usa.

## Pendientes operativos (fuera de codigo)

1. Rotar secretos historicos y almacenarlos en Key Vault.
2. ~~Obtener admin consent para `DataAgent.Execute.All` y `SemanticModel.Execute.All`~~ **Completado** — consent otorgado el 17/04/2026. OBO activado.
3. Configurar alertas en Application Insights sobre errores 5xx y latencia.
4. Borrado fisico de columnas `mcp_*` en `ai_agents` en una migracion controlada futura.
5. Migrar autenticacion de GitHub Actions de `AZURE_CREDENTIALS` (SP) a OIDC federated credentials.
