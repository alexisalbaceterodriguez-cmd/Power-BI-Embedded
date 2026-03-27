/**
 * powerbi.ts - Power BI service integration.
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
  rlsUsername?: string;
  rlsRoles?: string[];
}

interface AzureTokenCache {
  token: string;
  expiresAtMs: number;
}

let azureTokenCache: AzureTokenCache | null = null;

export class PowerBIServiceError extends Error {
  statusCode: number;
  publicMessage: string;

  constructor(message: string, publicMessage: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function cachedAzureToken(): string | null {
  if (!azureTokenCache) return null;
  const safetyWindowMs = 60 * 1000;
  if (Date.now() + safetyWindowMs >= azureTokenCache.expiresAtMs) return null;
  return azureTokenCache.token;
}

async function getAzureToken(): Promise<string> {
  const cached = cachedAzureToken();
  if (cached) return cached;

  const tenantId = process.env.TENANT_ID;
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new PowerBIServiceError(
      'Missing Azure AD env vars.',
      'Power BI service is not configured.',
      500
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://analysis.windows.net/powerbi/api/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    cache: 'no-store',
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new PowerBIServiceError(
      `Azure token request failed (${response.status}): ${JSON.stringify(payload)}`,
      'Authentication with Power BI provider failed.',
      502
    );
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new PowerBIServiceError('Azure token missing.', 'Authentication with Power BI provider failed.', 502);
  }

  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  azureTokenCache = {
    token: data.access_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };

  return data.access_token;
}

export async function getEmbedToken(options: EmbedTokenOptions): Promise<PowerBIEmbedConfig> {
  const { workspaceId, reportId, rlsUsername, rlsRoles } = options;

  if (!workspaceId || !reportId) {
    throw new PowerBIServiceError('workspaceId/reportId missing.', 'Invalid report configuration.', 400);
  }

  const accessToken = await getAzureToken();

  const reportResponse = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }
  );

  if (!reportResponse.ok) {
    const payload = await safeJson(reportResponse);
    throw new PowerBIServiceError(
      `Power BI report metadata request failed (${reportResponse.status}): ${JSON.stringify(payload)}`,
      'Unable to access requested report.',
      reportResponse.status === 404 ? 404 : 502
    );
  }

  const reportData = (await reportResponse.json()) as { embedUrl?: string; datasetId?: string };

  if (!reportData.embedUrl || !reportData.datasetId) {
    throw new PowerBIServiceError('Power BI response missing embedUrl/datasetId.', 'Invalid report metadata.', 502);
  }

  const generateTokenBody: Record<string, unknown> = {
    datasets: [{ id: reportData.datasetId }],
    reports: [{ id: reportId }],
    targetWorkspaces: [{ id: workspaceId }],
  };

  if (rlsUsername && rlsRoles && rlsRoles.length > 0) {
    generateTokenBody.identities = [
      {
        username: rlsUsername,
        roles: rlsRoles,
        datasets: [reportData.datasetId],
      },
    ];
  }

  const embedTokenResponse = await fetch('https://api.powerbi.com/v1.0/myorg/GenerateToken', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(generateTokenBody),
    cache: 'no-store',
  });

  if (!embedTokenResponse.ok) {
    const payload = await safeJson(embedTokenResponse);
    throw new PowerBIServiceError(
      `Power BI GenerateToken failed (${embedTokenResponse.status}): ${JSON.stringify(payload)}`,
      'Unable to issue embed token for this report.',
      502
    );
  }

  const embedTokenData = (await embedTokenResponse.json()) as {
    tokenId: string;
    token: string;
    expiration: string;
  };

  return {
    tokenId: embedTokenData.tokenId,
    token: embedTokenData.token,
    expiration: embedTokenData.expiration,
    embedUrl: reportData.embedUrl,
    reportId,
  };
}
