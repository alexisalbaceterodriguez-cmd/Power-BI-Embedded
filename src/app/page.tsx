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
      <div className="state-container" style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}>
        <div className="spinner" aria-label="Validando credenciales corporativas..." />
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
            <svg className="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <h2 className="state-title">Portal de Transformación y Datos</h2>
            <p className="state-subtitle">Selecciona un cuadro de mando corporativo en el panel lateral para explorar tus métricas e impulsar la innovación en tu negocio.</p>
          </div>
        )}
      </main>
    </div>
  );
}
