// Parameters file for main.bicep.
// Values are read from azd environment variables (set with `azd env set KEY VALUE`).
// Secrets are never committed — pass them at provision time via `azd env set` or CI secrets.

using './main.bicep'

// Core
param environmentName        = readEnvironmentVariable('AZURE_ENV_NAME',       'pbi-embedded-prod')
param location               = readEnvironmentVariable('AZURE_LOCATION',       'swedencentral')

// Sizing (override per environment)
param appServicePlanSku      = readEnvironmentVariable('APP_SERVICE_SKU',      'B2')
param sqlDatabaseSku         = readEnvironmentVariable('SQL_DATABASE_SKU',     'Basic')

// SQL administrator credentials
param sqlAdminLogin          = readEnvironmentVariable('SQL_ADMIN_LOGIN',      'sqladmin')
param sqlAdminPassword       = readEnvironmentVariable('SQL_ADMIN_PASSWORD',   '')

// Microsoft Entra ID / App Registration
param tenantId               = readEnvironmentVariable('AZURE_TENANT_ID',      '')
param entraClientId          = readEnvironmentVariable('AZURE_CLIENT_ID',      '')
param entraClientSecret      = readEnvironmentVariable('AZURE_CLIENT_SECRET',  '')

// Auth.js
param nextAuthSecret         = readEnvironmentVariable('NEXTAUTH_SECRET',      '')

// Optional bootstrap
param bootstrapAdminEmail    = readEnvironmentVariable('BOOTSTRAP_ADMIN_EMAIL', '')
