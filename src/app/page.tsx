'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import { REPORTS } from '@/config/users.config';

const EmbeddedReport = dynamic(() => import('@/components/PowerBIEmbed'), {
  ssr: false,
});

export default function Home() {
  const { data: session, status } = useSession();
  const [activeReportId, setActiveReportId] = useState<string | null>(null);

  // Determine first accessible report for auto-selection
  const handleSelectReport = (reportId: string) => {
    setActiveReportId(reportId);
  };

  // Auto-select first report once session is loaded
  if (status === 'authenticated' && !activeReportId) {
    const userReportIds = session.user?.reportIds ?? [];
    const isAdmin = session.user?.role === 'admin';
    const firstReport = isAdmin || userReportIds.includes('*')
      ? REPORTS[0]
      : REPORTS.find((r) => userReportIds.includes(r.id));
    if (firstReport) {
      setActiveReportId(firstReport.id);
    }
  }

  if (status === 'loading') {
    return (
      <div className="state-container" style={{ height: '100vh' }}>
        <div className="spinner" aria-label="Cargando sesión" />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Header />
      <Sidebar activeReportId={activeReportId} onSelectReport={handleSelectReport} />

      <main className="app-main" id="main-content">
        {activeReportId ? (
          <EmbeddedReport reportId={activeReportId} />
        ) : (
          <div className="state-container">
            <svg className="state-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M2.25 2.25a.75.75 0 000 1.5H3v10.5a3 3 0 003 3h1.21l-1.172 3.513a.75.75 0 001.424.474l.329-.987h8.418l.33.987a.75.75 0 001.422-.474l-1.17-3.513H18a3 3 0 003-3V3.75h.75a.75.75 0 000-1.5H2.25zm6.04 16.5l.5-1.5h6.42l.5 1.5H8.29zm7.46-12a.75.75 0 00-1.5 0v6a.75.75 0 001.5 0v-6zm-3 2.25a.75.75 0 00-1.5 0v3.75a.75.75 0 001.5 0V9zm-3 2.25a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5z" clipRule="evenodd"/>
            </svg>
            <p className="state-title">Selecciona un informe</p>
            <p className="state-subtitle">Elige un informe del panel lateral para comenzar.</p>
          </div>
        )}
      </main>
    </div>
  );
}
