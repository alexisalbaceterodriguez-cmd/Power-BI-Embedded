import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/authz';
import { createAIAgentFromAdmin, deleteAIAgentFromAdmin, listAIAgentsForAdmin, updateAIAgentFromAdmin } from '@/lib/dal';
import { splitCsv } from '@/lib/utils';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as {
      name?: string;
      agentType?: 'fabric-mcp' | 'foundry-responses';
      clientId?: string;
      responsesEndpoint?: string;
      activityEndpoint?: string;
      foundryProject?: string;
      foundryAgentName?: string;
      foundryAgentVersion?: string;
      securityMode?: 'none' | 'rls-inherit';
      migrationStatus?: 'migrated' | 'legacy' | 'manual';
      reportIds?: string[] | string;
      isActive?: boolean;
    };

    await createAIAgentFromAdmin({
      name: payload.name?.trim() ?? '',
      agentType: payload.agentType ?? 'fabric-mcp',
      clientId: payload.clientId?.trim() ?? '',
      responsesEndpoint: payload.responsesEndpoint?.trim() ?? '',
      activityEndpoint: payload.activityEndpoint?.trim(),
      foundryProject: payload.foundryProject?.trim(),
      foundryAgentName: payload.foundryAgentName?.trim(),
      foundryAgentVersion: payload.foundryAgentVersion?.trim(),
      securityMode: payload.securityMode,
      migrationStatus: payload.migrationStatus,
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
      agentType?: 'fabric-mcp' | 'foundry-responses';
      clientId?: string;
      responsesEndpoint?: string;
      activityEndpoint?: string;
      foundryProject?: string;
      foundryAgentName?: string;
      foundryAgentVersion?: string;
      securityMode?: 'none' | 'rls-inherit';
      migrationStatus?: 'migrated' | 'legacy' | 'manual';
      reportIds?: string[] | string;
      isActive?: boolean;
    };

    await updateAIAgentFromAdmin({
      id: payload.id?.trim() ?? '',
      name: payload.name?.trim() ?? '',
      agentType: payload.agentType ?? 'fabric-mcp',
      clientId: payload.clientId?.trim() ?? '',
      responsesEndpoint: payload.responsesEndpoint?.trim() ?? '',
      activityEndpoint: payload.activityEndpoint?.trim(),
      foundryProject: payload.foundryProject?.trim(),
      foundryAgentName: payload.foundryAgentName?.trim(),
      foundryAgentVersion: payload.foundryAgentVersion?.trim(),
      securityMode: payload.securityMode,
      migrationStatus: payload.migrationStatus,
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
