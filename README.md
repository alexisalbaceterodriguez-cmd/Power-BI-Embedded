# Power BI Embedded Next.js Viewer (Hardened)

Aplicacion Next.js 16 para embebido Power BI (App Owns Data) con:

- Microsoft Entra ID como autenticacion principal.
- Autenticacion Microsoft-only (sin credenciales locales).
- Autorizacion y asignaciones en SQLite (DAL server-only).
- Panel admin basico en `/admin` para alta de usuarios/reportes.
- API protegida de embed token con errores sanitizados.

## Variables de entorno

```env
# Canonicas (recomendadas): credenciales Azure para Power BI/Fabric
AZURE_TENANT_ID="..."
AZURE_CLIENT_ID="..."
AZURE_CLIENT_SECRET="..."

# Legacy (compatibilidad temporal)
TENANT_ID="..."
CLIENT_ID="..."
CLIENT_SECRET="..."

# Auth.js
NEXTAUTH_SECRET="<random-32+>"
NEXTAUTH_URL="https://tu-dominio"

# Puedes omitirlas si usas AZURE_* y construir issuer automaticamente.
AUTH_MICROSOFT_ENTRA_ID_ID="..."
AUTH_MICROSOFT_ENTRA_ID_SECRET="..."
AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/<tenant>/v2.0"

# Data Layer
APP_DB_PATH="./data/security.db"

# Bootstrap inicial (opcional, sin passwords)
BOOTSTRAP_REPORTS_JSON='[{"id":"finance","displayName":"Finance","workspaceId":"...","reportId":"...","rlsRoles":["Empresa 01"]}]'
BOOTSTRAP_ADMIN_USERNAME="admin"
BOOTSTRAP_ADMIN_EMAIL="admin@company.com"
BOOTSTRAP_USERS_JSON='[{"username":"cliente_finance","email":"cliente@contoso.com","role":"client","reportIds":["finance"],"rlsRoles":["Empresa 01"]}]'
```

## Nomenclatura de secretos multicliente

Para una unica Azure Web App con clientes aislados por configuracion:

- Formato recomendado: `pbi-{env}--{cliente}--{dominio}--{nombre}`
- Ejemplos:
	- `pbi-prod--acme--auth--nextauth-secret`
	- `pbi-prod--acme--powerbi--client-id`
	- `pbi-prod--acme--powerbi--client-secret`
	- `pbi-prod--acme--report--workspace-id`

Reglas:

- Mantener secretos sensibles (client secret, nextauth secret) en Key Vault.
- Evitar un secreto por reporte cuando pueda resolverse por metadatos en BD.
- Priorizar credenciales dedicadas por cliente para reducir blast radius.

## Seguridad y despliegue Azure

- No subas secretos a git ni a `.env` compartidos.
- Guarda secretos en Azure Key Vault y usa Managed Identity desde App Service.
- Rota inmediatamente cualquier secreto historico expuesto.
- Verifica `https`, HSTS y cabeceras de seguridad en entorno productivo.

## Comandos

```bash
npm install
npm run dev
npm run lint
npm run build
npm run db:azure:init
```

## Uso local con Azure SQL

Si quieres trabajar en local contra una base Azure SQL:

1. Inicia sesion en Azure CLI: `az login`
2. Configura en `.env.local`:
	- `AZURE_SQL_SERVER`
	- `AZURE_SQL_DATABASE`
	- `AZURE_SQL_AUTH_MODE=azure-default`
3. Inicializa esquema: `npm run db:azure:init`

Notas:

- El script admite `AZURE_SQL_AUTH_MODE=azure-default` (recomendado para local con Entra) o `sql` (usuario/password SQL).
- El runtime usa Azure SQL automaticamente cuando `AZURE_SQL_SERVER` y `AZURE_SQL_DATABASE` estan definidos.
- Si no defines esas variables, el runtime usa SQLite (`APP_DB_PATH`) como fallback.
