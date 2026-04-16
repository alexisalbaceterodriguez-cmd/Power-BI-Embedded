'use client';

import type { AgentRow, ClientRow, ReportRow } from './types';
import { useMemo, useState } from 'react';

interface AgentManagerProps {
  agents: AgentRow[];
  reports: ReportRow[];
  clients: ClientRow[];
  clientFilter: string;
  query: string;
  busy: boolean;
  onSave: (method: 'POST' | 'PUT', payload: unknown) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function toggleReportSelection(current: string[], reportId: string): string[] {
  return current.includes(reportId) ? current.filter((id) => id !== reportId) : [...current, reportId];
}

export default function AgentManager({ agents, reports, clients, clientFilter, query, busy, onSave, onDelete }: AgentManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    id: '',
    name: '',
    clientId: clients[0]?.id ?? 'cliente-1',
    responsesEndpoint: '',
    activityEndpoint: '',
    foundryProject: '',
    foundryAgentName: '',
    foundryAgentVersion: '',
    securityMode: 'none' as 'none' | 'rls-inherit',
    migrationStatus: 'manual' as 'migrated' | 'legacy' | 'manual',
    reportIds: [] as string[],
    isActive: true,
  });

  const filtered = useMemo(() => {
    let rows = clientFilter === 'all' ? agents : agents.filter((r) => r.clientId === clientFilter);
    const term = query.trim().toLowerCase();
    if (term) {
      rows = rows.filter((r) => [r.id, r.name, r.responsesEndpoint, r.foundryProject ?? '', r.foundryAgentName ?? '', r.clientId].join(' ').toLowerCase().includes(term));
    }
    return rows;
  }, [agents, clientFilter, query]);

  const sortedReports = useMemo(
    () => [...reports].filter((r) => r.clientId === form.clientId).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [reports, form.clientId]
  );

  function resetForm() {
    setEditingId(null);
    setForm({ id: '', name: '', clientId: clients[0]?.id ?? 'cliente-1', responsesEndpoint: '', activityEndpoint: '', foundryProject: '', foundryAgentName: '', foundryAgentVersion: '', securityMode: 'none', migrationStatus: 'manual', reportIds: [], isActive: true });
  }

  function beginEdit(row: AgentRow) {
    setEditingId(row.id);
    setForm({
      id: row.id,
      name: row.name,
      clientId: row.clientId,
      responsesEndpoint: row.responsesEndpoint,
      activityEndpoint: row.activityEndpoint ?? '',
      foundryProject: row.foundryProject ?? '',
      foundryAgentName: row.foundryAgentName ?? '',
      foundryAgentVersion: row.foundryAgentVersion ?? '',
      securityMode: row.securityMode,
      migrationStatus: row.migrationStatus,
      reportIds: row.reportIds,
      isActive: row.isActive,
    });
  }

  async function save() {
    await onSave(editingId ? 'PUT' : 'POST', form);
    resetForm();
  }

  async function remove(id: string) {
    if (!confirm('Se eliminara el agente IA y sus vinculaciones. Continuar?')) return;
    await onDelete(id);
    if (editingId === id) resetForm();
  }

  return (
    <>
      <section className="admin-list-card">
        <table className="admin-table">
          <thead>
            <tr><th>Agente</th><th>Cliente</th><th>Reportes</th><th>Seguridad</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td><div className="admin-strong">{row.name}</div><div className="admin-muted">{row.id}</div></td>
                <td>{row.clientId}</td>
                <td>{row.reportIds.length}</td>
                <td>{row.securityMode === 'rls-inherit' ? 'RLS heredado' : 'Sin RLS'}</td>
                <td><span className={`admin-pill ${row.isActive ? 'ok' : 'off'}`}>{row.isActive ? 'Activo' : 'Inactivo'}</span></td>
                <td className="admin-actions">
                  <button className="admin-action-btn" onClick={() => beginEdit(row)}>Editar</button>
                  <button className="admin-action-btn danger" onClick={() => remove(row.id)} disabled={busy}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <aside className="admin-form-card">
        <h2>{editingId ? 'Editar agente IA' : 'Nuevo agente IA'}</h2>
        <div className="admin-form-grid">
          <input className="form-input" placeholder="Nombre del agente" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          <select className="form-input" value={form.clientId} onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value, reportIds: [] }))}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
          <input className="form-input" placeholder="Responses endpoint" value={form.responsesEndpoint} onChange={(e) => setForm((p) => ({ ...p, responsesEndpoint: e.target.value }))} />
          <input className="form-input" placeholder="Activity endpoint (opcional)" value={form.activityEndpoint} onChange={(e) => setForm((p) => ({ ...p, activityEndpoint: e.target.value }))} />
          <input className="form-input" placeholder="Foundry project (opcional)" value={form.foundryProject} onChange={(e) => setForm((p) => ({ ...p, foundryProject: e.target.value }))} />
          <input className="form-input" placeholder="Foundry agent name (opcional)" value={form.foundryAgentName} onChange={(e) => setForm((p) => ({ ...p, foundryAgentName: e.target.value }))} />
          <input className="form-input" placeholder="Foundry agent version (opcional)" value={form.foundryAgentVersion} onChange={(e) => setForm((p) => ({ ...p, foundryAgentVersion: e.target.value }))} />
          <select className="form-input" value={form.securityMode} onChange={(e) => setForm((p) => ({ ...p, securityMode: e.target.value as 'none' | 'rls-inherit' }))}>
            <option value="none">Sin seguridad RLS</option>
            <option value="rls-inherit">Heredar RLS del usuario</option>
          </select>
          <select className="form-input" value={form.migrationStatus} onChange={(e) => setForm((p) => ({ ...p, migrationStatus: e.target.value as 'migrated' | 'legacy' | 'manual' }))}>
            <option value="manual">Manual</option>
            <option value="migrated">Migrado</option>
            <option value="legacy">Legacy</option>
          </select>
          <label className="admin-checkbox-inline">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} />
            Agente activo
          </label>
        </div>
        <h3>Informes vinculados</h3>
        <div className="admin-check-grid">
          {sortedReports.map((report) => (
            <label key={report.id} className="admin-check-item">
              <input type="checkbox" checked={form.reportIds.includes(report.id)} onChange={() => setForm((p) => ({ ...p, reportIds: toggleReportSelection(p.reportIds, report.id) }))} />
              <span>{report.displayName}</span>
            </label>
          ))}
        </div>
        <div className="admin-form-actions">
          <button className="login-btn" disabled={busy} onClick={save}>{editingId ? 'Guardar cambios' : 'Crear agente'}</button>
          {editingId ? <button className="logout-btn" onClick={resetForm}>Cancelar</button> : null}
        </div>
      </aside>
    </>
  );
}
