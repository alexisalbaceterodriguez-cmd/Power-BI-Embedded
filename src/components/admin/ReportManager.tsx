'use client';

import type { ClientRow, ReportRow } from './types';
import { splitCsv } from './types';
import { useMemo, useState } from 'react';

interface ReportManagerProps {
  reports: ReportRow[];
  clients: ClientRow[];
  clientFilter: string;
  query: string;
  busy: boolean;
  onSave: (method: 'POST' | 'PUT', payload: unknown) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function ReportManager({ reports, clients, clientFilter, query, busy, onSave, onDelete }: ReportManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    id: '',
    displayName: '',
    clientId: clients[0]?.id ?? 'cliente-1',
    workspaceId: '',
    reportId: '',
    rlsRoles: '',
    adminRlsRoles: '',
    adminRlsUsername: '',
    isActive: true,
  });

  const filtered = useMemo(() => {
    let rows = clientFilter === 'all' ? reports : reports.filter((r) => r.clientId === clientFilter);
    const term = query.trim().toLowerCase();
    if (term) {
      rows = rows.filter((r) => [r.id, r.displayName, r.workspaceId, r.reportId, r.clientId].join(' ').toLowerCase().includes(term));
    }
    return rows;
  }, [reports, clientFilter, query]);

  function resetForm() {
    setEditingId(null);
    setForm({ id: '', displayName: '', clientId: clients[0]?.id ?? 'cliente-1', workspaceId: '', reportId: '', rlsRoles: '', adminRlsRoles: '', adminRlsUsername: '', isActive: true });
  }

  function beginEdit(row: ReportRow) {
    setEditingId(row.id);
    setForm({
      id: row.id,
      displayName: row.displayName,
      clientId: row.clientId,
      workspaceId: row.workspaceId,
      reportId: row.reportId,
      rlsRoles: (row.rlsRoles ?? []).join(', '),
      adminRlsRoles: (row.adminRlsRoles ?? []).join(', '),
      adminRlsUsername: row.adminRlsUsername ?? '',
      isActive: row.isActive !== false,
    });
  }

  async function save() {
    const payload = { ...form, rlsRoles: splitCsv(form.rlsRoles), adminRlsRoles: splitCsv(form.adminRlsRoles) };
    await onSave(editingId ? 'PUT' : 'POST', payload);
    resetForm();
  }

  async function remove(id: string) {
    if (!confirm('Se eliminara el informe y sus vinculaciones. Continuar?')) return;
    await onDelete(id);
    if (editingId === id) resetForm();
  }

  return (
    <>
      <section className="admin-list-card">
        <table className="admin-table">
          <thead>
            <tr><th>Informe</th><th>Cliente</th><th>Workspace</th><th>ReportId</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td><div className="admin-strong">{row.displayName}</div><div className="admin-muted">{row.id}</div></td>
                <td>{row.clientId}</td>
                <td className="admin-mono">{row.workspaceId}</td>
                <td className="admin-mono">{row.reportId}</td>
                <td><span className={`admin-pill ${row.isActive !== false ? 'ok' : 'off'}`}>{row.isActive !== false ? 'Activo' : 'Inactivo'}</span></td>
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
        <h2>{editingId ? 'Editar informe' : 'Nuevo informe'}</h2>
        <div className="admin-form-grid">
          <input className="form-input" placeholder="ID interno" value={form.id} disabled={Boolean(editingId)} onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))} />
          <input className="form-input" placeholder="Nombre visible" value={form.displayName} onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))} />
          <select className="form-input" value={form.clientId} onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
          <input className="form-input admin-mono-input" placeholder="Workspace ID" value={form.workspaceId} onChange={(e) => setForm((p) => ({ ...p, workspaceId: e.target.value }))} />
          <input className="form-input admin-mono-input" placeholder="Report ID" value={form.reportId} onChange={(e) => setForm((p) => ({ ...p, reportId: e.target.value }))} />
          <input className="form-input" placeholder="RLS roles (csv)" value={form.rlsRoles} onChange={(e) => setForm((p) => ({ ...p, rlsRoles: e.target.value }))} />
          <input className="form-input" placeholder="Admin RLS roles (csv)" value={form.adminRlsRoles} onChange={(e) => setForm((p) => ({ ...p, adminRlsRoles: e.target.value }))} />
          <input className="form-input" placeholder="Admin RLS username" value={form.adminRlsUsername} onChange={(e) => setForm((p) => ({ ...p, adminRlsUsername: e.target.value }))} />
          <label className="admin-checkbox-inline">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} />
            Informe activo
          </label>
        </div>
        <div className="admin-form-actions">
          <button className="login-btn" disabled={busy} onClick={save}>{editingId ? 'Guardar cambios' : 'Crear informe'}</button>
          {editingId ? <button className="logout-btn" onClick={resetForm}>Cancelar</button> : null}
        </div>
      </aside>
    </>
  );
}
