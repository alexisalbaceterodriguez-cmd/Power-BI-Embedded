import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/authz';
import { createAIAgentFromAdmin, deleteAIAgentFromAdmin, listAIAgentsForAdmin, updateAIAgentFromAdmin } from '@/lib/dal';

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
      name?: string;
      clientId?: string;
      publishedUrl?: string;
      mcpUrl?: string;
      mcpToolName?: string;
      reportIds?: string[] | string;
      isActive?: boolean;
    };

    await createAIAgentFromAdmin({
      name: payload.name?.trim() ?? '',
      clientId: payload.clientId?.trim() ?? '',
      publishedUrl: payload.publishedUrl?.trim() ?? '',
      mcpUrl: payload.mcpUrl?.trim(),
      mcpToolName: payload.mcpToolName?.trim(),
      reportIds: Array.isArray(payload.reportIds) ? payload.reportIds : splitCsv(payload.reportIds),
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

  const agents = await listAIAgentsForAdmin();
  return NextResponse.json({ agents }, { status: 200 });
}

export async function PUT(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as {
      id?: string;
      name?: string;
      clientId?: string;
      publishedUrl?: string;
      mcpUrl?: string;
      mcpToolName?: string;
      reportIds?: string[] | string;
      isActive?: boolean;
    };

    console.log(`[DEBUG] PUT /api/admin/agents - Received payload:`, {
      id: payload.id,
      publishedUrl: payload.publishedUrl,
      name: payload.name,
      reportIds: Array.isArray(payload.reportIds) ? payload.reportIds : splitCsv(payload.reportIds),
    });

    await updateAIAgentFromAdmin({
      id: payload.id?.trim() ?? '',
      name: payload.name?.trim() ?? '',
      clientId: payload.clientId?.trim() ?? '',
      publishedUrl: payload.publishedUrl?.trim() ?? '',
      mcpUrl: payload.mcpUrl?.trim(),
      mcpToolName: payload.mcpToolName?.trim(),
      reportIds: Array.isArray(payload.reportIds) ? payload.reportIds : splitCsv(payload.reportIds),
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
    await deleteAIAgentFromAdmin(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bad Request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
