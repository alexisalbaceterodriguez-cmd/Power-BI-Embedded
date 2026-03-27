# Power BI Embedded Next.js Viewer (Hardened)

Aplicacion Next.js 16 para embebido Power BI (App Owns Data) con:

- Microsoft Entra ID como autenticacion principal.
- Fallback local opcional y endurecido (rate limit + lockout progresivo + politica de password).
- Autorizacion y asignaciones en SQLite (DAL server-only).
- Panel admin basico en `/admin` para alta de usuarios/reportes.
- API protegida de embed token con errores sanitizados.

## Variables de entorno

```env
# Power BI / Azure AD Service Principal
TENANT_ID="..."
CLIENT_ID="..."
CLIENT_SECRET="..."

# Auth.js
NEXTAUTH_SECRET="<random-32+>"
NEXTAUTH_URL="https://tu-dominio"
AUTH_MICROSOFT_ENTRA_ID_ID="..."
AUTH_MICROSOFT_ENTRA_ID_SECRET="..."
AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/<tenant>/v2.0"

# Data Layer
APP_DB_PATH="./data/security.db"

# Bootstrap inicial (opcional)
BOOTSTRAP_REPORTS_JSON='[{"id":"finance","displayName":"Finance","workspaceId":"...","reportId":"...","rlsRoles":["Empresa 01"]}]'
BOOTSTRAP_ADMIN_USERNAME="admin"
BOOTSTRAP_ADMIN_EMAIL="admin@company.com"
BOOTSTRAP_ADMIN_PASSWORD="StrongPassword!123"
# o BOOTSTRAP_ADMIN_PASSWORD_HASH="$2b$12$..."

# Politica auth local
AUTH_ENABLE_LOCAL_FALLBACK="true"
AUTH_MAX_ATTEMPTS="5"
AUTH_MAX_LOCK_MINUTES="60"
```

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
```
