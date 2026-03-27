'use client';

import React, { useEffect, useState } from 'react';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';
import { signOut } from 'next-auth/react';

interface EmbeddedReportProps {
  reportId: string;
}

interface EmbedConfig {
  tokenId: string;
  token: string;
  expiration: string;
  embedUrl: string;
  reportId: string;
}

/**
 * EmbeddedReport
 *
 * Fetches an embed token for a specific reportId and renders the Power BI iframe.
 * Re-fetches when the reportId prop changes (user selects a different report).
 */
export default function EmbeddedReport({ reportId }: EmbeddedReportProps) {
  const [embedConfig, setEmbedConfig] = useState<EmbedConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setEmbedConfig(null);
    let cancelled = false;

    async function fetchWithTimeout(timeoutMs: number): Promise<Response> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(`/api/get-embed-token?reportId=${encodeURIComponent(reportId)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
      } finally {
        clearTimeout(timeoutId);
      }
    }

    async function fetchToken() {
      try {
        let response: Response;
        let data: unknown;

        try {
          response = await fetchWithTimeout(30000);
          data = await response.json();
        } catch (firstError: unknown) {
          if (firstError instanceof DOMException && firstError.name === 'AbortError') {
            response = await fetchWithTimeout(30000);
            data = await response.json();
          } else {
            throw firstError;
          }
        }

        if (!response.ok) {
          const maybeError = (data as { error?: string })?.error;
          throw new Error(maybeError || 'Error al cargar el informe');
        }

        if (!cancelled) {
          setEmbedConfig(data as EmbedConfig);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') {
          setError('Tiempo de espera agotado al solicitar el informe. Reintenta en unos segundos.');
          return;
        }
        setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchToken();

    return () => {
      cancelled = true;
    };
  }, [reportId, retryCount]);

  if (loading) {
    return (
      <div className="state-container">
        <div className="spinner" aria-label="Cargando informe" />
        <p className="state-subtitle">Cargando informe...</p>
      </div>
    );
  }

  if (error) {
    const isForbidden = error.toLowerCase().includes('forbidden') || error.toLowerCase().includes('acceso');

    return (
      <div className="state-container">
        <svg className="state-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd"/>
        </svg>
        <p className="state-title error-text">Error al cargar el informe</p>
        <p className="state-subtitle">{error}</p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="login-btn" onClick={() => setRetryCount((value) => value + 1)}>
            Reintentar
          </button>
          {isForbidden ? (
            <button className="logout-btn" onClick={() => signOut({ callbackUrl: '/login' })}>
              Cambiar usuario
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!embedConfig) return null;

  return (
    <div className="report-container">
      <PowerBIEmbed
        embedConfig={{
          type: 'report',
          id: embedConfig.reportId,
          embedUrl: embedConfig.embedUrl,
          accessToken: embedConfig.token,
          tokenType: models.TokenType.Embed,
          settings: {
            panes: {
              filters: { expanded: false, visible: true },
              pageNavigation: { visible: true },
            },
          },
        }}
        cssClassName="powerbi-iframe"
      />
    </div>
  );
}
