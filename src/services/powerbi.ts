/**
 * powerbi.ts — Power BI Service (multi-report + RLS support)
 *
 * All Azure AD and Power BI REST calls stay server-side.
 * Compatible with Node.js runtime (not edge) for full bcrypt/NextAuth support.
 */

export interface PowerBIEmbedConfig {
  tokenId: string;
  token: string;
  expiration: string;
  embedUrl: string;
  reportId: string;
}

interface EmbedTokenOptions {
  workspaceId: string;
  reportId: string;
  /** UPN for RLS identity (e.g. 'user@empresa.com'). Omit for admin/no-RLS. */
  rlsUsername?: string;
  /** Role names defined in Power BI Desktop. Required when rlsUsername is provided. */
  rlsRoles?: string[];
}

/**
 * Acquires an Azure AD access token using Client Credentials flow.
 * Uses native fetch — compatible with both Node.js and Edge environments.
 */
async function getAzureToken(): Promise<string> {
  const tenantId = process.env.TENANT_ID;
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Azure AD environment variables (TENANT_ID, CLIENT_ID, CLIENT_SECRET).');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://analysis.windows.net/powerbi/api/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Azure AD token error: ${JSON.stringify(err)}`);
  }

  const data = await response.json();
  if (!data.access_token) throw new Error('Azure AD token missing in response.');
  return data.access_token;
}

/**
 * Fetches an Embed Token for a Power BI report.
 *
 * If rlsUsername + rlsRoles are provided, the token will enforce Row-Level Security.
 * The rlsUsername must match the identity configured in the report's RLS roles
 * in Power BI Desktop (DAX: USERPRINCIPALNAME()).
 *
 * @param options - Report identifiers and optional RLS settings.
 * @returns PowerBIEmbedConfig payload for the frontend.
 */
export async function getEmbedToken(options: EmbedTokenOptions): Promise<PowerBIEmbedConfig> {
  const { workspaceId, reportId, rlsUsername, rlsRoles } = options;

  if (!workspaceId || !reportId) {
    throw new Error('workspaceId and reportId are required.');
  }

  const accessToken = await getAzureToken();

  // 1. Fetch report details (embedUrl + datasetId)
  const reportResponse = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!reportResponse.ok) {
    const err = await reportResponse.json();
    throw new Error(`Power BI report fetch error: ${JSON.stringify(err)}`);
  }

  const reportData = await reportResponse.json();
  const embedUrl: string = reportData.embedUrl;
  const datasetId: string = reportData.datasetId;

  // 2. Build GenerateToken body — include RLS identities if provided
  const generateTokenBody: Record<string, unknown> = {
    datasets: [{ id: datasetId }],
    reports: [{ id: reportId }],
    targetWorkspaces: [{ id: workspaceId }],
  };

  if (rlsUsername && rlsRoles && rlsRoles.length > 0) {
    generateTokenBody.identities = [
      {
        username: rlsUsername,
        roles: rlsRoles,
        datasets: [datasetId],
      },
    ];
  }

  // 3. Generate the Embed Token
  const embedTokenResponse = await fetch(
    'https://api.powerbi.com/v1.0/myorg/GenerateToken',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(generateTokenBody),
    }
  );

  if (!embedTokenResponse.ok) {
    const err = await embedTokenResponse.json();
    throw new Error(`Power BI GenerateToken error: ${JSON.stringify(err)}`);
  }

  const embedTokenData = await embedTokenResponse.json();

  return {
    tokenId: embedTokenData.tokenId,
    token: embedTokenData.token,
    expiration: embedTokenData.expiration,
    embedUrl,
    reportId,
  };
}
