'use client';

import { useEffect, useMemo, useState } from 'react';

type Role = 'admin' | 'client';

interface UserRow {
  id: string;
  username: string;
  email?: string;
  role: Role;
  isActive: boolean;
  expiresAt?: string;
  reportIds: string[];
  rlsRoles: string[];
}

interface ReportRow {
  id: string;
  displayName: string;
  workspaceId: string;
  reportId: string;
  rlsRoles?: string[];
  adminRlsRoles?: string[];
  adminRlsUsername?: string;
}

export default function AdminConsole() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [userForm, setUserForm] = useState({
    username: '',
    email: '',
    role: 'client' as Role,
    password: '',
    reportIds: '',
    rlsRoles: '',
  });

  const [reportForm, setReportForm] = useState({
    id: '',
    displayName: '',
    workspaceId: '',
    reportId: '',
    rlsRoles: '',
    adminRlsRoles: '',
    adminRlsUsername: '',
  });

  const reportIdSet = useMemo(() => new Set(reports.map((report) => report.id)), [reports]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/bootstrap-data', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'No se pudo cargar el panel');
      }
      setUsers(data.users ?? []);
      setReports(data.reports ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando panel');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function createUser() {
    if (!userForm.username || !userForm.password) {
      setError('Usuario y password son obligatorios.');
      return;
    }

    const requestedReportIds = userForm.reportIds
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const invalidReportId = requestedReportIds.find((reportId) => !reportIdSet.has(reportId));
    if (invalidReportId) {
      setError(`Report ID no valido: ${invalidReportId}`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userForm),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'No se pudo crear el usuario');
      }

      setUserForm({ username: '', email: '', role: 'client', password: '', reportIds: '', rlsRoles: '' });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando usuario');
    } finally {
      setBusy(false);
    }
  }

  async function createReport() {
    if (!reportForm.id || !reportForm.displayName || !reportForm.workspaceId || !reportForm.reportId) {
      setError('Completa id, nombre, workspaceId y reportId.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportForm),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'No se pudo crear el reporte');
      }

      setReportForm({
        id: '',
        displayName: '',
        workspaceId: '',
        reportId: '',
        rlsRoles: '',
        adminRlsRoles: '',
        adminRlsUsername: '',
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando reporte');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="state-container">
        <div className="spinner" aria-label="Cargando panel de administracion" />
      </div>
    );
  }

  return (
    <main className="app-main" style={{ overflow: 'auto' }}>
      <section className="state-container" style={{ maxWidth: '100%', alignItems: 'stretch', textAlign: 'left' }}>
        <h1 className="state-title" style={{ fontSize: '1.5rem' }}>Panel de administracion</h1>
        {error ? <p className="error-text">{error}</p> : null}

        <h2 style={{ fontSize: '1.05rem' }}>Alta de usuario local</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: '0.75rem' }}>
          <input className="form-input" placeholder="username" value={userForm.username} onChange={(e) => setUserForm((prev) => ({ ...prev, username: e.target.value }))} />
          <input className="form-input" placeholder="email" value={userForm.email} onChange={(e) => setUserForm((prev) => ({ ...prev, email: e.target.value }))} />
          <select className="form-input" value={userForm.role} onChange={(e) => setUserForm((prev) => ({ ...prev, role: e.target.value as Role }))}>
            <option value="client">client</option>
            <option value="admin">admin</option>
          </select>
          <input className="form-input" type="password" placeholder="password (min 12 + complejidad)" value={userForm.password} onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))} />
          <input className="form-input" placeholder="reportIds (csv)" value={userForm.reportIds} onChange={(e) => setUserForm((prev) => ({ ...prev, reportIds: e.target.value }))} />
          <input className="form-input" placeholder="rlsRoles (csv)" value={userForm.rlsRoles} onChange={(e) => setUserForm((prev) => ({ ...prev, rlsRoles: e.target.value }))} />
        </div>
        <button className="login-btn" disabled={busy} onClick={createUser}>Crear usuario</button>

        <h2 style={{ fontSize: '1.05rem' }}>Alta de reporte</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: '0.75rem' }}>
          <input className="form-input" placeholder="id interno" value={reportForm.id} onChange={(e) => setReportForm((prev) => ({ ...prev, id: e.target.value }))} />
          <input className="form-input" placeholder="displayName" value={reportForm.displayName} onChange={(e) => setReportForm((prev) => ({ ...prev, displayName: e.target.value }))} />
          <input className="form-input" placeholder="workspaceId" value={reportForm.workspaceId} onChange={(e) => setReportForm((prev) => ({ ...prev, workspaceId: e.target.value }))} />
          <input className="form-input" placeholder="reportId" value={reportForm.reportId} onChange={(e) => setReportForm((prev) => ({ ...prev, reportId: e.target.value }))} />
          <input className="form-input" placeholder="rlsRoles (csv)" value={reportForm.rlsRoles} onChange={(e) => setReportForm((prev) => ({ ...prev, rlsRoles: e.target.value }))} />
          <input className="form-input" placeholder="adminRlsRoles (csv)" value={reportForm.adminRlsRoles} onChange={(e) => setReportForm((prev) => ({ ...prev, adminRlsRoles: e.target.value }))} />
          <input className="form-input" placeholder="adminRlsUsername (opc.)" value={reportForm.adminRlsUsername} onChange={(e) => setReportForm((prev) => ({ ...prev, adminRlsUsername: e.target.value }))} />
        </div>
        <button className="login-btn" disabled={busy} onClick={createReport}>Crear reporte</button>

        <h2 style={{ fontSize: '1.05rem' }}>Usuarios ({users.length})</h2>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{JSON.stringify(users, null, 2)}</pre>

        <h2 style={{ fontSize: '1.05rem' }}>Reportes ({reports.length})</h2>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{JSON.stringify(reports, null, 2)}</pre>
      </section>
    </main>
  );
}
