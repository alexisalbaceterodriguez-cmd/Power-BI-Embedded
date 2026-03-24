import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getEmbedToken } from '@/services/powerbi';
import { REPORTS } from '@/config/users.config';

/**
 * GET /api/get-embed-token?reportId=<id>
 *
 * Requires an active session. Validates that the requested report ID
 * is authorized for the current user, then returns a Power BI embed token
 * (with optional RLS identities for client users).
 */
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // 1. Verify session
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { role, reportIds } = session.user;

    // 2. Parse requested reportId from query string
    const { searchParams } = new URL(request.url);
    const requestedReportId = searchParams.get('reportId');

    if (!requestedReportId) {
      return NextResponse.json({ error: 'Missing reportId parameter' }, { status: 400 });
    }

    // 3. Validate the user has access to this report
    const isAdmin = role === 'admin';
    const hasAccess =
      isAdmin ||
      reportIds.includes('*') ||
      reportIds.includes(requestedReportId);

    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden: Report not assigned to this user' }, { status: 403 });
    }

    // 4. Look up the report configuration
    const reportConfig = REPORTS.find((r) => r.id === requestedReportId);
    if (!reportConfig) {
      return NextResponse.json({ error: 'Report configuration not found' }, { status: 404 });
    }

    // 5. Generate embed token — Always pass RLS if configured.
    // Power BI REST API strictly requires an effective identity for any dataset that has RLS enabled, even for Service Principals.
    const embedConfig = await getEmbedToken({
      workspaceId: reportConfig.workspaceId,
      reportId: reportConfig.reportId,
      rlsUsername: isAdmin ? (reportConfig.adminRlsUsername ?? reportConfig.rlsUsername) : reportConfig.rlsUsername,
      rlsRoles: isAdmin ? (reportConfig.adminRlsRoles ?? reportConfig.rlsRoles) : reportConfig.rlsRoles,
    });

    return NextResponse.json(embedConfig, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('API /api/get-embed-token error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
