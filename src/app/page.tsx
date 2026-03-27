'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { signOut, useSession } from 'next-auth/react';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import AIAgentDrawer from '@/components/AIAgentDrawer';

const EmbeddedReport = dynamic(() => import('@/components/PowerBIEmbed'), {
  ssr: false,
});

interface PublicReport {
  id: string;
  displayName: string;
  hasAiAgents?: boolean;
  aiAgentCount?: number;
}

interface AgentSummary {
  id: string;
  name: string;
  mcpUrl?: string;
  mcpToolName?: string;
  reportIds: string[];
}

export default function Home() {
  const { status } = useSession();
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [authLoadingTimedOut, setAuthLoadingTimedOut] = useState(false);
  const [reloadReportsKey, setReloadReportsKey] = useState(0);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'loading') {
      setAuthLoadingTimedOut(false);
      return;
    }

    const timer = setTimeout(() => {
      setAuthLoadingTimedOut(true);
    }, 8000);

    return () => clearTimeout(timer);
  }, [status, reloadReportsKey]);

  useEffect(() => {
    if (status !== 'authenticated') {
      setReports([]);
      setActiveReportId(null);
      return;
    }

    let cancelled = false;

    async function loadReports() {
      try {
        setReportsError(null);
        const response = await fetch('/api/reports', { cache: 'no-store' });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? 'No se pudieron cargar los informes');
        }

        if (cancelled) return;

        const nextReports = Array.isArray(data.reports) ? (data.reports as PublicReport[]) : [];
        setReports(nextReports);

        if (nextReports.length === 0) {
          setActiveReportId(null);
          return;
        }

        setActiveReportId((current) => {
          if (current && nextReports.some((report) => report.id === current)) return current;
          return nextReports[0].id;
        });
      } catch (error) {
        if (cancelled) return;
        setReports([]);
        setActiveReportId(null);
        setReportsError(error instanceof Error ? error.message : 'Error cargando informes');
      }
    }

    loadReports();

    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (!activeReportId || status !== 'authenticated') {
      setAgents([]);
      setAgentsOpen(false);
      setAgentsError(null);
      return;
    }
    const reportId = activeReportId;

    let cancelled = false;

    async function loadAgentsForReport() {
      try {
        setAgentsError(null);
        const response = await fetch(`/api/ai-agents?reportId=${encodeURIComponent(reportId)}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? 'No se pudieron cargar los agentes IA');
        }
        if (cancelled) return;
        setAgents(Array.isArray(data.agents) ? (data.agents as AgentSummary[]) : []);
      } catch (error) {
        if (cancelled) return;
        setAgents([]);
        setAgentsError(error instanceof Error ? error.message : 'No se pudieron cargar los agentes IA');
      }
    }

    loadAgentsForReport();

    return () => {
      cancelled = true;
    };
  }, [activeReportId, status]);

  if (status === 'loading') {
    if (authLoadingTimedOut) {
      return (
        <div className="state-container">
          <p className="state-title error-text">No se pudo validar la sesion</p>
          <p className="state-subtitle">Recarga la pagina. Si persiste, cierra sesion y vuelve a iniciar.</p>
          <a className="login-btn" href="/login" style={{ textDecoration: 'none' }}>
            Ir a login
          </a>
        </div>
      );
    }

    return (
      <div className="state-container" style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}>
        <div className="spinner" aria-label="Validando credenciales corporativas..." />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Header
        showAiLauncher={Boolean(activeReportId && agents.length > 0)}
        aiAgentCount={agents.length}
        onOpenAi={() => setAgentsOpen(true)}
      />
      <Sidebar reports={reports} activeReportId={activeReportId} onSelectReport={setActiveReportId} />

      <main className="app-main" id="main-content">
        {activeReportId && agentsOpen ? (
          <AIAgentDrawer
            open={agentsOpen}
            reportId={activeReportId}
            agents={agents}
            onClose={() => setAgentsOpen(false)}
          />
        ) : null}

        {reportsError ? (
          <div className="state-container">
            <p className="state-title error-text">Error de acceso</p>
            <p className="state-subtitle">{reportsError}</p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="login-btn" onClick={() => setReloadReportsKey((value) => value + 1)}>
                Reintentar
              </button>
              <button className="logout-btn" onClick={() => signOut({ callbackUrl: '/login' })}>
                Volver al login
              </button>
            </div>
          </div>
        ) : activeReportId ? (
          <>
            {agentsError ? (
              <div style={{ marginBottom: '0.75rem', color: 'var(--status-error)', fontSize: '0.875rem' }}>
                {agentsError}
              </div>
            ) : null}
            <EmbeddedReport reportId={activeReportId} />
          </>
        ) : (
          <div className="state-container">
            <svg className="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <h2 className="state-title">Portal de Transformacion y Datos</h2>
            <p className="state-subtitle">No tienes informes asignados actualmente.</p>
          </div>
        )}
      </main>
    </div>
  );
}
