import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/authz';
import { createUserFromAdmin } from '@/lib/dal';

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
      password?: string;
      reportIds?: string[] | string;
      rlsRoles?: string[] | string;
      isActive?: boolean;
      expiresAt?: string;
    };

    await createUserFromAdmin({
      username: payload.username?.trim() ?? '',
      email: payload.email?.trim(),
      role: payload.role ?? 'client',
      password: payload.password,
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
