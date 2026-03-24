'use client';

import React, { useEffect, useState } from 'react';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';

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

  useEffect(() => {
    setLoading(true);
    setError(null);
    setEmbedConfig(null);

    async function fetchToken() {
      try {
        const response = await fetch(`/api/get-embed-token?reportId=${encodeURIComponent(reportId)}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Error al cargar el informe');
        }

        setEmbedConfig(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        setLoading(false);
      }
    }

    fetchToken();
  }, [reportId]);

  if (loading) {
    return (
      <div className="state-container">
        <div className="spinner" aria-label="Cargando informe" />
        <p className="state-subtitle">Cargando informe...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="state-container">
        <svg className="state-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd"/>
        </svg>
        <p className="state-title error-text">Error al cargar el informe</p>
        <p className="state-subtitle">{error}</p>
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
