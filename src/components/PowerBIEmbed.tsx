'use client';

import React, { useEffect, useState } from 'react';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';

/**
 * EmbeddedReport
 * 
 * A client-side React component that acts as the primary wrapper for the Power BI report iframe.
 * It asynchronously requests a secure embed token from the Next.js edge backend API and manages
 * the loading and error states to provide seamless UX without exposing Azure credentials.
 */
export default function EmbeddedReport() {
  const [embedConfig, setEmbedConfig] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchToken() {
      try {
        const response = await fetch('/api/get-embed-token');
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to get embed token');
        }

        setEmbedConfig(data);
      } catch (err: any) {
        setError(err.message);
      }
    }

    fetchToken();
  }, []);

  if (error) {
    return (
      <div className="error-container">
        <h2>Authentication Error</h2>
        <p>{error}</p>
        <p>Ensure that the Azure AD and Power BI environment variables are correctly configured in `.env.local`.</p>
      </div>
    );
  }

  if (!embedConfig) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading Power BI Report...</p>
      </div>
    );
  }

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
              filters: {
                expanded: false,
                visible: true
              },
              pageNavigation: {
                visible: true
              }
            },
          }
        }}
        cssClassName="powerbi-iframe"
      />
    </div>
  );
}
