'use client';

import { signOut, useSession } from 'next-auth/react';

interface HeaderProps {
  showAiLauncher?: boolean;
  aiAgentCount?: number;
  clientName?: string;
  onOpenAi?: () => void;
}

export default function Header({ showAiLauncher = false, aiAgentCount = 0, clientName, onOpenAi }: HeaderProps) {
  const { data: session } = useSession();
  const username = session?.user?.name ?? 'Usuario';
  const role = session?.user?.role ?? 'client';
  const initials = username.slice(0, 2).toUpperCase();
  const clientLabel = clientName?.trim() || 'Cliente no asignado';

  return (
    <header className="app-header">
      <div className="header-left-slot" aria-hidden={!showAiLauncher}>
        {showAiLauncher ? (
          <button className="header-ai-btn" onClick={onOpenAi} aria-label="Abrir agente IA Fabric">
            <span className="header-ai-face" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                <rect x="3" y="7" width="18" height="12" rx="4" fill="#66B6FF" />
                <circle cx="9" cy="13" r="1.4" fill="#111111" />
                <circle cx="15" cy="13" r="1.4" fill="#111111" />
                <path d="M9 16h6" stroke="#111111" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M12 4v3" stroke="#66B6FF" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <span>Fabric AI</span>
            <span className="header-ai-count">{aiAgentCount}</span>
          </button>
        ) : (
          <div className="header-ai-placeholder" />
        )}
      </div>
      {/* User info & logout */}
      <div className="header-user">
        <div className="header-badge">
          <div className="header-avatar" aria-hidden="true">{initials}</div>
          <span className="header-username">{username}</span>
        </div>
        <span className={`header-role ${role === 'admin' ? 'admin' : ''}`}>
          {clientLabel}
        </span>
        <button
          id="logout-btn"
          className="logout-btn"
          onClick={() => signOut({ callbackUrl: '/login' })}
          aria-label="Cerrar sesión"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true">
            <path fillRule="evenodd" d="M2 2.75A.75.75 0 012.75 2h5a.75.75 0 010 1.5h-4.25v9h4.25a.75.75 0 010 1.5h-5A.75.75 0 012 13.25V2.75zm10.44 4.5-1.97-1.97a.75.75 0 10-1.06 1.06L10.69 7.5H6.25a.75.75 0 000 1.5h4.44l-1.28 1.28a.75.75 0 101.06 1.06l1.97-1.97a.75.75 0 000-1.06z" clipRule="evenodd"/>
          </svg>
          Salir
        </button>
      </div>
    </header>
  );
}
