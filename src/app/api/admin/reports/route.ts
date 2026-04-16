import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/authz';
import { createReportFromAdmin, deleteReportFromAdmin, listReportsForAdmin, updateReportFromAdmin } from '@/lib/dal';
import { splitCsv } from '@/lib/utils';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as {
      id?: string;
      displayName?: string;
      clientId?: string;
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
      clientId: payload.clientId?.trim() ?? '',
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

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const reports = await listReportsForAdmin();
  return NextResponse.json({ reports }, { status: 200 });
}

export async function PUT(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as {
      id?: string;
      displayName?: string;
      clientId?: string;
      workspaceId?: string;
      reportId?: string;
      rlsRoles?: string[] | string;
      adminRlsRoles?: string[] | string;
      adminRlsUsername?: string;
      isActive?: boolean;
    };

    await updateReportFromAdmin({
      id: payload.id?.trim() ?? '',
      displayName: payload.displayName?.trim() ?? '',
      clientId: payload.clientId?.trim() ?? '',
      workspaceId: payload.workspaceId?.trim() ?? '',
      reportId: payload.reportId?.trim() ?? '',
      rlsRoles: Array.isArray(payload.rlsRoles) ? payload.rlsRoles : splitCsv(payload.rlsRoles),
      adminRlsRoles: Array.isArray(payload.adminRlsRoles) ? payload.adminRlsRoles : splitCsv(payload.adminRlsRoles),
      adminRlsUsername: payload.adminRlsUsername?.trim(),
      isActive: payload.isActive,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad Request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const id = request.nextUrl.searchParams.get('id')?.trim() ?? '';
    await deleteReportFromAdmin(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad Request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
