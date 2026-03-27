import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/authz';
import { createReportFromAdmin } from '@/lib/dal';

export const runtime = 'nodejs';

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as {
      id?: string;
      displayName?: string;
      workspaceId?: string;
      reportId?: string;
      rlsRoles?: string[] | string;
      adminRlsRoles?: string[] | string;
      adminRlsUsername?: string;
      isActive?: boolean;
    };

    await createReportFromAdmin({
      id: payload.id?.trim() ?? '',
      displayName: payload.displayName?.trim() ?? '',
      workspaceId: payload.workspaceId?.trim() ?? '',
      reportId: payload.reportId?.trim() ?? '',
      rlsRoles: Array.isArray(payload.rlsRoles) ? payload.rlsRoles : splitCsv(payload.rlsRoles),
      adminRlsRoles: Array.isArray(payload.adminRlsRoles) ? payload.adminRlsRoles : splitCsv(payload.adminRlsRoles),
      adminRlsUsername: payload.adminRlsUsername?.trim(),
      isActive: payload.isActive,
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad Request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
