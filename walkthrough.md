# Walkthrough de configuracion y despliegue

## Estado de la aplicacion

- Autenticacion Microsoft-only via Auth.js v5 + Microsoft Entra ID (OIDC).
- Sin formulario de usuario/contrasena local.
- Mapeo de usuario por email/claims de Entra ID contra tabla `users` en Azure SQL.
- Panel de administracion en `/admin` para gestion de clientes, usuarios, informes y agentes IA.
- Chat IA integrado con Azure AI Foundry (Responses API), con selector de agente cuando hay multiples disponibles.

---

## Paso 1 — Registro de la aplicacion en Entra ID

1. En [portal.azure.com](https://portal.azure.com) → **App registrations** → **New registration**.
2. Nombre: `pbi-embedded` (o similar). Tipo: **Single tenant**.
3. URI de redireccion: `https://<tu-dominio>/api/auth/callback/microsoft-entra-id`
   - En local: `http://localhost:3000/api/auth/callback/microsoft-entra-id`
4. Anotar `Application (client) ID` y `Directory (tenant) ID`.
5. En **Certificates & secrets** → crear un client secret. Anotar el valor.
6. En **API permissions** → agregar `User.Read` (Microsoft Graph, delegado).

---

## Paso 2 — Configuracion en local

Crear `.env.local` en la raiz del proyecto:

```env
AZURE_TENANT_ID="<tenant-id>"
AZURE_CLIENT_ID="<client-id>"
AZURE_CLIENT_SECRET="<client-secret>"
AUTH_MICROSOFT_ENTRA_ID_ID="<client-id>"
AUTH_MICROSOFT_ENTRA_ID_SECRET="<client-secret>"
AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/<tenant-id>/v2.0"

NEXTAUTH_SECRET="<string-aleatoria-32-caracteres>"
NEXTAUTH_URL="http://localhost:3000"

AZURE_SQL_SERVER="<server>.database.windows.net"
AZURE_SQL_DATABASE="powerbiembedded"
AZURE_SQL_AUTH_MODE="azure-default"
AZURE_SQL_ENCRYPT="true"
AZURE_SQL_TRUST_SERVER_CERTIFICATE="false"

FOUNDRY_API_SCOPE="https://ai.azure.com/.default"
FOUNDRY_AUTH_MODE="azure-cli"

BOOTSTRAP_ADMIN_EMAIL="admin@empresa.com"
```

Para `AZURE_SQL_AUTH_MODE="azure-default"` en local se usa `az login`:

```bash
az login
az account set --subscription "<subscription-id>"
```

---

## Paso 3 — Bootstrap de base de datos

```bash
# Crear/migrar schema (idempotente — seguro ejecutar varias veces)
npm run db:azure:init

# Seed de datos iniciales (solo la primera vez con BD vacia)
npm run db:azure:seed
```

---

## Paso 4 — Arranque local

```bash
npm install
npm run dev
# Abrir http://localhost:3000/login
```

El usuario que inicie sesion debe existir en la BD con su email de Entra ID.
Si no existe, recibira `AccessDenied`. Crear el usuario desde `/admin` con el email exacto.

---

## Paso 5 — Despliegue en Azure (nuevo entorno con azd)

### 5.1 Instalar Azure Developer CLI

```bash
winget install microsoft.azd
# o en macOS/Linux: brew install azure/azd/azd
```

### 5.2 Provisionar infraestructura

```bash
azd auth login

# Crear entorno (primera vez)
azd env new pbi-embedded-prod

# Configurar variables obligatorias
azd env set AZURE_TENANT_ID      "<tenant-id>"
azd env set AZURE_CLIENT_ID      "<client-id>"
azd env set AZURE_CLIENT_SECRET  "<client-secret>"
azd env set NEXTAUTH_SECRET      "<random-32-chars>"
azd env set SQL_ADMIN_LOGIN      "sqladmin"
azd env set SQL_ADMIN_PASSWORD   "<password-seguro>"
azd env set BOOTSTRAP_ADMIN_EMAIL "admin@empresa.com"

# Variables opcionales de dimensionado
azd env set APP_SERVICE_SKU  "B2"    # B1 | B2 | P1v3
azd env set SQL_DATABASE_SKU "Basic" # Basic | S0 | S1

# Provisionar + desplegar en un solo comando
azd up
```

`azd up` crea automaticamente:
- Managed Identity
- Log Analytics + Application Insights
- Key Vault con los secretos configurados
- App Service Plan + App Service (Node 20 LTS)
- Azure SQL Server + Database `powerbiembedded`

### 5.3 Post-provision

```bash
# Inicializar schema (apuntar las env vars al servidor recien creado)
npm run db:azure:init

# Validar conectividad con el agente Foundry
npm run foundry:health
```

Actualizar en Entra ID la URI de redireccion con la URL del App Service recien creado:
`https://<app-service-name>.azurewebsites.net/api/auth/callback/microsoft-entra-id`

---

## Paso 6 — CI/CD con GitHub Actions

El workflow `.github/workflows/MVP-working_pbi-embedded-web-sdma.yml` se dispara automaticamente en push a `master` o `MVP-working`.

Configurar el secret `AZURE_CREDENTIALS` en el repositorio:

```bash
az ad sp create-for-rbac \
  --name "pbi-embedded-github" \
  --role contributor \
  --scopes /subscriptions/<sub>/resourceGroups/<rg> \
  --json-auth
```

Copiar el JSON como secret `AZURE_CREDENTIALS` en **Settings > Secrets > Actions**.

---

## Comprobaciones operativas

| Comprobacion | Resultado esperado |
|-------------|-------------------|
| Login con usuario mapeado | Acceso al dashboard con sus informes |
| Login con usuario no mapeado | Pantalla `AccessDenied` |
| `/admin` con rol `client` | Redireccion o `403` |
| Chat con agente Foundry | Respuesta en el drawer lateral |
| Selector de agente (>1 agente) | Dropdown visible en el drawer |
| Embed de informe con RLS | Datos filtrados segun `rlsRoles` del usuario |

---

## Seguridad en Azure App Service

1. Secretos almacenados en Key Vault, referenciados desde App Settings (`@Microsoft.KeyVault(...)`).
2. Managed Identity con rol `Key Vault Secrets User` asignado por el Bicep.
3. `httpsOnly: true` activado en el App Service.
4. TLS minimo 1.2 en App Service y SQL Server.
5. FTPS deshabilitado.
6. Rotar `AZURE_CLIENT_SECRET` y `NEXTAUTH_SECRET` periodicamente.
