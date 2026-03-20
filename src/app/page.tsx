'use client';

import dynamic from 'next/dynamic';

const EmbeddedReport = dynamic(() => import('@/components/PowerBIEmbed'), {
  ssr: false,
});

export default function Home() {
  return (
    <main className="main-layout">
      <header className="page-header">
        <h1>Power BI Embedded Viewer</h1>
        <p>Interactive Data Insights</p>
      </header>
      <section className="dashboard-section">
        <EmbeddedReport />
      </section>
    </main>
  );
}
