# Power BI Embedded + Azure AI Foundry (Foundry-Only)

Aplicacion Next.js 16 para embebido de informes Power BI y chat con agentes de Azure AI Foundry.

Estado actual del producto:

- Chat de agentes IA en modo Foundry-only.
- Admin portal adaptado para alta/edicion de agentes Foundry.
- Runtime de chat sin rutas Fabric/MCP activas.
- Persistencia en Azure SQL con migracion automatica de agentes legacy.

## Arquitectura

1. Autenticacion de usuarios con Microsoft Entra ID (Auth.js).
2. Autorizacion por cliente/reporte y roles RLS desde Azure SQL.
3. Chat IA server-side en API route interna con token delegado de usuario (si llega por cabecera) y fallback a token de aplicacion.
4. UI de chat embebida en el dashboard de reportes.

## API de chat (RLS)

Endpoint: `POST /api/ai-agents/chat`

Payload minimo:

```json
{
	"agentId": "<agent-id>",
	"reportId": "<report-id>",
	"messages": [{ "role": "user", "content": "..." }]
}
```

Payload recomendado para scope estructurado:

```json
{
	"agentId": "<agent-id>",
	"reportId": "<report-id>",
	"scopeCompanyIds": ["1", "2"],
	"messages": [{ "role": "user", "content": "..." }]
}
```

Payload para alcance multidimension (roles no basados en empresa):

```json
{
	"agentId": "<agent-id>",
	"reportId": "<report-id>",
	"scopeAttributes": {
		"region": ["norte"],
		"canal": ["b2b"]
	},
	"messages": [{ "role": "user", "content": "..." }]
}
```

Notas:

- `scopeCompanyIds` es opcional y permite validacion de alcance sin depender de texto libre.
- `scopeAttributes` permite enforcement de alcance por cualquier dimension (region, canal, segmento, etc.) si el rol RLS incluye esos atributos.
- Si no se envia, el backend mantiene compatibilidad con extraccion de empresas desde texto.
- Si la peticion incluye cabecera de token delegado (por defecto `x-ms-token-aad-access-token`), el backend la usa para llamar a Foundry; si falla con `401/403`, puede hacer fallback al token de aplicacion.

## Variables de entorno

```env
# Credenciales Azure canonicas
AZURE_TENANT_ID="..."
AZURE_CLIENT_ID="..."
AZURE_CLIENT_SECRET="..."

# Auth.js
NEXTAUTH_SECRET="<random-32+>"
NEXTAUTH_URL="https://tu-dominio"

# Opcionales para Entra provider (si difieren de AZURE_*)
AUTH_MICROSOFT_ENTRA_ID_ID="..."
AUTH_MICROSOFT_ENTRA_ID_SECRET="..."
AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/<tenant>/v2.0"

# Azure SQL (requerido)
AZURE_SQL_SERVER="<server>.database.windows.net"
AZURE_SQL_DATABASE="powerbiembedded"
AZURE_SQL_AUTH_MODE="azure-default"
AZURE_SQL_ENCRYPT="true"
AZURE_SQL_TRUST_SERVER_CERTIFICATE="false"

# Foundry runtime
FOUNDRY_API_SCOPE="https://ai.azure.com/.default"
FOUNDRY_AUTH_MODE="azure-cli"
FOUNDRY_ENABLE_USER_TOKEN_PASSTHROUGH="true"
FOUNDRY_USER_TOKEN_HEADER="x-ms-token-aad-access-token"
FOUNDRY_ALLOW_AUTHORIZATION_BEARER_PASSTHROUGH="false"
FOUNDRY_FALLBACK_TO_APP_TOKEN_ON_DELEGATED_FAILURE="true"

# Bootstrap opcional
BOOTSTRAP_ADMIN_USERNAME="admin"
BOOTSTRAP_ADMIN_EMAIL="admin@contoso.com"
BOOTSTRAP_CLIENTS_JSON='[{"id":"contoso-fin","displayName":"Contoso Finance"}]'
BOOTSTRAP_DEFAULT_CLIENT_ID="contoso-fin"
BOOTSTRAP_REPORTS_JSON='[{"id":"finance","displayName":"Finance","clientId":"contoso-fin","workspaceId":"...","reportId":"..."}]'
BOOTSTRAP_USERS_JSON='[{"username":"cliente_finance","email":"cliente@contoso.com","role":"client","clientId":"contoso-fin","reportIds":["finance"],"rlsRoles":["Empresa 01"]}]'
BOOTSTRAP_AI_AGENTS_JSON='[{"name":"agent-sales","clientId":"contoso-fin","responsesEndpoint":"https://.../protocols/openai/responses?...","activityEndpoint":"https://.../protocols/activityprotocol?...","foundryProject":"project-name","foundryAgentName":"app-name","foundryAgentVersion":"1","securityMode":"none","reportIds":["finance"],"isActive":true}]'
BOOTSTRAP_REPORT_CLIENT_ASSIGNMENTS_JSON='[{"reportId":"finance","clientId":"contoso-fin"}]'
BOOTSTRAP_ENABLE_LEGACY_DEFAULTS="false"

# Legacy demo mode (solo para entornos de ejemplo)
# BOOTSTRAP_ENABLE_LEGACY_DEFAULTS="true"
```

## Comandos

```bash
npm install
npm run dev
npm run lint
npm run build

# Base de datos
npm run db:azure:init
npm run db:azure:seed

# Salud de agente Foundry
npm run foundry:health

# Validacion Python opcional
npm run foundry:py:install
npm run foundry:py:invoke
```

## Produccion Azure

Checklist minimo:

1. Guardar secretos en Key Vault.
2. Configurar identidad de ejecucion (SP activo; MI preparada para siguiente fase).
3. Asignar RBAC al recurso/proyecto Foundry para la identidad backend.
4. Verificar permisos de datos del agente (si consulta origenes externos).
5. Ejecutar `npm run foundry:health` contra entorno desplegado.

## Nota de migracion de base de datos

En esta release los campos legacy de agentes Fabric quedan deprecados, no eliminados fisicamente.

- La app ya no usa `mcp_*` en runtime ni en admin.
- Se mantiene compatibilidad temporal para leer datos legacy y migrarlos a `responses_endpoint`.
- El borrado fisico de columnas legacy se realizara en una segunda migracion controlada.
