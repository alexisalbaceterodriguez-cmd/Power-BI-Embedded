import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getAIAgentByIdForUser, getSecureReportConfigForUser, recordAuditEvent } from '@/lib/dal';
import {
  extractScopeAttributesFromRoles,
  extractCompanyIdsFromRoles,
  extractCompanyIdsFromText,
  hasScopeAttributes,
  listDisallowedCompanyIds,
  listDisallowedScopeAttributes,
  normalizeCompanyIds,
  normalizeScopeAttributes,
  type ScopeAttributes,
} from '@/lib/rlsScope';
import { chatWithFoundryAgent } from '@/services/foundryAgents';
import { PowerBIServiceError } from '@/services/powerbi';

export const runtime = 'nodejs';

function getLatestUserMessage(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): string {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim());
  return latestUser?.content.trim() ?? '';
}

function getClientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim();
  return request.headers.get('x-real-ip') ?? undefined;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = getClientIp(request);

  try {
    const payload = (await request.json()) as {
      agentId?: string;
      reportId?: string;
      scopeCompanyIds?: string[];
      scopeAttributes?: Record<string, string | string[]>;
      messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    };

    const agentId = payload.agentId?.trim();
    const requestedReportId = payload.reportId?.trim();
    if (!agentId) {
      return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: 'Missing messages' }, { status: 400 });
    }

    const latestUserMessage = getLatestUserMessage(messages);
    const requestedScopeCompanyIds = normalizeCompanyIds(Array.isArray(payload.scopeCompanyIds) ? payload.scopeCompanyIds : []);
    const requestedScopeAttributes = normalizeScopeAttributes(payload.scopeAttributes);
    const hasRequestedScopeAttributes = hasScopeAttributes(requestedScopeAttributes);

    const agent = await getAIAgentByIdForUser({
      userId: session.user.id,
      role: session.user.role,
      agentId,
      reportId: requestedReportId,
    });

    if (!agent) {
      await recordAuditEvent({
        eventType: 'agent.chat.denied',
        userId: session.user.id,
        ip,
        detail: { agentId, reportId: requestedReportId },
      });

      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let effectiveUserName = session.user.email ?? session.user.name ?? session.user.id;
    let effectiveRlsRoles = session.user.rlsRoles;
    let allowedCompanyIds: string[] = [];
    let allowedScopeAttributes: ScopeAttributes = {};
    let effectiveScopeCompanyIds: string[] = requestedScopeCompanyIds;
    let effectiveScopeAttributes: ScopeAttributes = requestedScopeAttributes;

    if (agent.securityMode === 'rls-inherit') {
      if (!requestedReportId) {
        return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
      }

      const reportConfig = await getSecureReportConfigForUser({
        userId: session.user.id,
        role: session.user.role,
        requestedReportId,
      });

      if (!reportConfig) {
        await recordAuditEvent({
          eventType: 'agent.chat.rls_denied',
          userId: session.user.id,
          ip,
          detail: { agentId, reportId: requestedReportId, reason: 'report_access_denied' },
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const reportRlsRoles = reportConfig.rlsRoles && reportConfig.rlsRoles.length > 0 ? reportConfig.rlsRoles : undefined;

      if (session.user.role === 'admin') {
        const adminRlsRolesDefined = reportConfig.adminRlsRoles && reportConfig.adminRlsRoles.length > 0;
        const roleSource = adminRlsRolesDefined ? reportConfig.adminRlsRoles : reportRlsRoles;
        effectiveRlsRoles = roleSource && roleSource.length > 0 ? roleSource : undefined;
        if (effectiveRlsRoles && effectiveRlsRoles.length > 0) {
          effectiveUserName = reportConfig.adminRlsUsername ?? effectiveUserName;
        }
      } else if (reportRlsRoles && reportRlsRoles.length > 0) {
        const userRlsRoles = session.user.rlsRoles ?? [];
        const intersection = userRlsRoles.filter((role) => reportRlsRoles.includes(role));
        if (intersection.length === 0) {
          await recordAuditEvent({
            eventType: 'agent.chat.rls_denied',
            userId: session.user.id,
            ip,
            detail: { agentId, reportId: requestedReportId, reason: 'no_role_intersection' },
          });
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        effectiveRlsRoles = intersection;
      }

      allowedScopeAttributes = extractScopeAttributesFromRoles(effectiveRlsRoles);
      if (!hasRequestedScopeAttributes) {
        effectiveScopeAttributes = allowedScopeAttributes;
      }

      if (hasRequestedScopeAttributes) {
        const disallowedScopeAttributes = listDisallowedScopeAttributes(requestedScopeAttributes, allowedScopeAttributes);
        if (disallowedScopeAttributes.length > 0) {
          await recordAuditEvent({
            eventType: 'agent.chat.rls_denied',
            userId: session.user.id,
            ip,
            detail: {
              agentId,
              reportId: requestedReportId,
              reason: 'scope_attributes_out_of_scope',
              requestedScopeAttributes,
              allowedScopeAttributes,
              disallowedScopeAttributes,
            },
          });
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }

      allowedCompanyIds = extractCompanyIdsFromRoles(effectiveRlsRoles);
      effectiveScopeCompanyIds = requestedScopeCompanyIds.length > 0 ? requestedScopeCompanyIds : allowedCompanyIds;

      if (requestedScopeCompanyIds.length > 0 && allowedCompanyIds.length === 0) {
        await recordAuditEvent({
          eventType: 'agent.chat.rls_denied',
          userId: session.user.id,
          ip,
          detail: {
            agentId,
            reportId: requestedReportId,
            reason: 'company_scope_not_allowed',
            requestedScopeCompanyIds,
          },
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (allowedCompanyIds.length > 0 && latestUserMessage) {
        const referencedCompanyIds = requestedScopeCompanyIds.length > 0
          ? requestedScopeCompanyIds
          : extractCompanyIdsFromText(latestUserMessage);
        const disallowedCompanyIds = listDisallowedCompanyIds(referencedCompanyIds, allowedCompanyIds);
        if (disallowedCompanyIds.length > 0) {
          await recordAuditEvent({
            eventType: 'agent.chat.rls_denied',
            userId: session.user.id,
            ip,
            detail: {
              agentId,
              reportId: requestedReportId,
              reason: requestedScopeCompanyIds.length > 0 ? 'scope_out_of_scope' : 'query_out_of_scope',
              referencedCompanyIds,
              allowedCompanyIds,
              disallowedCompanyIds,
            },
          });
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }

    const assistantText = await chatWithFoundryAgent({
      responsesEndpoint: agent.responsesEndpoint,
      securityMode: agent.securityMode,
      userName: effectiveUserName,
      rlsRoles: effectiveRlsRoles,
      scopeCompanyIds: effectiveScopeCompanyIds,
      scopeAttributes: effectiveScopeAttributes,
      messages,
    });

    if (agent.securityMode === 'rls-inherit' && allowedCompanyIds.length > 0) {
      const referencedCompanyIds = extractCompanyIdsFromText(assistantText);
      const disallowedCompanyIds = listDisallowedCompanyIds(referencedCompanyIds, allowedCompanyIds);
      if (disallowedCompanyIds.length > 0) {
        await recordAuditEvent({
          eventType: 'agent.chat.rls_denied',
          userId: session.user.id,
          ip,
          detail: {
            agentId,
            reportId: requestedReportId,
            reason: 'response_out_of_scope',
            referencedCompanyIds,
            allowedCompanyIds,
            disallowedCompanyIds,
          },
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    await recordAuditEvent({
      eventType: 'agent.chat.success',
      userId: session.user.id,
      ip,
      detail: {
        agentId,
        reportId: requestedReportId,
        endpoint: agent.responsesEndpoint,
        securityMode: agent.securityMode,
      },
    });

    return NextResponse.json({
      message: {
        role: 'assistant',
        content: assistantText,
      },
    });
  } catch (error) {
    if (error instanceof PowerBIServiceError) {
      await recordAuditEvent({
        eventType: 'agent.chat.failed',
        userId: session.user.id,
        ip,
        detail: {
          statusCode: error.statusCode,
          publicMessage: error.publicMessage,
          internalMessage: error.message,
        },
      });
      return NextResponse.json({
        error: error.publicMessage,
        code: 'AGENT_CHAT_FAILED',
      }, { status: error.statusCode });
    }

    await recordAuditEvent({
      eventType: 'agent.chat.failed',
      userId: session.user.id,
      ip,
      detail: {
        statusCode: 500,
        publicMessage: 'Internal Server Error',
        internalMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
