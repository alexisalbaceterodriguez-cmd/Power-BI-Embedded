'use client';

import type { ClientRow, ReportRow, Role, UserRow } from './types';
import { formatDateForInput, splitCsv } from './types';
import { useMemo, useState } from 'react';

interface UserManagerProps {
  users: UserRow[];
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

export default function UserManager({ users, reports, clients, clientFilter, query, busy, onSave, onDelete }: UserManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    id: '',
    username: '',
    email: '',
    role: 'client' as Role,
    clientId: clients[0]?.id ?? 'cliente-1',
    reportIds: [] as string[],
    rlsRoles: '',
    isActive: true,
    expiresAt: '',
  });

  const filtered = useMemo(() => {
    let rows = clientFilter === 'all' ? users : users.filter((row) => (row.clientId ?? 'unassigned') === clientFilter);
    const term = query.trim().toLowerCase();
    if (term) {
      rows = rows.filter((row) => [row.username, row.email ?? '', row.role, row.id, row.clientId ?? ''].join(' ').toLowerCase().includes(term));
    }
    return rows;
  }, [users, clientFilter, query]);

  const sortedReports = useMemo(
    () => [...reports].filter((r) => clientFilter === 'all' || r.clientId === clientFilter).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [reports, clientFilter]
  );

  function resetForm() {
    setEditingId(null);
    setForm({ id: '', username: '', email: '', role: 'client', clientId: clients[0]?.id ?? 'cliente-1', reportIds: [], rlsRoles: '', isActive: true, expiresAt: '' });
  }

  function beginEdit(row: UserRow) {
    setEditingId(row.id);
    setForm({
      id: row.id,
      username: row.username,
      email: row.email ?? '',
      role: row.role,
      clientId: row.clientId ?? 'cliente-1',
      reportIds: row.reportIds,
      rlsRoles: row.rlsRoles.join(', '),
      isActive: row.isActive,
      expiresAt: formatDateForInput(row.expiresAt),
    });
  }

  async function save() {
    const payload = {
      ...form,
      rlsRoles: splitCsv(form.rlsRoles),
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
    };
    await onSave(editingId ? 'PUT' : 'POST', payload);
    resetForm();
  }

  async function remove(id: string) {
    if (!confirm('Se eliminara el usuario y sus permisos. Continuar?')) return;
    await onDelete(id);
    if (editingId === id) resetForm();
  }

  const visibleReports = form.role === 'admin' ? sortedReports : sortedReports.filter((r) => r.clientId === form.clientId);

  return (
    <>
      <section className="admin-list-card">
        <table className="admin-table">
          <thead>
            <tr><th>Usuario</th><th>Rol</th><th>Cliente</th><th>Informes</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td><div className="admin-strong">{row.username}</div><div className="admin-muted">{row.email}</div></td>
                <td>{row.role}</td>
                <td>{row.role === 'admin' ? 'Global' : (row.clientId ?? '-')}</td>
                <td>{row.reportIds.length}</td>
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
        <h2>{editingId ? 'Editar usuario' : 'Nuevo usuario'}</h2>
        <div className="admin-form-grid">
          <input className="form-input" placeholder="Nombre de usuario" value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))} />
          <input className="form-input" placeholder="Email (Entra ID)" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          <select className="form-input" value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as Role }))}>
            <option value="client">client</option>
            <option value="admin">admin</option>
          </select>
          <select className="form-input" value={form.clientId} onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value, reportIds: [] }))} disabled={form.role === 'admin'}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
          <label className="admin-checkbox-inline">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} />
            Usuario activo
          </label>
          <input className="form-input" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))} />
          <input className="form-input" placeholder="RLS roles (csv)" value={form.rlsRoles} onChange={(e) => setForm((p) => ({ ...p, rlsRoles: e.target.value }))} />
        </div>
        <h3>Asignación de informes</h3>
        <div className="admin-check-grid">
          {visibleReports.map((report) => (
            <label key={report.id} className="admin-check-item">
              <input type="checkbox" checked={form.reportIds.includes(report.id)} onChange={() => setForm((p) => ({ ...p, reportIds: toggleReportSelection(p.reportIds, report.id) }))} />
              <span>{report.displayName}</span>
            </label>
          ))}
        </div>
        <div className="admin-form-actions">
          <button className="login-btn" disabled={busy} onClick={save}>{editingId ? 'Guardar cambios' : 'Crear usuario'}</button>
          {editingId ? <button className="logout-btn" onClick={resetForm}>Cancelar</button> : null}
        </div>
      </aside>
    </>
  );
}
