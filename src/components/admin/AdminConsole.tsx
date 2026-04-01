'use client';

import { useEffect, useMemo, useState } from 'react';

type Role = 'admin' | 'client';
type AdminTab = 'users' | 'reports' | 'agents';

interface ClientRow {
  id: string;
  displayName: string;
  isActive: boolean;
}

interface UserRow {
  id: string;
  username: string;
  email?: string;
  role: Role;
  clientId?: string;
  isActive: boolean;
  expiresAt?: string;
  reportIds: string[];
  rlsRoles: string[];
}

interface ReportRow {
  id: string;
  displayName: string;
  clientId: string;
  workspaceId: string;
  reportId: string;
  rlsRoles?: string[];
  adminRlsRoles?: string[];
  adminRlsUsername?: string;
  isActive?: boolean;
}

interface AgentRow {
  id: string;
  name: string;
  clientId: string;
  publishedUrl: string;
  mcpUrl?: string;
  mcpToolName?: string;
  reportIds: string[];
  isActive: boolean;
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDateForInput(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 16);
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

  const [userEditingId, setUserEditingId] = useState<string | null>(null);
  const [reportEditingId, setReportEditingId] = useState<string | null>(null);
  const [agentEditingId, setAgentEditingId] = useState<string | null>(null);

  const [clientForm, setClientForm] = useState({
    id: '',
    displayName: '',
    isActive: true,
  });
  const [clientEditingId, setClientEditingId] = useState<string | null>(null);

  const [userForm, setUserForm] = useState({
    id: '',
    username: '',
    email: '',
    role: 'client' as Role,
    clientId: 'cliente-1',
    reportIds: [] as string[],
    rlsRoles: '',
    isActive: true,
    expiresAt: '',
  });

  const [reportForm, setReportForm] = useState({
    id: '',
    displayName: '',
    clientId: 'cliente-1',
    workspaceId: '',
    reportId: '',
    rlsRoles: '',
    adminRlsRoles: '',
    adminRlsUsername: '',
    isActive: true,
  });

  const [agentForm, setAgentForm] = useState({
    id: '',
    name: '',
    clientId: 'cliente-1',
    publishedUrl: '',
    mcpUrl: '',
    mcpToolName: '',
    reportIds: [] as string[],
    isActive: true,
  });

  const stats = useMemo(() => {
    const activeUsers = users.filter((user) => user.isActive).length;
    const activeReports = reports.filter((report) => report.isActive !== false).length;
    const activeAgents = agents.filter((agent) => agent.isActive).length;
    return {
      users: `${activeUsers}/${users.length}`,
      reports: `${activeReports}/${reports.length}`,
      agents: `${activeAgents}/${agents.length}`,
    };
  }, [users, reports, agents]);

  const filteredByClientUsers = useMemo(
    () => (clientFilter === 'all' ? users : users.filter((row) => (row.clientId ?? 'unassigned') === clientFilter)),
    [users, clientFilter]
  );

  const filteredByClientReports = useMemo(
    () => (clientFilter === 'all' ? reports : reports.filter((row) => row.clientId === clientFilter)),
    [reports, clientFilter]
  );

  const filteredByClientAgents = useMemo(
    () => (clientFilter === 'all' ? agents : agents.filter((row) => row.clientId === clientFilter)),
    [agents, clientFilter]
  );

  const filteredUsers = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return filteredByClientUsers;
    return filteredByClientUsers.filter((row) => [row.username, row.email ?? '', row.role, row.id, row.clientId ?? ''].join(' ').toLowerCase().includes(term));
  }, [query, filteredByClientUsers]);

  const filteredReports = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return filteredByClientReports;
    return filteredByClientReports.filter((row) => [row.id, row.displayName, row.workspaceId, row.reportId, row.clientId].join(' ').toLowerCase().includes(term));
  }, [query, filteredByClientReports]);

  const filteredAgents = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return filteredByClientAgents;
    return filteredByClientAgents.filter((row) => [row.id, row.name, row.publishedUrl, row.mcpUrl ?? '', row.mcpToolName ?? '', row.clientId].join(' ').toLowerCase().includes(term));
  }, [query, filteredByClientAgents]);

  const sortedReports = useMemo(() => [...filteredByClientReports].sort((a, b) => a.displayName.localeCompare(b.displayName)), [filteredByClientReports]);

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
      setAgents(data.agents ?? []);
      if (data.agents?.length) {
        console.log('[ADMIN-LOAD] Agents reloaded from server:', 
          (data.agents as typeof agents).map((a) => ({ id: a.id, name: a.name, url: a.publishedUrl, clients: a.clientId })).slice(0, 3));
      }
    
      const nextClients = (data.clients ?? []) as ClientRow[];
      setClients(nextClients);
      const defaultClient = nextClients[0]?.id ?? 'cliente-1';
      setUserForm((prev) => ({ ...prev, clientId: prev.clientId || defaultClient }));
      setReportForm((prev) => ({ ...prev, clientId: prev.clientId || defaultClient }));
    
      // Fix: When in edit mode, sync the form with the latest server data
      setAgentForm((prev) => {
        // If we're currently editing an agent, check if it was updated on the server
        if (prev.id && agentEditingId === prev.id) {
          const updatedAgent = (data.agents as typeof agents)?.find((a) => a.id === prev.id);
          if (updatedAgent && updatedAgent.publishedUrl && updatedAgent.publishedUrl !== prev.publishedUrl) {
            console.log('[ADMIN-LOAD] Edit mode sync: Updating agentForm from server', {
              urlChange: `${prev.publishedUrl} → ${updatedAgent.publishedUrl}`,
            });
            return {
              id: updatedAgent.id,
              name: updatedAgent.name,
              clientId: updatedAgent.clientId,
              publishedUrl: updatedAgent.publishedUrl,
              mcpUrl: updatedAgent.mcpUrl ?? '',
              mcpToolName: updatedAgent.mcpToolName ?? '',
              reportIds: updatedAgent.reportIds,
              isActive: updatedAgent.isActive,
            };
          }
        }
        // Not in edit mode or no changes, just update client ID
        return { ...prev, clientId: prev.clientId || defaultClient };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando panel');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function resetUserForm() {
    setUserEditingId(null);
    setUserForm({
      id: '',
      username: '',
      email: '',
      role: 'client',
      clientId: clients[0]?.id ?? 'cliente-1',
      reportIds: [],
      rlsRoles: '',
      isActive: true,
      expiresAt: '',
    });
  }

  function resetReportForm() {
    setReportEditingId(null);
    setReportForm({
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
  }

  function resetAgentForm() {
    setAgentEditingId(null);
    setAgentForm({
      id: '',
      name: '',
      clientId: clients[0]?.id ?? 'cliente-1',
      publishedUrl: '',
      mcpUrl: '',
      mcpToolName: '',
      reportIds: [],
      isActive: true,
    });
  }

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

  async function saveClient() {
    if (!clientForm.id || !clientForm.displayName) {
      setError('Cliente: id y nombre son obligatorios.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (clientEditingId) {
        await callAdminApi('/api/admin/clients', 'PUT', clientForm);
      } else {
        await callAdminApi('/api/admin/clients', 'POST', clientForm);
      }
      setClientEditingId(null);
      setClientForm({ id: '', displayName: '', isActive: true });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando cliente');
    } finally {
      setBusy(false);
    }
  }

  function toggleReportSelection(current: string[], reportId: string): string[] {
    return current.includes(reportId)
      ? current.filter((id) => id !== reportId)
      : [...current, reportId];
  }

  function beginEditUser(row: UserRow) {
    setUserEditingId(row.id);
    setUserForm({
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
    setActiveTab('users');
  }

  function beginEditReport(row: ReportRow) {
    setReportEditingId(row.id);
    setReportForm({
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
    setActiveTab('reports');
  }

  function beginEditAgent(row: AgentRow) {
    console.log('[AGENT-EDIT] Opening agent for edit:', {
      id: row.id,
      name: row.name,
      publishedUrl: row.publishedUrl,
      clientId: row.clientId,
      reportCount: row.reportIds.length,
    });
    
    setAgentEditingId(row.id);
    setAgentForm({
      id: row.id,
      name: row.name,
      clientId: row.clientId,
      publishedUrl: row.publishedUrl,
      mcpUrl: row.mcpUrl ?? '',
      mcpToolName: row.mcpToolName ?? '',
      reportIds: row.reportIds,
      isActive: row.isActive,
    });
    
    console.log('[AGENT-EDIT] agentForm state updated');
    setActiveTab('agents');
  }

  async function saveUser() {
    if (!userForm.username || !userForm.email) {
      setError('Usuario y email son obligatorios para Microsoft Entra ID.');
      return;
    }

    const allowedReportIds = new Set(
      reports
        .filter((report) => report.clientId === userForm.clientId)
        .map((report) => report.id)
    );
    const invalidReportId = userForm.reportIds.find((reportId) => !allowedReportIds.has(reportId));
    if (invalidReportId) {
      setError(`Report ID no valido: ${invalidReportId}`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...userForm,
        rlsRoles: splitCsv(userForm.rlsRoles),
        expiresAt: userForm.expiresAt ? new Date(userForm.expiresAt).toISOString() : undefined,
      };

      if (userEditingId) {
        await callAdminApi('/api/admin/users', 'PUT', payload);
      } else {
        await callAdminApi('/api/admin/users', 'POST', payload);
      }

      resetUserForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando usuario');
    } finally {
      setBusy(false);
    }
  }

  async function saveReport() {
    if (!reportForm.id || !reportForm.displayName || !reportForm.workspaceId || !reportForm.reportId) {
      setError('Completa id, nombre, workspaceId y reportId.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...reportForm,
        rlsRoles: splitCsv(reportForm.rlsRoles),
        adminRlsRoles: splitCsv(reportForm.adminRlsRoles),
      };

      if (reportEditingId) {
        await callAdminApi('/api/admin/reports', 'PUT', payload);
      } else {
        await callAdminApi('/api/admin/reports', 'POST', payload);
      }

      resetReportForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando informe');
    } finally {
      setBusy(false);
    }
  }

  async function saveAgent() {
    if (!agentForm.name || !agentForm.publishedUrl || agentForm.reportIds.length === 0) {
      setError('Completa nombre, URL publicada y al menos un informe para el agente IA.');
      return;
    }

    const allowedReportIds = new Set(
      reports
        .filter((report) => report.clientId === agentForm.clientId)
        .map((report) => report.id)
    );
    const invalidReportId = agentForm.reportIds.find((reportId) => !allowedReportIds.has(reportId));
    if (invalidReportId) {
      setError(`Report ID no valido para agente IA: ${invalidReportId}`);
      return;
    }

    setBusy(true);
    setError(null);
    
    // Save these values to verify after reload
    const agentIdBeingSaved = agentEditingId;
    const urlBeingSaved = agentForm.publishedUrl;
    
    try {
      if (agentEditingId) {
        await callAdminApi('/api/admin/agents', 'PUT', agentForm);
      } else {
        await callAdminApi('/api/admin/agents', 'POST', agentForm);
      }

      console.log('[AGENT-FIX] API call succeeded, reloading data...');
      resetAgentForm();
      await loadData();
      
      // Verification: Check that the data persisted correctly
      if (agentIdBeingSaved) {
        try {
          const verify = await fetch('/api/admin/agents');
          const verifyData = await verify.json();
          const savedAgent = (verifyData.agents as typeof agents)?.find((a) => a.id === agentIdBeingSaved);
          
          if (savedAgent?.publishedUrl && savedAgent.publishedUrl === urlBeingSaved) {
            console.log('[AGENT-FIX] ✓ Verification passed - URL persisted correctly:', savedAgent.publishedUrl);
          } else if (savedAgent) {
            console.error('[AGENT-FIX] ✗ URL mismatch detected!', {
              sent: urlBeingSaved,
              saved: savedAgent.publishedUrl || '(empty)',
            });
          }
        } catch (verifyErr) {
          console.warn('[AGENT-FIX] Verification fetch failed:', verifyErr);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando agente IA');
      console.error('[AGENT-SAVE] Save failed:', err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(id: string) {
    if (!confirm('Se eliminara el usuario y sus permisos. Continuar?')) return;
    setBusy(true);
    setError(null);
    try {
      await callAdminApi(`/api/admin/users?id=${encodeURIComponent(id)}`, 'DELETE');
      if (userEditingId === id) resetUserForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error eliminando usuario');
    } finally {
      setBusy(false);
    }
  }

  async function deleteReport(id: string) {
    if (!confirm('Se eliminara el informe y sus vinculaciones. Continuar?')) return;
    setBusy(true);
    setError(null);
    try {
      await callAdminApi(`/api/admin/reports?id=${encodeURIComponent(id)}`, 'DELETE');
      if (reportEditingId === id) resetReportForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error eliminando informe');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAgent(id: string) {
    if (!confirm('Se eliminara el agente IA y sus vinculaciones. Continuar?')) return;
    setBusy(true);
    setError(null);
    try {
      await callAdminApi(`/api/admin/agents?id=${encodeURIComponent(id)}`, 'DELETE');
      if (agentEditingId === id) resetAgentForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error eliminando agente IA');
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
    <main className="app-main admin-main">
      <section className="admin-shell">
        <div className="admin-hero">
          <h1>Control Center</h1>
          <p>Gestiona usuarios, permisos de informes y agentes IA desde un solo panel.</p>
          <div className="admin-stats">
            <article className="admin-stat-card">
              <strong>{stats.users}</strong>
              <span>Usuarios activos</span>
            </article>
            <article className="admin-stat-card">
              <strong>{stats.reports}</strong>
              <span>Informes activos</span>
            </article>
            <article className="admin-stat-card">
              <strong>{stats.agents}</strong>
              <span>Agentes activos</span>
            </article>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <div className="admin-toolbar">
          <div className="admin-tabs" role="tablist" aria-label="Secciones de administracion">
            <button className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>Usuarios</button>
            <button className={`admin-tab ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>Informes</button>
            <button className={`admin-tab ${activeTab === 'agents' ? 'active' : ''}`} onClick={() => setActiveTab('agents')}>Agentes IA</button>
          </div>
          <select className="form-input admin-client-filter" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
            <option value="all">Todos los clientes</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.displayName}</option>
            ))}
          </select>
          <input
            className="form-input admin-search"
            placeholder="Buscar por nombre, id, email, workspace..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <section className="admin-client-manager">
          <h3>Clientes</h3>
          <div className="admin-client-controls">
            <input className="form-input" placeholder="id cliente (ej: cliente-3)" value={clientForm.id} disabled={Boolean(clientEditingId)} onChange={(event) => setClientForm((prev) => ({ ...prev, id: event.target.value.toLowerCase().trim() }))} />
            <input className="form-input" placeholder="Nombre cliente" value={clientForm.displayName} onChange={(event) => setClientForm((prev) => ({ ...prev, displayName: event.target.value }))} />
            <label className="admin-checkbox-inline">
              <input type="checkbox" checked={clientForm.isActive} onChange={(event) => setClientForm((prev) => ({ ...prev, isActive: event.target.checked }))} />
              Activo
            </label>
            <button className="login-btn" disabled={busy} onClick={saveClient}>{clientEditingId ? 'Guardar cliente' : 'Crear cliente'}</button>
            {clientEditingId ? (
              <button className="logout-btn" onClick={() => { setClientEditingId(null); setClientForm({ id: '', displayName: '', isActive: true }); }}>
                Cancelar
              </button>
            ) : null}
          </div>
          <div className="admin-client-tags">
            {clients.map((client) => (
              <button
                key={client.id}
                className={`admin-client-tag ${clientFilter === client.id ? 'active' : ''}`}
                onClick={() => {
                  setClientFilter(client.id);
                  setClientEditingId(client.id);
                  setClientForm({ id: client.id, displayName: client.displayName, isActive: client.isActive });
                }}
              >
                {client.displayName}
              </button>
            ))}
          </div>
        </section>

        <div className="admin-content-grid">
          <section className="admin-list-card">
            {activeTab === 'users' ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Cliente</th>
                    <th>Informes</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-strong">{row.username}</div>
                        <div className="admin-muted">{row.email}</div>
                      </td>
                      <td>{row.role}</td>
                      <td>{row.role === 'admin' ? 'Global' : (row.clientId ?? '-')}</td>
                      <td>{row.reportIds.length}</td>
                      <td><span className={`admin-pill ${row.isActive ? 'ok' : 'off'}`}>{row.isActive ? 'Activo' : 'Inactivo'}</span></td>
                      <td className="admin-actions">
                        <button className="admin-action-btn" onClick={() => beginEditUser(row)}>Editar</button>
                        <button className="admin-action-btn danger" onClick={() => deleteUser(row.id)} disabled={busy}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {activeTab === 'reports' ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Informe</th>
                    <th>Cliente</th>
                    <th>Workspace</th>
                    <th>ReportId</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-strong">{row.displayName}</div>
                        <div className="admin-muted">{row.id}</div>
                      </td>
                      <td>{row.clientId}</td>
                      <td className="admin-mono">{row.workspaceId}</td>
                      <td className="admin-mono">{row.reportId}</td>
                      <td><span className={`admin-pill ${row.isActive !== false ? 'ok' : 'off'}`}>{row.isActive !== false ? 'Activo' : 'Inactivo'}</span></td>
                      <td className="admin-actions">
                        <button className="admin-action-btn" onClick={() => beginEditReport(row)}>Editar</button>
                        <button className="admin-action-btn danger" onClick={() => deleteReport(row.id)} disabled={busy}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {activeTab === 'agents' ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Agente</th>
                    <th>Cliente</th>
                    <th>Reportes</th>
                    <th>MCP</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-strong">{row.name}</div>
                        <div className="admin-muted">{row.id}</div>
                      </td>
                      <td>{row.clientId}</td>
                      <td>{row.reportIds.length}</td>
                      <td>{row.mcpUrl ? 'Configurado' : 'Sin MCP'}</td>
                      <td><span className={`admin-pill ${row.isActive ? 'ok' : 'off'}`}>{row.isActive ? 'Activo' : 'Inactivo'}</span></td>
                      <td className="admin-actions">
                        <button className="admin-action-btn" onClick={() => beginEditAgent(row)}>Editar</button>
                        <button className="admin-action-btn danger" onClick={() => deleteAgent(row.id)} disabled={busy}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>

          <aside className="admin-form-card">
            {activeTab === 'users' ? (
              <>
                <h2>{userEditingId ? 'Editar usuario' : 'Nuevo usuario'}</h2>
                <div className="admin-form-grid">
                  <input className="form-input" placeholder="Nombre de usuario" value={userForm.username} onChange={(event) => setUserForm((prev) => ({ ...prev, username: event.target.value }))} />
                  <input className="form-input" placeholder="Email (Entra ID)" value={userForm.email} onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))} />
                  <select className="form-input" value={userForm.role} onChange={(event) => setUserForm((prev) => ({ ...prev, role: event.target.value as Role }))}>
                    <option value="client">client</option>
                    <option value="admin">admin</option>
                  </select>
                  <select className="form-input" value={userForm.clientId} onChange={(event) => setUserForm((prev) => ({ ...prev, clientId: event.target.value, reportIds: [] }))} disabled={userForm.role === 'admin'}>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>{client.displayName}</option>
                    ))}
                  </select>
                  <label className="admin-checkbox-inline">
                    <input type="checkbox" checked={userForm.isActive} onChange={(event) => setUserForm((prev) => ({ ...prev, isActive: event.target.checked }))} />
                    Usuario activo
                  </label>
                  <input className="form-input" type="datetime-local" value={userForm.expiresAt} onChange={(event) => setUserForm((prev) => ({ ...prev, expiresAt: event.target.value }))} />
                  <input className="form-input" placeholder="RLS roles (csv)" value={userForm.rlsRoles} onChange={(event) => setUserForm((prev) => ({ ...prev, rlsRoles: event.target.value }))} />
                </div>
                <h3>Asignación de informes</h3>
                <div className="admin-check-grid">
                  {(userForm.role === 'admin' ? sortedReports : sortedReports.filter((report) => report.clientId === userForm.clientId)).map((report) => (
                    <label key={report.id} className="admin-check-item">
                      <input
                        type="checkbox"
                        checked={userForm.reportIds.includes(report.id)}
                        onChange={() => setUserForm((prev) => ({ ...prev, reportIds: toggleReportSelection(prev.reportIds, report.id) }))}
                      />
                      <span>{report.displayName}</span>
                    </label>
                  ))}
                </div>
                <div className="admin-form-actions">
                  <button className="login-btn" disabled={busy} onClick={saveUser}>{userEditingId ? 'Guardar cambios' : 'Crear usuario'}</button>
                  {userEditingId ? <button className="logout-btn" onClick={resetUserForm}>Cancelar</button> : null}
                </div>
              </>
            ) : null}

            {activeTab === 'reports' ? (
              <>
                <h2>{reportEditingId ? 'Editar informe' : 'Nuevo informe'}</h2>
                <div className="admin-form-grid">
                  <input className="form-input" placeholder="ID interno" value={reportForm.id} disabled={Boolean(reportEditingId)} onChange={(event) => setReportForm((prev) => ({ ...prev, id: event.target.value }))} />
                  <input className="form-input" placeholder="Nombre visible" value={reportForm.displayName} onChange={(event) => setReportForm((prev) => ({ ...prev, displayName: event.target.value }))} />
                  <select className="form-input" value={reportForm.clientId} onChange={(event) => setReportForm((prev) => ({ ...prev, clientId: event.target.value }))}>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>{client.displayName}</option>
                    ))}
                  </select>
                  <input className="form-input admin-mono-input" placeholder="Workspace ID" value={reportForm.workspaceId} onChange={(event) => setReportForm((prev) => ({ ...prev, workspaceId: event.target.value }))} />
                  <input className="form-input admin-mono-input" placeholder="Report ID" value={reportForm.reportId} onChange={(event) => setReportForm((prev) => ({ ...prev, reportId: event.target.value }))} />
                  <input className="form-input" placeholder="RLS roles (csv)" value={reportForm.rlsRoles} onChange={(event) => setReportForm((prev) => ({ ...prev, rlsRoles: event.target.value }))} />
                  <input className="form-input" placeholder="Admin RLS roles (csv)" value={reportForm.adminRlsRoles} onChange={(event) => setReportForm((prev) => ({ ...prev, adminRlsRoles: event.target.value }))} />
                  <input className="form-input" placeholder="Admin RLS username" value={reportForm.adminRlsUsername} onChange={(event) => setReportForm((prev) => ({ ...prev, adminRlsUsername: event.target.value }))} />
                  <label className="admin-checkbox-inline">
                    <input type="checkbox" checked={reportForm.isActive} onChange={(event) => setReportForm((prev) => ({ ...prev, isActive: event.target.checked }))} />
                    Informe activo
                  </label>
                </div>
                <div className="admin-form-actions">
                  <button className="login-btn" disabled={busy} onClick={saveReport}>{reportEditingId ? 'Guardar cambios' : 'Crear informe'}</button>
                  {reportEditingId ? <button className="logout-btn" onClick={resetReportForm}>Cancelar</button> : null}
                </div>
              </>
            ) : null}

            {activeTab === 'agents' ? (
              <>
                <h2>{agentEditingId ? 'Editar agente IA' : 'Nuevo agente IA'}</h2>
                <div className="admin-form-grid">
                  <input className="form-input" placeholder="Nombre" value={agentForm.name} onChange={(event) => setAgentForm((prev) => ({ ...prev, name: event.target.value }))} />
                  <select className="form-input" value={agentForm.clientId} onChange={(event) => setAgentForm((prev) => ({ ...prev, clientId: event.target.value, reportIds: [] }))}>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>{client.displayName}</option>
                    ))}
                  </select>
                  <input className="form-input admin-mono-input" placeholder="Published URL" value={agentForm.publishedUrl} onChange={(event) => setAgentForm((prev) => ({ ...prev, publishedUrl: event.target.value }))} />
                  <input className="form-input admin-mono-input" placeholder="MCP URL (opcional)" value={agentForm.mcpUrl} onChange={(event) => setAgentForm((prev) => ({ ...prev, mcpUrl: event.target.value }))} />
                  <input className="form-input" placeholder="MCP Tool Name (opcional)" value={agentForm.mcpToolName} onChange={(event) => setAgentForm((prev) => ({ ...prev, mcpToolName: event.target.value }))} />
                  <label className="admin-checkbox-inline">
                    <input type="checkbox" checked={agentForm.isActive} onChange={(event) => setAgentForm((prev) => ({ ...prev, isActive: event.target.checked }))} />
                    Agente activo
                  </label>
                </div>
                <h3>Informes vinculados</h3>
                <div className="admin-check-grid">
                  {sortedReports.filter((report) => report.clientId === agentForm.clientId).map((report) => (
                    <label key={report.id} className="admin-check-item">
                      <input
                        type="checkbox"
                        checked={agentForm.reportIds.includes(report.id)}
                        onChange={() => setAgentForm((prev) => ({ ...prev, reportIds: toggleReportSelection(prev.reportIds, report.id) }))}
                      />
                      <span>{report.displayName}</span>
                    </label>
                  ))}
                </div>
                <div className="admin-form-actions">
                  <button className="login-btn" disabled={busy} onClick={saveAgent}>{agentEditingId ? 'Guardar cambios' : 'Crear agente IA'}</button>
                  {agentEditingId ? <button className="logout-btn" onClick={resetAgentForm}>Cancelar</button> : null}
                </div>
              </>
            ) : null}
          </aside>
        </div>
      </section>
    </main>
  );
}
