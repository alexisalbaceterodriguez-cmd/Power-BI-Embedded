# Manual Operativo

Este manual describe la operacion diaria de la plataforma: gestion de usuarios, reportes y agentes Azure AI Foundry, ademas del proceso de despliegue y troubleshooting.

## 1. Alcance

1. Gestion de usuarios y permisos de reportes.
2. Configuracion RLS por usuario.
3. Alta y mantenimiento de agentes IA Foundry.
4. Despliegue de la aplicacion (IaC Bicep + GitHub Actions).
5. Troubleshooting y validaciones de produccion.

Fuente de verdad: **Azure SQL** (base de datos `powerbiembedded`).

Tablas principales:

| Tabla | Uso |
|-------|-----|
| `users` | Usuarios y roles |
| `reports` | Informes Power BI |
| `clients` | Clientes (agrupacion de usuarios e informes) |
| `user_report_access` | Acceso de usuario a informe |
| `user_rls_roles` | Roles RLS por usuario |
| `ai_agents` | Agentes Azure AI Foundry |
| `ai_agent_reports` | Vinculacion agente ↔ informe |
| `audit_log` | Registro de eventos |

## 2. Requisitos previos

1. Aplicacion desplegada o en local (`npm run dev`).
2. Login con usuario de rol `admin`.
3. Endpoint admin disponible en `/admin`.

## 3. Gestion de clientes

El panel `/admin` muestra la seccion **Clientes** en la parte superior.

1. Introducir `id` (slug, ej: `cliente-acme`) y `Nombre visible`.
2. Pulsar **Crear cliente**.
3. Para editar, clicar sobre la etiqueta del cliente existente.

Nota: el `id` de cliente no se puede cambiar tras la creacion (es clave foranea de usuarios e informes).

## 4. Gestion de usuarios

En `/admin` > pestaña **Usuarios** (componente `UserManager`):

1. Completar `Nombre de usuario`, `Email` (debe coincidir con el claim Entra ID), `Rol` y `Cliente`.
2. Seleccionar los informes a los que tendra acceso.
3. Indicar `RLS roles` (separados por coma) si aplica.
4. Establecer fecha de expiracion opcional.
5. Guardar.

Validaciones aplicadas:

- El email debe corresponder al claim principal o alternativo de Microsoft Entra ID.
- Los informes asignados deben pertenecer al mismo cliente del usuario.
- Usuarios `client` solo ven informes de su cliente.
- Usuarios `admin` acceden a todos los informes.

## 5. Gestion de informes

En `/admin` > pestaña **Informes** (componente `ReportManager`):

1. Definir `ID interno` (slug unico), `Nombre visible`, `Cliente`, `Workspace ID` y `Report ID`.
2. Configurar `rlsRoles` (csv) para usuarios normales y `adminRlsRoles` para admins cuando aplique.
3. `Admin RLS username`: nombre de usuario a pasar al token embed cuando el admin visualiza con RLS.
4. Activar/desactivar informe.

Los `Workspace ID` y `Report ID` se obtienen desde la URL del informe en Power BI Service:
`https://app.powerbi.com/groups/<workspaceId>/reports/<reportId>`

## 6. Gestion de agentes Foundry

En `/admin` > pestaña **Agentes IA** (componente `AgentManager`):

| Campo | Descripcion |
|-------|------------|
| Nombre | Nombre visible del agente |
| Cliente | Cliente al que pertenece |
| MCP Endpoint | URL del Fabric Data Agent en formato `https://api.fabric.microsoft.com/v1/mcp/workspaces/<wsId>/dataagents/<agentId>/agent` |
| Activity Endpoint | Opcional — protocolo de actividad alternativo |
| Proyecto Foundry | Nombre del proyecto en AI Foundry (referencia documental) |
| Nombre de agente | Nombre de la app/agente en Foundry (referencia documental) |
| Version | Version del agente (referencia documental) |
| Modo de seguridad | `Sin RLS` o `RLS heredado del usuario` |
| Informes vinculados | Informes en los que aparece el boton del agente |
| Activo | Activar/desactivar el agente |

Cuando hay **mas de un agente** vinculado a un informe, el panel de chat muestra un selector desplegable para elegir el agente activo.

## 7. Despliegue

### 7.1 Primer despliegue (nuevo entorno) — Azure Developer CLI

```bash
# Instalar azd
winget install microsoft.azd

# Login
azd auth login

# Crear entorno y configurar secretos
azd env new pbi-embedded-prod
azd env set AZURE_TENANT_ID      "<tenant-id>"
azd env set AZURE_CLIENT_ID      "<client-id>"
azd env set AZURE_CLIENT_SECRET  "<client-secret>"
azd env set NEXTAUTH_SECRET      "<random-32-chars>"
azd env set SQL_ADMIN_LOGIN      "sqladmin"
azd env set SQL_ADMIN_PASSWORD   "<password-seguro>"
azd env set BOOTSTRAP_ADMIN_EMAIL "admin@empresa.com"

# Provisionar infraestructura + desplegar codigo
azd up
```

`azd up` ejecuta:
1. `azd provision` — crea App Service, SQL, Key Vault, App Insights, Managed Identity.
2. `azd deploy` — construye y sube el codigo al App Service.

### 7.2 CI/CD automatico — GitHub Actions

Cada push a `master` o `MVP-working` ejecuta el workflow en `.github/workflows/MVP-working_pbi-embedded-web-sdma.yml`:

1. `npm ci` + `npm run build`
2. Login con `AZURE_CREDENTIALS` (secret del repositorio)
3. Deploy a App Service `pbi-embedded-web-sdma`

El secret `AZURE_CREDENTIALS` debe ser un Service Principal con rol **Contributor** sobre el Resource Group:

```bash
az ad sp create-for-rbac \
  --name "pbi-embedded-github" \
  --role contributor \
  --scopes /subscriptions/<sub>/resourceGroups/rg-powerbi-embedded-web \
  --json-auth
```

Copiar el JSON resultante como secret `AZURE_CREDENTIALS` en el repositorio de GitHub.

### 7.3 Inicializacion de base de datos (solo primera vez)

```bash
# Crear/migrar schema (idempotente)
npm run db:azure:init

# Seed de datos bootstrap (solo entorno limpio)
npm run db:azure:seed
```

## 8. Flujos de validacion

| Validacion | Comando |
|-----------|---------|
| Build completo | `npm run build` |
| Lint | `npm run lint` |
| Schema BD | `npm run db:azure:init` |
| Seed BD (primera vez) | `npm run db:azure:seed` |
| Salud agente Fabric | `npm run foundry:health` |
| Invocacion Python | `npm run foundry:py:invoke` |

## 9. Troubleshooting

| Sintoma | Causa probable | Solucion |
|---------|---------------|---------|
| `AccessDenied` en login | Email no mapeado en `users` | Crear usuario en `/admin` con el email exacto del claim Entra ID |
| `401/403` en chat con agente | RBAC o token incorrecto | Verificar que el SP tiene acceso al workspace Fabric; si el OBO falla por falta de consent, el fallback SP debe tener permisos |
| Chat responde con error generico | OBO fallback activo (token sin scopes Fabric) | El usuario debe re-iniciar sesion para obtener un token con los scopes Fabric activados |
| Chat responde con error generico | SP fallback falla con Fabric Data Agent | Verificar que `FOUNDRY_AUTH_MODE=sp` y que el SP tiene permisos sobre el workspace Fabric |
| Usuario no ve informes | `user_report_access` vacio o cliente incorrecto | Revisar en `/admin` > Usuarios > editar > asignar informes |
| Error RLS en embed | `rlsRoles` vacio o nombre de rol incorrecto | Revisar roles en Power BI Dataset y en `/admin` > Usuarios |
| Key Vault access denied | MI sin rol `Key Vault Secrets User` | El Bicep lo asigna automaticamente; re-provisionar si falta |
| NEXTAUTH_URL incorrecto | URL de la app no coincide | Actualizar `NEXTAUTH_URL` en App Settings con la URL correcta |
| `Unexpected end of JSON input` en chat | `NEXTAUTH_SECRET` no configurado | Verificar que la variable `NEXTAUTH_SECRET` (no `AUTH_SECRET`) esta en App Settings |

## 10. Seguridad operativa

1. **Secretos en Key Vault** — nunca en variables de entorno directas en produccion.
2. **Rotar periodicamente** `AZURE_CLIENT_SECRET` y `NEXTAUTH_SECRET`.
3. **Managed Identity** — preferir MI sobre Service Principal para accesos a SQL y Fabric.
4. **Audit log** — monitorizar la tabla `audit_log` para detectar accesos anomalos.
5. **Application Insights** — configurar alertas sobre errores HTTP 5xx y tiempos de respuesta.
6. **Minimo privilegio** — el Service Principal de GitHub Actions solo necesita rol `Contributor` sobre el RG.
7. **Admin consent otorgado** (17/04/2026) — los permisos delegados `DataAgent.Execute.All` y `SemanticModel.Execute.All` estan activos. El flujo OBO esta habilitado: los usuarios autenticados actuan como ellos mismos ante el Data Agent.
