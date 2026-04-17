# Copilot Instructions — Power BI Embedded + Fabric Data Agents

Estas instrucciones describen la arquitectura, convenciones y decisiones tecnicas del proyecto para que GitHub Copilot genere codigo coherente con la base existente.

---

## Stack tecnologico

| Capa | Tecnologia | Notas |
|------|-----------|-------|
| Framework | **Next.js 16** (App Router, React 19, TypeScript strict) | Todas las paginas en `src/app/` |
| Auth | **Auth.js v5 beta** (`next-auth@5`) + Microsoft Entra ID | JWT strategy, sesion 1h |
| Estilos | **Vanilla CSS** en `src/app/globals.css` (~1200 lineas) | Tailwind v4 instalado pero **no se usa** |
| Base de datos | **Azure SQL** via `mssql` v11 | Sin ORM. Schema auto-migrante con `ensureDataLayer()` |
| IA / Chat | **Fabric Data Agents** via MCP JSON-RPC 2.0 sobre HTTPS | `src/services/foundryAgents.ts` |
| Hosting | Azure App Service (Linux, Node 20 LTS) | |
| CI/CD | GitHub Actions | `.github/workflows/MVP-working_pbi-embedded-web-sdma.yml` |
| IaC | Bicep + Azure Developer CLI | `infra/main.bicep` |

---

## Variables de entorno criticas

```
# Auth.js — USAR NEXTAUTH_SECRET, NO AUTH_SECRET
NEXTAUTH_SECRET="..."          # <-- nombre exacto requerido
NEXTAUTH_URL="http://localhost:3000"

# Entra ID
AZURE_TENANT_ID="a348b16e-e6ff-4880-b56a-71326827aec5"
AZURE_CLIENT_ID="f39584f0-25b2-4927-8520-b2e4ddbb333c"
AZURE_CLIENT_SECRET="..."

# Auth.js provider (duplicado del anterior para el proveedor)
AUTH_MICROSOFT_ENTRA_ID_ID="<client-id>"
AUTH_MICROSOFT_ENTRA_ID_SECRET="<client-secret>"
AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/<tenant>/v2.0"

# Azure SQL
AZURE_SQL_SERVER="pbiembsqlsdma4147.database.windows.net"
AZURE_SQL_DATABASE="powerbiembedded"
AZURE_SQL_AUTH_MODE="azure-default"   # 'sql' en produccion con usuario/pass

# Fabric Data Agents
FOUNDRY_API_SCOPE="https://ai.azure.com/.default"
FOUNDRY_AUTH_MODE="azure-cli"         # 'sp' en produccion
```

> **Critico:** Si el codigo usa `getToken()` de `next-auth/jwt`, siempre pasar el secret explicito:
> ```ts
> getToken({ req, secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET })
> ```
> Sin esto, lanza `MissingSecret` y el route devuelve 500 con body vacio.

---

## Identificadores Azure de produccion

| Recurso | ID |
|---------|-----|
| Tenant ID | `a348b16e-e6ff-4880-b56a-71326827aec5` |
| SP App (Client) ID | `f39584f0-25b2-4927-8520-b2e4ddbb333c` |
| Fabric Workspace ID | `c34b3294-3de8-48db-a670-139b2e0a4741` |
| Agente Finance | `44fca610-fd92-4eb5-9e70-68b449fe3ea8` |
| Agente Sales | `1dd38a4c-8a6e-449d-97e9-7d4ec39b4cc2` |
| App Service | `pbi-embedded-web-sdma.azurewebsites.net` |
| SQL Server | `pbiembsqlsdma4147.database.windows.net` |

---

## Estructura de carpetas

```
src/
  auth.ts                     # Auth.js v5 config. EnrichedToken interface. OBO helpers.
  proxy.ts                    # Middleware: protege rutas autenticadas
  app/
    globals.css               # TODA la capa de estilos (Vanilla CSS, custom properties)
    layout.tsx / page.tsx
    login/page.tsx
    admin/page.tsx
    api/
      auth/[...nextauth]/     # Handlers Auth.js
      get-embed-token/        # Token Power BI embed con RLS
      reports/                # Listado de informes del usuario
      ai-agents/
        route.ts              # Listado de agentes para un reportId
        chat/route.ts         # Chat MCP con Fabric Data Agent
      admin/                  # CRUD: clients, users, reports, agents, bootstrap-data
  components/
    AIAgentDrawer.tsx         # Panel de chat (historial, ThinkingIndicator, timestamps)
    Header.tsx
    Sidebar.tsx
    PowerBIEmbed.tsx
    admin/
      AdminConsole.tsx        # Orquestador admin (~120 lineas)
      UserManager.tsx
      ReportManager.tsx
      AgentManager.tsx
      types.ts                # Interfaces compartidas del admin
  lib/
    authz.ts                  # Validacion JWT en API routes
    dal.ts                    # Tipos publicos de la app (SessionAuthUser, etc.)
    dalAzureRuntime.ts        # Barrel re-export → delega a db/*
    utils.ts                  # splitCsv y otros helpers
    db/
      pool.ts                 # Connection pool mssql
      types.ts                # Interfaces de filas BD (DbUser, DbReport, ...)
      schema.ts               # DDL + ensureDataLayer()
      bootstrap.ts            # Seed inicial
      clients.ts / users.ts / reports.ts / agents.ts / audit.ts
  services/
    foundryAgents.ts          # Cliente MCP para Fabric Data Agents
    powerbi.ts                # Cliente Power BI embed
```

---

## Flujo de autenticacion (auth.ts)

- **Provider**: Microsoft Entra ID via `@auth/core/providers/microsoft-entra-id`
- **Strategy**: JWT (no sessions de BD)
- **EnrichedToken**: interface que extiende el JWT con `accessToken`, `refreshToken`, `accessTokenExpires`, `role`, `clientId`, `reportIds`, `rlsRoles`
- **OBO**: `exchangeTokenViaOBO(userAccessToken)` en `foundryAgents.ts` intercambia el token del usuario por un token con scope Fabric. Si falla → fallback a `getFoundryApiToken()` (SP o azure-cli)
- **Refresh**: si `accessTokenExpires` <= 5 min, usa `refreshToken` para renovar silenciosamente

---

## Chat con Fabric Data Agents (MCP)

El chat utiliza el protocolo **MCP JSON-RPC 2.0**. El flujo es:

1. `POST /api/ai-agents/chat` recibe `{ reportId, agentId, messages[] }`
2. Extrae el `userAccessToken` del JWT de sesion via `getToken()` (con secret explicito)
3. Llama a `chatWithFoundryAgent({ reportId, agentId, messages, userAccessToken? })`
4. `chatWithFoundryAgent` intenta OBO con el token del usuario
5. Si OBO falla (consent no otorgado), usa SP token como fallback
6. Envia JSON-RPC 2.0 al endpoint MCP del agente:
   `https://api.fabric.microsoft.com/v1/mcp/workspaces/<wsId>/dataagents/<agentId>/agent`
7. Parsea la respuesta MCP y devuelve el texto al cliente

**No usar** la API `Responses` de Azure AI Foundry (`/responses` endpoint). Esa API fue reemplazada por el endpoint MCP de Fabric.

---

## Capa de datos (DAL)

- **Sin ORM**. Todas las queries son SQL parametrizado via `mssql`.
- Importar siempre desde `dalAzureRuntime` (barrel) o directamente desde `src/lib/db/*`.
- `ensureDataLayer()` es idempotente: crea tablas y columnas si no existen. Llamar al arranque.
- Las queries de acceso usan `IN (...)` en lugar de bucles para evitar N+1.
- Tablas: `clients`, `users`, `reports`, `user_report_access`, `user_rls_roles`, `ai_agents`, `ai_agent_reports`, `audit_log`

---

## Estilos (globals.css)

- **Nunca usar clases de Tailwind**. Los estilos van en `globals.css` con clases BEM-like.
- Variables CSS en `:root`: `--seidor-malibu: #66B6FF`, `--seidor-orange: #D16446`, `--seidor-black: #111111`, etc.
- Efectos glassmorphism: `backdrop-filter: blur(12px)` en header, sidebar y drawer.
- Para nuevos componentes, anadir clases en la seccion correspondiente de `globals.css`.
- El drawer de chat usa las clases `.ai-*` (`.ai-bubble`, `.ai-composer`, `.ai-thinking`, etc.).

---

## Convenciones de codigo

- **TypeScript strict**: no `any` salvo en integraciones externas con cast explicito.
- **Server components por defecto**. Anadir `'use client'` solo cuando se necesita estado o efectos.
- **API routes**: siempre validar la sesion con `authz.ts` antes de operar con BD.
- **Errores en API**: devolver `{ error: string }` sanitizado (sin stack traces al cliente).
- **Sin JWT lib propia**: no instalar `jsonwebtoken` ni similares; usar las utilidades de Auth.js.
- **Sin fetch con URLs absolutas hardcodeadas** en el cliente: usar rutas relativas (`/api/...`).
- **Audit log**: registrar operaciones CRUD relevantes en `audit_log` via `src/lib/db/audit.ts`.

---

## Permisos delegados en Entra ID (estado actual)

| Permiso | Tipo | Estado |
|---------|------|--------|
| `User.Read` | Delegado (Graph) | Consent otorgado |
| `DataAgent.Execute.All` | Delegado (Fabric) | **Consent otorgado** (17/04/2026) |
| `SemanticModel.Execute.All` | Delegado (Fabric) | **Consent otorgado** (17/04/2026) |

El flujo OBO esta activo. Los Fabric scopes **NO se incluyen** en `authorization.params` ni en el refresh de token: añadirlos bloquea el login (AccessDenied). El OBO funciona a nivel de servidor usando los permisos delegados consentidos en el App Registration — el usuario no necesita consentir nada adicional en el navegador.

---

## Lo que NO hacer

- No añadir clases de Tailwind (instalado pero no usado, podria romper el build de CSS).
- No usar `AUTH_SECRET` como nombre de variable; la app usa `NEXTAUTH_SECRET`.
- No llamar a la API Responses de Azure AI Foundry; el backend usa MCP.
- No crear helpers de autenticacion propios; usar `getServerSession` / `getToken` de Auth.js.
- No introducir queries N+1; usar `IN (...)` o `Promise.all` con batch queries.
- No almacenar secretos en el codigo o en variables no cifradas en produccion.
