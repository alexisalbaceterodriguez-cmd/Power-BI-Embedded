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

    // 5. Generate embed token — Dynamic RLS mapping
    // - For admin: prioritize explicit adminRlsRoles/adminRlsUsername, then fallback to report-wide roles and environmental admin username
    // - For non-admin: use intersection between user-assigned rank roles and report-allowed roles; fall back to report role list when user roles are missing
    let rlsUsername: string | undefined;
    let rlsRoles: string[] | undefined;

    const reportRlsRoles = reportConfig.rlsRoles && reportConfig.rlsRoles.length > 0 ? reportConfig.rlsRoles : undefined;

    if (isAdmin) {
      const adminRlsRolesDefined = reportConfig.adminRlsRoles && reportConfig.adminRlsRoles.length > 0;
      const rlsRolesSource = adminRlsRolesDefined ? reportConfig.adminRlsRoles : reportRlsRoles;
      if (rlsRolesSource) {
        rlsRoles = rlsRolesSource;
        rlsUsername = reportConfig.adminRlsUsername ?? session.user.email ?? process.env.POWERBI_RLS_ADMIN_USERNAME ?? undefined;
      }
    } else {
      if (reportRlsRoles) {
        const userRlsRoles = session.user.rlsRoles ?? [];
        if (userRlsRoles.length > 0) {
          const filteredRoles = userRlsRoles.filter((role) => reportRlsRoles.includes(role));
          if (filteredRoles.length > 0) {
            rlsRoles = filteredRoles;
          }
        }

        if (!rlsRoles) {
          // No user-specific roles matched, use report default roles (if we want to avoid unauthorized bypass)
          rlsRoles = reportRlsRoles;
        }

        rlsUsername = session.user.email ?? undefined;
      }
    }

    // DEBUG: log RLS selection details to track effective identity path in token generation.
    console.log('get-embed-token:', {
      userId: session.user.id,
      email: session.user.email,
      role,
      requestedReportId,
      isAdmin,
      rlsUsername,
      rlsRoles,
      reportConfigRls: reportConfig.rlsRoles,
      reportConfigAdminRls: reportConfig.adminRlsRoles,
      reportConfigAdminRlsUsername: reportConfig.adminRlsUsername,
    });

    if (rlsRoles && rlsRoles.length > 0 && !rlsUsername) {
      return NextResponse.json({ error: 'Forbidden: RLS requires an effective identity for this report' }, { status: 403 });
    }

    const embedConfig = await getEmbedToken({
      workspaceId: reportConfig.workspaceId,
      reportId: reportConfig.reportId,
      rlsUsername,
      rlsRoles,
    });

    return NextResponse.json(embedConfig, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('API /api/get-embed-token error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
