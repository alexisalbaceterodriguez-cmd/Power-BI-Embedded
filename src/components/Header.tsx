'use client';

import { signOut, useSession } from 'next-auth/react';

interface HeaderProps {
  showAiLauncher?: boolean;
  clientName?: string;
  onOpenAi?: () => void;
}

export default function Header({ showAiLauncher = false, clientName, onOpenAi }: HeaderProps) {
  const { data: session } = useSession();
  const username = session?.user?.name ?? 'Usuario';
  const role = session?.user?.role ?? 'client';
  const initials = username.slice(0, 2).toUpperCase();
  const clientLabel = clientName?.trim() || 'Cliente no asignado';

  return (
    <header className="app-header">
      <div className="header-left-slot" aria-hidden={!showAiLauncher}>
        {showAiLauncher ? (
          <button className="header-ai-btn" onClick={onOpenAi} aria-label="Abrir agente">
            <span className="header-ai-face" aria-hidden="true">
              <img src="/icon-microsoft-foundry.png" alt="" className="header-ai-logo" />
            </span>
            <span>Agente</span>
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
