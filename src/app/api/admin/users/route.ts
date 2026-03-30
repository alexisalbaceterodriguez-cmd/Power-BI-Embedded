import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/authz';
import { createUserFromAdmin, deleteUserFromAdmin, listUsersForAdmin, updateUserFromAdmin } from '@/lib/dal';

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
      username?: string;
      email?: string;
      role?: 'admin' | 'client';
      clientId?: string;
      reportIds?: string[] | string;
      rlsRoles?: string[] | string;
      isActive?: boolean;
      expiresAt?: string;
    };

    await createUserFromAdmin({
      username: payload.username?.trim() ?? '',
      email: payload.email?.trim() ?? '',
      role: payload.role ?? 'client',
      clientId: payload.clientId?.trim(),
      reportIds: Array.isArray(payload.reportIds) ? payload.reportIds : splitCsv(payload.reportIds),
      rlsRoles: Array.isArray(payload.rlsRoles) ? payload.rlsRoles : splitCsv(payload.rlsRoles),
      isActive: payload.isActive,
      expiresAt: payload.expiresAt,
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

  const users = await listUsersForAdmin();
  return NextResponse.json({ users }, { status: 200 });
}

export async function PUT(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as {
      id?: string;
      username?: string;
      email?: string;
      role?: 'admin' | 'client';
      clientId?: string;
      reportIds?: string[] | string;
      rlsRoles?: string[] | string;
      isActive?: boolean;
      expiresAt?: string;
    };

    await updateUserFromAdmin({
      id: payload.id?.trim() ?? '',
      username: payload.username?.trim() ?? '',
      email: payload.email?.trim() ?? '',
      role: payload.role ?? 'client',
      clientId: payload.clientId?.trim(),
      reportIds: Array.isArray(payload.reportIds) ? payload.reportIds : splitCsv(payload.reportIds),
      rlsRoles: Array.isArray(payload.rlsRoles) ? payload.rlsRoles : splitCsv(payload.rlsRoles),
      isActive: payload.isActive,
      expiresAt: payload.expiresAt,
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
    await deleteUserFromAdmin(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad Request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
