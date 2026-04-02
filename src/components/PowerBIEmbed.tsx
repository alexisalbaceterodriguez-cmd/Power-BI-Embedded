'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';
import { signOut } from 'next-auth/react';

interface EmbeddedReportProps {
  reportId: string;
  onScopeAttributesChange?: (scopeAttributes: Record<string, string[]>) => void;
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
function normalizeScopePart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function addScopeValue(target: Record<string, string[]>, keyRaw: string, valueRaw: unknown): void {
  if (typeof valueRaw !== 'string' && typeof valueRaw !== 'number' && typeof valueRaw !== 'boolean') return;

  const key = normalizeScopePart(keyRaw);
  const value = normalizeScopePart(String(valueRaw));
  if (!key || !value) return;

  const current = target[key] ?? [];
  if (!current.includes(value)) {
    current.push(value);
    target[key] = current;
  }
}

function targetColumnName(rawTarget: unknown): string | null {
  if (!rawTarget || typeof rawTarget !== 'object') return null;
  const target = rawTarget as { column?: unknown };
  return typeof target.column === 'string' ? target.column : null;
}

function collectScopeAttributesFromFilters(filters: unknown[]): Record<string, string[]> {
  const scopeAttributes: Record<string, string[]> = {};

  for (const rawFilter of filters) {
    if (!rawFilter || typeof rawFilter !== 'object') continue;
    const filter = rawFilter as { target?: unknown; values?: unknown; conditions?: unknown };

    const columnName = targetColumnName(filter.target);
    if (!columnName) continue;

    if (Array.isArray(filter.values)) {
      for (const value of filter.values) {
        addScopeValue(scopeAttributes, columnName, value);
      }
      continue;
    }

    if (Array.isArray(filter.conditions)) {
      for (const rawCondition of filter.conditions) {
        if (!rawCondition || typeof rawCondition !== 'object') continue;
        const condition = rawCondition as { value?: unknown; value2?: unknown };
        addScopeValue(scopeAttributes, columnName, condition.value);
        addScopeValue(scopeAttributes, columnName, condition.value2);
      }
    }
  }

  return scopeAttributes;
}

export default function EmbeddedReport({ reportId, onScopeAttributesChange }: EmbeddedReportProps) {
  const [embedConfig, setEmbedConfig] = useState<EmbedConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const reportRef = useRef<{
    getFilters?: () => Promise<unknown[]>;
    getActivePage?: () => Promise<{ getFilters?: () => Promise<unknown[]> }>;
  } | null>(null);

  const refreshScopeAttributes = useCallback(async () => {
    if (!onScopeAttributesChange) return;
    const report = reportRef.current;
    if (!report || typeof report.getFilters !== 'function') return;

    try {
      const reportFilters = await report.getFilters();
      let pageFilters: unknown[] = [];

      if (typeof report.getActivePage === 'function') {
        const page = await report.getActivePage();
        if (page && typeof page.getFilters === 'function') {
          pageFilters = await page.getFilters();
        }
      }

      const scopeAttributes = collectScopeAttributesFromFilters([...(reportFilters ?? []), ...pageFilters]);
      onScopeAttributesChange(scopeAttributes);
    } catch {
      // Scope extraction is best-effort; chat still works without it.
    }
  }, [onScopeAttributesChange]);

  useEffect(() => {
    onScopeAttributesChange?.({});
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
      reportRef.current = null;
    };
  }, [reportId, retryCount, onScopeAttributesChange]);

  useEffect(() => {
    if (!embedConfig || !onScopeAttributesChange) return;

    const intervalId = setInterval(() => {
      void refreshScopeAttributes();
    }, 5000);

    return () => clearInterval(intervalId);
  }, [embedConfig, refreshScopeAttributes, onScopeAttributesChange]);

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
        getEmbeddedComponent={(embeddedComponent) => {
          reportRef.current = embeddedComponent as {
            getFilters?: () => Promise<unknown[]>;
            getActivePage?: () => Promise<{ getFilters?: () => Promise<unknown[]> }>;
          };
        }}
        eventHandlers={
          new Map([
            ['loaded', () => { void refreshScopeAttributes(); }],
            ['rendered', () => { void refreshScopeAttributes(); }],
            ['pageChanged', () => { void refreshScopeAttributes(); }],
            ['dataSelected', () => { void refreshScopeAttributes(); }],
          ])
        }
      />
    </div>
  );
}
