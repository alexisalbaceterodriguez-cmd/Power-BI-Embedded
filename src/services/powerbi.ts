/**
 * Configuration object returned by the Power BI embedded token service.
 * Represents the credentials and routing addresses required by the frontend client.
 */
export interface PowerBIEmbedConfig {
  /** The unique identifier of the generated embed token */
  tokenId: string;
  /** The actual JWT embed token used by the iframe mapping */
  token: string;
  /** Expiration timestamp for the token */
  expiration: string;
  /** The authenticated URL pointing to the requested Power BI report */
  embedUrl: string;
  /** The GUID of the Power BI report */
  reportId: string;
}

/**
 * Fetches an Embed Token for a Power BI Report relying on the Azure AD Client Credentials flow.
 *
 * This function utilizes standard `fetch` instead of `@azure/msal-node` to guarantee 100% compatibility
 * with Edge Computing environments like Cloudflare Workers and Vercel Edge.
 * All infrastructure secrets must be preconfigured in `.env.local`.
 *
 * @returns {Promise<PowerBIEmbedConfig>} A promise resolving to the configuration payload.
 * @throws {Error} Throws an error if required environment variables are absent or APIs reject access.
 */
export async function getEmbedToken(): Promise<PowerBIEmbedConfig> {
  const tenantId = process.env.TENANT_ID;
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const workspaceId = process.env.WORKSPACE_ID;
  const reportId = process.env.REPORT_ID;

  if (!tenantId || !clientId || !clientSecret || !workspaceId || !reportId) {
    throw new Error('Missing environment variables for Power BI backend authentication.');
  }

  // 1. Authenticate with Azure AD using standard fetch (Cloudflare Edge compatible)
  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('scope', 'https://analysis.windows.net/powerbi/api/.default');
  params.append('grant_type', 'client_credentials');

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!tokenResponse.ok) {
    const errorData = await tokenResponse.json();
    console.error('Error acquiring Azure AD token:', errorData);
    throw new Error('Failed to acquire Azure AD token');
  }

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token; // Note: access_token en la respuesta OAuth sin MSAL

  if (!accessToken) {
    throw new Error('Azure AD token could not be retrieved');
  }

  // 2. Fetch the Embed URL for the report
  const reportResponse = await fetch(`https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!reportResponse.ok) {
    const errorData = await reportResponse.json();
    console.error('Error fetching report details:', errorData);
    throw new Error('Failed to fetch report details from Power BI');
  }

  const reportData = await reportResponse.json();
  const embedUrl = reportData.embedUrl;

  // 3. Generate the Embed Token for the report
  const embedTokenResponse = await fetch(`https://api.powerbi.com/v1.0/myorg/GenerateToken`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      datasets: [{ id: reportData.datasetId }],
      reports: [{ id: reportId }],
      targetWorkspaces: [{ id: workspaceId }]
    }),
  });

  if (!embedTokenResponse.ok) {
    const errorData = await embedTokenResponse.json();
    console.error('Error generating embed token:', errorData);
    throw new Error('Failed to generate Power BI embed token');
  }

  const embedTokenData = await embedTokenResponse.json();

  return {
    tokenId: embedTokenData.tokenId,
    token: embedTokenData.token,
    expiration: embedTokenData.expiration,
    embedUrl: embedUrl,
    reportId: reportId,
  };
}
