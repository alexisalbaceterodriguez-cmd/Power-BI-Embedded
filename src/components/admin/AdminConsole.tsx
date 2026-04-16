'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminTab, AgentRow, ClientRow, ReportRow, UserRow } from './types';
import UserManager from './UserManager';
import ReportManager from './ReportManager';
import AgentManager from './AgentManager';

async function callAdminApi(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? 'Operacion no completada');
  }
}

export default function AdminConsole() {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [clientForm, setClientForm] = useState({ id: '', displayName: '', isActive: true });
  const [clientEditingId, setClientEditingId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const activeUsers = users.filter((u) => u.isActive).length;
    const activeReports = reports.filter((r) => r.isActive !== false).length;
    const activeAgents = agents.filter((a) => a.isActive).length;
    return {
      users: `${activeUsers}/${users.length}`,
      reports: `${activeReports}/${reports.length}`,
      agents: `${activeAgents}/${agents.length}`,
    };
  }, [users, reports, agents]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/bootstrap-data', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'No se pudo cargar el panel');
      setUsers(data.users ?? []);
      setReports(data.reports ?? []);
      setAgents(data.agents ?? []);
      setClients((data.clients ?? []) as ClientRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando panel');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  async function saveClient() {
    if (!clientForm.id || !clientForm.displayName) { setError('Cliente: id y nombre son obligatorios.'); return; }
    setBusy(true); setError(null);
    try {
      await callAdminApi('/api/admin/clients', clientEditingId ? 'PUT' : 'POST', clientForm);
      setClientEditingId(null);
      setClientForm({ id: '', displayName: '', isActive: true });
      await loadData();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error guardando cliente'); } finally { setBusy(false); }
  }

  async function handleSave(entity: 'users' | 'reports' | 'agents', method: 'POST' | 'PUT', payload: unknown) {
    setBusy(true); setError(null);
    try {
      await callAdminApi(`/api/admin/${entity}`, method, payload);
      await loadData();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error guardando'); } finally { setBusy(false); }
  }

  async function handleDelete(entity: 'users' | 'reports' | 'agents', id: string) {
    setBusy(true); setError(null);
    try {
      await callAdminApi(`/api/admin/${entity}?id=${encodeURIComponent(id)}`, 'DELETE');
      await loadData();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error eliminando'); } finally { setBusy(false); }
  }

  if (loading) {
    return (<div className="state-container"><div className="spinner" aria-label="Cargando panel de administracion" /></div>);
  }

  return (
    <main className="app-main admin-main">
      <section className="admin-shell">
        <div className="admin-hero">
          <h1>Control Center</h1>
          <p>Gestiona usuarios, permisos de informes y agentes IA desde un solo panel.</p>
          <div className="admin-stats">
            <article className="admin-stat-card"><strong>{stats.users}</strong><span>Usuarios activos</span></article>
            <article className="admin-stat-card"><strong>{stats.reports}</strong><span>Informes activos</span></article>
            <article className="admin-stat-card"><strong>{stats.agents}</strong><span>Agentes activos</span></article>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <div className="admin-toolbar">
          <div className="admin-tabs" role="tablist" aria-label="Secciones de administracion">
            <button className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>Usuarios</button>
            <button className={`admin-tab ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>Informes</button>
            <button className={`admin-tab ${activeTab === 'agents' ? 'active' : ''}`} onClick={() => setActiveTab('agents')}>Agentes IA</button>
          </div>
          <select className="form-input admin-client-filter" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="all">Todos los clientes</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
          <input className="form-input admin-search" placeholder="Buscar por nombre, id, email, workspace..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <section className="admin-client-manager">
          <h3>Clientes</h3>
          <div className="admin-client-controls">
            <input className="form-input" placeholder="id cliente (ej: cliente-3)" value={clientForm.id} disabled={Boolean(clientEditingId)} onChange={(e) => setClientForm((p) => ({ ...p, id: e.target.value.toLowerCase().trim() }))} />
            <input className="form-input" placeholder="Nombre cliente" value={clientForm.displayName} onChange={(e) => setClientForm((p) => ({ ...p, displayName: e.target.value }))} />
            <label className="admin-checkbox-inline">
              <input type="checkbox" checked={clientForm.isActive} onChange={(e) => setClientForm((p) => ({ ...p, isActive: e.target.checked }))} />
              Activo
            </label>
            <button className="login-btn" disabled={busy} onClick={saveClient}>{clientEditingId ? 'Guardar cliente' : 'Crear cliente'}</button>
            {clientEditingId ? (
              <button className="logout-btn" onClick={() => { setClientEditingId(null); setClientForm({ id: '', displayName: '', isActive: true }); }}>Cancelar</button>
            ) : null}
          </div>
          <div className="admin-client-tags">
            {clients.map((c) => (
              <button key={c.id} className={`admin-client-tag ${clientFilter === c.id ? 'active' : ''}`}
                onClick={() => { setClientFilter(c.id); setClientEditingId(c.id); setClientForm({ id: c.id, displayName: c.displayName, isActive: c.isActive }); }}>
                {c.displayName}
              </button>
            ))}
          </div>
        </section>

        <div className="admin-content-grid">
          {activeTab === 'users' && (
            <UserManager users={users} reports={reports} clients={clients} clientFilter={clientFilter} query={query} busy={busy}
              onSave={(method, payload) => handleSave('users', method, payload)}
              onDelete={(id) => handleDelete('users', id)} />
          )}
          {activeTab === 'reports' && (
            <ReportManager reports={reports} clients={clients} clientFilter={clientFilter} query={query} busy={busy}
              onSave={(method, payload) => handleSave('reports', method, payload)}
              onDelete={(id) => handleDelete('reports', id)} />
          )}
          {activeTab === 'agents' && (
            <AgentManager agents={agents} reports={reports} clients={clients} clientFilter={clientFilter} query={query} busy={busy}
              onSave={(method, payload) => handleSave('agents', method, payload)}
              onDelete={(id) => handleDelete('agents', id)} />
          )}
        </div>
      </section>
    </main>
  );
}
