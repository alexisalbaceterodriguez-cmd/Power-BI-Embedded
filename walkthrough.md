# Power BI Embedded Walkthrough

## Estado actual

- Autenticacion Microsoft-only mediante NextAuth + Microsoft Entra ID.
- Sin formulario de usuario/password local.
- Mapeo de usuario por email/claims Entra ID contra `users.email`.

## Configuracion recomendada

1. Definir variables canonicas Azure:
   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID`
   - `AZURE_CLIENT_SECRET`
2. Definir auth de aplicacion:
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
3. Definir bootstrap inicial (opcional):
   - `BOOTSTRAP_CLIENTS_JSON`
   - `BOOTSTRAP_DEFAULT_CLIENT_ID`
   - `BOOTSTRAP_REPORTS_JSON`
   - `BOOTSTRAP_ADMIN_EMAIL`
   - `BOOTSTRAP_USERS_JSON`
   - `BOOTSTRAP_AI_AGENTS_JSON`
   - `BOOTSTRAP_REPORT_CLIENT_ASSIGNMENTS_JSON`

Modo seguro por defecto:

- No se asigna automaticamente `client_id` por nombre de reporte ni por cliente hardcodeado.
- Para volver al modo demo legacy, activar `BOOTSTRAP_ENABLE_LEGACY_DEFAULTS=true`.

Compatibilidad temporal:

- `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET` siguen funcionando como fallback.

## Ejecucion local

1. `npm install`
2. `npm run dev`
3. Abrir `http://localhost:3000/login` y usar inicio de sesion Microsoft.

## Comprobaciones operativas

1. Usuario sin email mapeado en BD -> `AccessDenied`.
2. Usuario mapeado -> acceso a informes segun `user_report_access` y `user_rls_roles`.
3. `/admin` crea usuarios Microsoft (sin password local).

## Seguridad en Azure Web App

1. Guardar secretos solo en Key Vault y usar references en App Settings.
2. Habilitar Managed Identity en la Web App.
3. Rotar credenciales historicas expuestas y no reutilizarlas.
