# Power BI Embedded + Fabric Data Agents

Portal Next.js 16 multi-cliente para embebido de informes Power BI con chat integrado de Fabric Data Agents (MCP).

## Stack

| Capa | Tecnologia |
|------|-----------|
| Framework | Next.js 16 (App Router, React 19, TypeScript) |
| Auth | Auth.js v5 + Microsoft Entra ID (JWT, sesion 1h) |
| Estilos | Vanilla CSS — `globals.css` con custom properties (~1200 lineas); Tailwind v4 instalado pero sin usar |
| Base de datos | Azure SQL via `mssql` (sin ORM, schema auto-migrante) |
| IA | Fabric Data Agents — MCP JSON-RPC 2.0 sobre HTTPS |
| Hosting | Azure App Service (Linux, Node 20 LTS) |
| CI/CD | GitHub Actions (`.github/workflows/`) |
| IaC | Bicep + Azure Developer CLI (`infra/`) |

## Arquitectura de la aplicacion

```
┌─────────────────────────────────────────────────────┐
│  Next.js App (App Router)                           │
│                                                     │
│  /login           Auth.js + Entra ID OIDC           │
│  /                Dashboard (reports + AI chat)     │
│  /admin           Panel de administracion           │
│                                                     │
│  API routes (server-only):                          │
│  /api/auth        NextAuth handlers                 │
│  /api/reports     Listado de informes del usuario   │
│  /api/get-embed-token  Token Power BI (RLS)         │
│  /api/ai-agents        Listado de agentes           │
│  /api/ai-agents/chat   Chat con Data Agent (MCP)    │
│  /api/admin/*     CRUD admin (users/reports/agents) │
└─────────────────────────────────────────────────────┘
          │                        │
          ▼                        ▼
   Azure SQL                Fabric Data Agents
   (users, reports,         (MCP JSON-RPC 2.0;
    agents, audit)           OBO token o SP fallback)
```

### Flujo de autenticacion y autorizacion

1. Usuario se autentica via Microsoft Entra ID (OIDC).
2. Auth.js mapea el claim de email contra la tabla `users` de Azure SQL.
3. El JWT de sesion incluye `role`, `clientId`, `reportIds` y `rlsRoles`.
4. Los API routes validan el JWT antes de cada operacion (`authz.ts`).
5. El token de embed de Power BI se genera server-side con RLS estricto.
6. En chat: el access token del usuario se intercambia via **OBO** por un token con scope Fabric (`DataAgent.Execute.All`). El admin consent fue otorgado el 17/04/2026; si el intercambio falla por cualquier otro motivo, se usa como fallback el token de Service Principal.

### Estructura de la capa de datos (DAL)

```
src/lib/
  dal.ts                  Tipos publicos de la app (SessionAuthUser, etc.)
  dalAzureRuntime.ts      Barrel re-export → delega a db/*
  db/
    pool.ts               Connection pool, helpers de query, utilidades
    types.ts              Interfaces de filas de BD (DbUser, DbReport, ...)
    schema.ts             DDL del schema + ensureDataLayer()
    bootstrap.ts          Seed inicial desde variables de entorno
    clients.ts            CRUD de clientes
    users.ts              CRUD de usuarios y lookups de auth
    reports.ts            CRUD de informes y queries de acceso
    agents.ts             CRUD de agentes IA y queries de acceso
    audit.ts              Registro de eventos de auditoria
```

### Estructura de componentes de administracion

```
src/components/admin/
  types.ts          Interfaces compartidas (ClientRow, UserRow, ...)
  AdminConsole.tsx  Orquestador principal (~120 lineas)
  UserManager.tsx   Tabla + formulario de usuarios
  ReportManager.tsx Tabla + formulario de informes
  AgentManager.tsx  Tabla + formulario de agentes IA
```

## Estructura de infraestructura (IaC)

```
infra/
  main.bicep        Todos los recursos Azure (App Service, SQL, KV, AppInsights)
  main.bicepparam   Valores de parametros leidos desde azd env
azure.yaml          Configuracion de Azure Developer CLI (azd)
```

Recursos desplegados por el Bicep:

- **Managed Identity** (User-Assigned) para el App Service
- **Log Analytics Workspace** + **Application Insights**
- **Key Vault** (RBAC) con los secretos `nextauth-secret` y `entra-client-secret`
- **App Service Plan** (Linux)
- **Azure SQL Server** + **Database** `powerbiembedded`
- **App Service** (Node 20 LTS) con todas las variables de entorno pre-configuradas

## Variables de entorno

### Desarrollo local (`.env.local`)

```env
# Microsoft Entra ID
AZURE_TENANT_ID="<tenant-id>"
AZURE_CLIENT_ID="<client-id>"
AZURE_CLIENT_SECRET="<client-secret>"
AUTH_MICROSOFT_ENTRA_ID_ID="<client-id>"
AUTH_MICROSOFT_ENTRA_ID_SECRET="<client-secret>"
AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/<tenant>/v2.0"

# Auth.js
NEXTAUTH_SECRET="<random-32+-chars>"
NEXTAUTH_URL="http://localhost:3000"

# Azure SQL
AZURE_SQL_SERVER="<server>.database.windows.net"
AZURE_SQL_DATABASE="powerbiembedded"
AZURE_SQL_AUTH_MODE="azure-default"   # usa 'az login' en local
AZURE_SQL_ENCRYPT="true"
AZURE_SQL_TRUST_SERVER_CERTIFICATE="false"

# Azure AI Foundry
FOUNDRY_API_SCOPE="https://ai.azure.com/.default"
FOUNDRY_AUTH_MODE="azure-cli"         # usa 'az login' en local

# Bootstrap (primer arranque)
BOOTSTRAP_ADMIN_EMAIL="admin@empresa.com"
BOOTSTRAP_REPORTS_JSON='[{"id":"informe-1","displayName":"Mi Informe","workspaceId":"...","reportId":"...","rlsRoles":["Rol 1"]}]'
BOOTSTRAP_USERS_JSON='[{"username":"usuario1","email":"usuario@empresa.com","role":"client","reportIds":["informe-1"],"rlsRoles":["Rol 1"]}]'
BOOTSTRAP_AI_AGENTS_JSON='[{"name":"Agente Ventas","responsesEndpoint":"https://.../protocols/openai/responses?api-version=2025-11-15-preview","securityMode":"none","reportIds":["informe-1"],"isActive":true}]'
```

### Produccion (Azure App Service)

En produccion, los secretos se almacenan en Key Vault y se referencian via:

```
AZURE_CLIENT_SECRET  = @Microsoft.KeyVault(VaultName=kv-xxx;SecretName=entra-client-secret)
NEXTAUTH_SECRET      = @Microsoft.KeyVault(VaultName=kv-xxx;SecretName=nextauth-secret)
```

El Bicep configura automaticamente estas referencias al provisionar.

## Comandos de desarrollo

```bash
# Instalacion y arranque
npm install
npm run dev          # http://localhost:3000
npm run build
npm run lint

# Base de datos
npm run db:azure:init     # Crear/migrar schema
npm run db:azure:seed     # Seed bootstrap (solo primera vez)

# Diagnostico Foundry
npm run foundry:health    # Comprueba conectividad con el agente

# Python (validacion alternativa del agente)
npm run foundry:py:install
npm run foundry:py:invoke
```

## Despliegue

### Opcion A — Azure Developer CLI (recomendado para nuevo entorno)

```bash
# Instalar azd si no esta instalado
winget install microsoft.azd

# Autenticarse
azd auth login

# Configurar variables
azd env new pbi-embedded-prod
azd env set AZURE_TENANT_ID      "<tenant-id>"
azd env set AZURE_CLIENT_ID      "<client-id>"
azd env set AZURE_CLIENT_SECRET  "<client-secret>"
azd env set NEXTAUTH_SECRET      "<random-32-chars>"
azd env set SQL_ADMIN_LOGIN      "sqladmin"
azd env set SQL_ADMIN_PASSWORD   "<password>"
azd env set BOOTSTRAP_ADMIN_EMAIL "admin@empresa.com"

# Provisionar infraestructura y desplegar codigo
azd up
```

### Opcion B — GitHub Actions (CI/CD automatico)

Cada push a `master` o `MVP-working` dispara el workflow en `.github/workflows/`.
Requiere el secret `AZURE_CREDENTIALS` configurado en el repositorio.

### Opcion C — Despliegue manual puntual

```bash
npm run build
# ZIP deploy a Azure App Service via Azure CLI o Portal
az webapp deploy --resource-group rg-powerbi-embedded-web \
  --name pbi-embedded-web-sdma \
  --src-path . --type zip
```

## Seguridad

- Cabeceras de seguridad globales: CSP, HSTS, X-Content-Type-Options, Referrer-Policy.
- Secretos almacenados en Key Vault; nunca en variables de entorno directas en produccion.
- Managed Identity para acceso a SQL sin contrasenas en runtime de produccion.
- RLS estricto en Power BI sin fallback permisivo.
- Audit log de eventos en tabla `audit_log`.
- Sesion JWT maxima de 1 hora.

## Nota sobre columnas legacy

Los campos `mcp_*` de la tabla `ai_agents` estan deprecados pero no eliminados para compatibilidad con datos existentes. No se usan en UI ni runtime. Su borrado fisico se realizara en una migracion controlada futura.

## Nota sobre admin consent

Los permisos delegados `DataAgent.Execute.All` y `SemanticModel.Execute.All` tienen admin consent otorgado (17/04/2026). El flujo OBO esta activo: los usuarios que inicien sesion recibiran un access token con los scopes Fabric, que se usa como assertion en el intercambio OBO hacia el Data Agent.
