'use client';

import { useSession } from 'next-auth/react';
import { REPORTS, ReportConfig } from '@/config/users.config';

interface SidebarProps {
  activeReportId: string | null;
  onSelectReport: (reportId: string) => void;
}

export default function Sidebar({ activeReportId, onSelectReport }: SidebarProps) {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const userReportIds = session?.user?.reportIds ?? [];

  // Build the list of accessible reports
  const accessibleReports: ReportConfig[] =
    role === 'admin' || userReportIds.includes('*')
      ? REPORTS
      : REPORTS.filter((r) => userReportIds.includes(r.id));

  return (
    <aside className="app-sidebar" aria-label="Informes disponibles">
      {/* Brand Header */}
      <div className="sidebar-header">
        <span className="sidebar-logo-text">
          Seidor<span className="sidebar-logo-dot">.</span>
        </span>
      </div>

      <p className="sidebar-section-title">Análisis de Transformación</p>

      {accessibleReports.length === 0 ? (
        <p className="sidebar-empty">No tienes activos digitales asignados a tu plataforma todavía.</p>
      ) : (
        <nav className="sidebar-nav" aria-label="Lista de informes">
          {accessibleReports.map((report) => (
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

      {/* Footer Branding T&T */}
      <div className="sidebar-footer">
        <p className="sidebar-division">
          Powered by
          <span>Transformation &amp; Technology</span>
        </p>
      </div>
    </aside>
  );
}
