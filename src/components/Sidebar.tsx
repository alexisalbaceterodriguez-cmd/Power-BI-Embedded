'use client';

import Image from 'next/image';

interface PublicReport {
  id: string;
  displayName: string;
}

interface SidebarProps {
  reports: PublicReport[];
  activeReportId: string | null;
  onSelectReport: (reportId: string) => void;
}

export default function Sidebar({ reports, activeReportId, onSelectReport }: SidebarProps) {
  return (
    <aside className="app-sidebar" aria-label="Informes disponibles">
      <div className="sidebar-header">
        <Image src="/LOGO_COLOR_POSITIVE.webp" alt="Seidor Logo" width={130} height={40} style={{ objectFit: 'contain' }} priority />
      </div>

      <p className="sidebar-section-title">Analisis de Transformacion</p>

      {reports.length === 0 ? (
        <p className="sidebar-empty">No tienes activos digitales asignados a tu plataforma todavia.</p>
      ) : (
        <nav className="sidebar-nav" aria-label="Lista de informes">
          {reports.map((report) => (
            <button
              key={report.id}
              id={`report-nav-${report.id}`}
              className={`sidebar-item ${activeReportId === report.id ? 'active' : ''}`}
              onClick={() => onSelectReport(report.id)}
              aria-current={activeReportId === report.id ? 'page' : undefined}
            >
              <svg
                className="sidebar-item-icon"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z"/>
              </svg>
              <span className="sidebar-item-label">{report.displayName}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="sidebar-footer">
        <p className="sidebar-division">
          Powered by
          <span>Transformation &amp; Technology</span>
        </p>
      </div>
    </aside>
  );
}
