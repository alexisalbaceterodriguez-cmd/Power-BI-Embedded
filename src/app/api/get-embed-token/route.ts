import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getEmbedToken, PowerBIServiceError } from '@/services/powerbi';
import { getSecureReportConfigForUser, recordAuditEvent } from '@/lib/dal';

export const runtime = 'nodejs';

function getClientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim();
  }
  return request.headers.get('x-real-ip') ?? undefined;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const session = await auth();

  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedReportId = request.nextUrl.searchParams.get('reportId');
  if (!requestedReportId) {
    return NextResponse.json({ error: 'Missing reportId parameter' }, { status: 400 });
  }

  const reportConfig = await getSecureReportConfigForUser({
    userId: session.user.id,
    role: session.user.role,
    requestedReportId,
  });

  if (!reportConfig) {
    await recordAuditEvent({
      eventType: 'embed.denied',
      userId: session.user.id,
      ip,
      detail: { requestedReportId },
    });

    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isAdmin = session.user.role === 'admin';

  let rlsUsername: string | undefined;
  let rlsRoles: string[] | undefined;

  const reportRlsRoles = reportConfig.rlsRoles && reportConfig.rlsRoles.length > 0 ? reportConfig.rlsRoles : undefined;

  if (isAdmin) {
    const adminRlsRolesDefined = reportConfig.adminRlsRoles && reportConfig.adminRlsRoles.length > 0;
    const roleSource = adminRlsRolesDefined ? reportConfig.adminRlsRoles : reportRlsRoles;

    if (roleSource && roleSource.length > 0) {
      rlsRoles = roleSource;
      rlsUsername = reportConfig.adminRlsUsername ?? session.user.email ?? session.user.name ?? process.env.POWERBI_RLS_ADMIN_USERNAME ?? undefined;
    }
  } else if (reportRlsRoles && reportRlsRoles.length > 0) {
    const userRlsRoles = session.user.rlsRoles ?? [];
    const intersection = userRlsRoles.filter((role) => reportRlsRoles.includes(role));

    // Hardened behavior: no permissive fallback.
    if (intersection.length === 0) {
      await recordAuditEvent({
        eventType: 'embed.rls_denied',
        userId: session.user.id,
        ip,
        detail: { requestedReportId, reason: 'no_role_intersection' },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    rlsRoles = intersection;
    // Some local fallback users do not have email. Keep strict role intersection,
    // but allow username as effective identity fallback for RLS tokens.
    rlsUsername = session.user.email ?? session.user.name ?? undefined;
  }

  if (rlsRoles && rlsRoles.length > 0 && !rlsUsername) {
    await recordAuditEvent({
      eventType: 'embed.rls_denied',
      userId: session.user.id,
      ip,
      detail: { requestedReportId, reason: 'missing_effective_identity' },
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const embedConfig = await getEmbedToken({
      workspaceId: reportConfig.workspaceId,
      reportId: reportConfig.reportId,
      rlsUsername,
      rlsRoles,
    });

    await recordAuditEvent({
      eventType: 'embed.issued',
      userId: session.user.id,
      ip,
      detail: {
        requestedReportId,
        isAdmin,
        hasRls: Boolean(rlsRoles && rlsRoles.length > 0),
      },
    });

    return NextResponse.json(embedConfig, { status: 200 });
  } catch (error) {
    if (error instanceof PowerBIServiceError) {
      return NextResponse.json({ error: error.publicMessage }, { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
