'use client';

import dynamic from 'next/dynamic';

const EmbeddedReport = dynamic(() => import('@/components/PowerBIEmbed'), {
  ssr: false,
});

export default function Home() {
  return (
    <main className="main-layout">
      <section className="dashboard-section">
        <EmbeddedReport />
      </section>
    </main>
  );
}
