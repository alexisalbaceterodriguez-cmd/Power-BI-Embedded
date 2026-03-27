import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/authz';
import { createAIAgentFromAdmin } from '@/lib/dal';

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
      publishedUrl?: string;
      mcpUrl?: string;
      mcpToolName?: string;
      reportIds?: string[] | string;
      isActive?: boolean;
    };

    await createAIAgentFromAdmin({
      name: payload.name?.trim() ?? '',
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
