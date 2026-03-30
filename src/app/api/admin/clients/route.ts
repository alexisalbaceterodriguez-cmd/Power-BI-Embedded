import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/authz';
import { createClientFromAdmin, listClientsForAdmin, updateClientFromAdmin } from '@/lib/dal';

export const runtime = 'nodejs';

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const clients = await listClientsForAdmin();
  return NextResponse.json({ clients }, { status: 200 });
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
      isActive?: boolean;
    };

    await createClientFromAdmin({
      id: payload.id?.trim() ?? '',
      displayName: payload.displayName?.trim() ?? '',
      isActive: payload.isActive,
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad Request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
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
      isActive?: boolean;
    };

    await updateClientFromAdmin({
      id: payload.id?.trim() ?? '',
      displayName: payload.displayName?.trim() ?? '',
      isActive: payload.isActive,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad Request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
