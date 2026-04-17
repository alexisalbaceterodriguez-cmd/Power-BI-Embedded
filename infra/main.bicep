targetScope = 'resourceGroup'

// ─────────────────────────────────────────────
// Parameters
// ─────────────────────────────────────────────

@description('Name for the environment (used to name resources).')
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('SKU for the App Service Plan. Recommended: B2 (dev) or P1v3 (prod).')
@allowed(['B1', 'B2', 'B3', 'P1v3', 'P2v3'])
param appServicePlanSku string = 'B2'

@description('SKU name for the Azure SQL Database.')
@allowed(['Basic', 'S0', 'S1', 'S2'])
param sqlDatabaseSku string = 'Basic'

@description('SQL Server administrator login name.')
param sqlAdminLogin string

@secure()
@description('SQL Server administrator password.')
param sqlAdminPassword string

@description('Microsoft Entra ID tenant ID.')
param tenantId string = tenant().tenantId

@description('App Registration client ID for Entra ID authentication.')
param entraClientId string

@secure()
@description('App Registration client secret for Entra ID authentication.')
param entraClientSecret string

@secure()
@description('NextAuth.js secret (random string of 32+ characters).')
param nextAuthSecret string

@description('Bootstrap admin email address.')
param bootstrapAdminEmail string = ''

@description('Number of days to retain soft-deleted Key Vault secrets.')
@minValue(7)
@maxValue(90)
param kvSoftDeleteDays int = 7

// ─────────────────────────────────────────────
// Variables
// ─────────────────────────────────────────────

// Short unique suffix derived from resource group ID + environment name.
// 13 characters, lowercase hex — safe for all resource name limits.
var resourceToken = toLower(uniqueString(resourceGroup().id, environmentName))

var tags = {
  'azd-env-name': environmentName
  application: 'pbi-embedded'
}

var appServiceName = 'app-${resourceToken}'
var sqlServerName  = 'sql-${resourceToken}'
var kvName         = 'kv-${resourceToken}'  // max 24 chars: 'kv-' (3) + 13 = 16 ✓

// ─────────────────────────────────────────────
// User-Assigned Managed Identity
// ─────────────────────────────────────────────

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${resourceToken}'
  location: location
  tags: tags
}

// ─────────────────────────────────────────────
// Monitoring: Log Analytics + Application Insights
// ─────────────────────────────────────────────

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${resourceToken}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    RetentionInDays: 30
    IngestionMode: 'LogAnalytics'
  }
}

// ─────────────────────────────────────────────
// Key Vault
// ─────────────────────────────────────────────

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: kvSoftDeleteDays
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
  }
}

resource secretNextAuth 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'nextauth-secret'
  properties: { value: nextAuthSecret }
}

resource secretEntraClient 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'entra-client-secret'
  properties: { value: entraClientSecret }
}

// RBAC: Managed Identity -> Key Vault Secrets User (read secrets at runtime)
resource kvRoleSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // deterministic GUID: vault + identity + role
  name: guid(keyVault.id, managedIdentity.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User
    )
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ─────────────────────────────────────────────
// App Service Plan
// ─────────────────────────────────────────────

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: 'asp-${resourceToken}'
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: appServicePlanSku
  }
  properties: {
    reserved: true // required for Linux
  }
}

// ─────────────────────────────────────────────
// Azure SQL Server + Database
// ─────────────────────────────────────────────

resource sqlServer 'Microsoft.Sql/servers@2023-05-01-preview' = {
  name: sqlServerName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    // Set the user-assigned MI as the AAD admin so the App Service
    // can connect via azure-default auth mode without a password.
    azureADOnlyAuthentication: false
  }
}

// Allow outbound connections from Azure services (0.0.0.0 → 0.0.0.0 is the documented convention)
resource sqlFirewallAllowAzure 'Microsoft.Sql/servers/firewallRules@2023-05-01-preview' = {
  parent: sqlServer
  name: 'AllowAllAzureServicesAndResources'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-05-01-preview' = {
  parent: sqlServer
  name: 'powerbiembedded'
  location: location
  tags: tags
  sku: {
    name: sqlDatabaseSku
    tier: sqlDatabaseSku == 'Basic' ? 'Basic' : 'Standard'
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: sqlDatabaseSku == 'Basic' ? 2147483648 : 10737418240 // 2 GB Basic / 10 GB Standard
    zoneRedundant: false
  }
}

// ─────────────────────────────────────────────
// App Service (Linux, Node 20 LTS)
// ─────────────────────────────────────────────

resource appService 'Microsoft.Web/sites@2023-01-01' = {
  name: appServiceName
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      // The app starts with `next start` on port 3000; App Service proxies on 80/443.
      appCommandLine: 'node_modules/.bin/next start'
      appSettings: [
        // ── Runtime / Node ──────────────────────────────────────────────────
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        // Disable Azure's own build step; the ZIP already contains the built app.
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        // ── Application Insights ────────────────────────────────────────────
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
        // ── Managed Identity reference ───────────────────────────────────────
        { name: 'AZURE_CLIENT_ID_MANAGED_IDENTITY', value: managedIdentity.properties.clientId }
        // ── Microsoft Entra ID / Auth.js ─────────────────────────────────────
        { name: 'AZURE_TENANT_ID', value: tenantId }
        { name: 'AZURE_CLIENT_ID', value: entraClientId }
        { name: 'AZURE_CLIENT_SECRET', value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=entra-client-secret)' }
        { name: 'AUTH_MICROSOFT_ENTRA_ID_ID', value: entraClientId }
        { name: 'AUTH_MICROSOFT_ENTRA_ID_SECRET', value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=entra-client-secret)' }
        { name: 'AUTH_MICROSOFT_ENTRA_ID_ISSUER', value: 'https://login.microsoftonline.com/${tenantId}/v2.0' }
        { name: 'NEXTAUTH_SECRET', value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=nextauth-secret)' }
        { name: 'NEXTAUTH_URL', value: 'https://${appServiceName}.azurewebsites.net' }
        // ── Azure SQL ────────────────────────────────────────────────────────
        { name: 'AZURE_SQL_SERVER', value: '${sqlServerName}.database.windows.net' }
        { name: 'AZURE_SQL_DATABASE', value: 'powerbiembedded' }
        { name: 'AZURE_SQL_AUTH_MODE', value: 'azure-default' }
        { name: 'AZURE_SQL_ENCRYPT', value: 'true' }
        { name: 'AZURE_SQL_TRUST_SERVER_CERTIFICATE', value: 'false' }
        // ── AI Agent token (Fabric MCP default; Foundry Responses uses ai.azure.com/.default)
        { name: 'FOUNDRY_API_SCOPE', value: 'https://api.fabric.microsoft.com/.default' }
        { name: 'FOUNDRY_AUTH_MODE', value: 'azure-default' }
        // ── Bootstrap (optional — remove after first deploy) ─────────────────
        { name: 'BOOTSTRAP_ADMIN_EMAIL', value: bootstrapAdminEmail }
      ]
    }
  }
}

// Diagnostic settings: stream App Service logs to Log Analytics
resource appServiceDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'diag-${appServiceName}'
  scope: appService
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      { category: 'AppServiceHTTPLogs', enabled: true }
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceAppLogs', enabled: true }
    ]
    metrics: [
      { category: 'AllMetrics', enabled: true }
    ]
  }
}

// ─────────────────────────────────────────────
// Outputs  (consumed by azd and GitHub Actions)
// ─────────────────────────────────────────────

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenantId
output SERVICE_WEB_NAME string = appService.name
output SERVICE_WEB_URI string = 'https://${appService.properties.defaultHostName}'
output AZURE_SQL_SERVER string = '${sqlServerName}.database.windows.net'
output AZURE_SQL_DATABASE string = sqlDatabase.name
output AZURE_KEY_VAULT_NAME string = keyVault.name
output APPLICATIONINSIGHTS_CONNECTION_STRING string = appInsights.properties.ConnectionString
output MANAGED_IDENTITY_CLIENT_ID string = managedIdentity.properties.clientId
