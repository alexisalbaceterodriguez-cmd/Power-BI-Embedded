'use client';

import type { AgentRow, AgentType, ClientRow, ReportRow } from './types';
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

const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  'fabric-mcp': 'Fabric Data Agent (MCP)',
  'foundry-responses': 'Azure AI Foundry (Responses API)',
};

export default function AgentManager({ agents, reports, clients, clientFilter, query, busy, onSave, onDelete }: AgentManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    id: '',
    name: '',
    agentType: 'fabric-mcp' as AgentType,
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
      rows = rows.filter((r) => [r.id, r.name, r.responsesEndpoint, r.foundryProject ?? '', r.foundryAgentName ?? '', r.clientId, r.agentType].join(' ').toLowerCase().includes(term));
    }
    return rows;
  }, [agents, clientFilter, query]);

  const sortedReports = useMemo(
    () => [...reports].filter((r) => r.clientId === form.clientId).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [reports, form.clientId]
  );

  function resetForm() {
    setEditingId(null);
    setForm({ id: '', name: '', agentType: 'fabric-mcp', clientId: clients[0]?.id ?? 'cliente-1', responsesEndpoint: '', activityEndpoint: '', foundryProject: '', foundryAgentName: '', foundryAgentVersion: '', securityMode: 'none', migrationStatus: 'manual', reportIds: [], isActive: true });
  }

  function beginEdit(row: AgentRow) {
    setEditingId(row.id);
    setForm({
      id: row.id,
      name: row.name,
      agentType: row.agentType,
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

  const isFabric = form.agentType === 'fabric-mcp';
  const endpointLabel = isFabric ? 'MCP Endpoint (Fabric)' : 'Responses Endpoint (Foundry)';
  const endpointPlaceholder = isFabric
    ? 'https://api.fabric.microsoft.com/v1/mcp/workspaces/.../dataagents/.../agent'
    : 'https://....services.ai.azure.com/.../protocols/openai/responses';

  return (
    <>
      <section className="admin-list-card">
        <table className="admin-table">
          <thead>
            <tr><th>Agente</th><th>Tipo</th><th>Cliente</th><th>Reportes</th><th>Seguridad</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td><div className="admin-strong">{row.name}</div><div className="admin-muted">{row.id}</div></td>
                <td><span className={`admin-pill agent-type ${row.agentType}`}>{row.agentType === 'fabric-mcp' ? 'Fabric MCP' : 'Foundry API'}</span></td>
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

        {/* Agent type selector */}
        <div className="agent-type-selector">
          {(Object.entries(AGENT_TYPE_LABELS) as [AgentType, string][]).map(([type, label]) => (
            <button
              key={type}
              type="button"
              className={`agent-type-btn ${form.agentType === type ? 'active' : ''}`}
              onClick={() => setForm((p) => ({ ...p, agentType: type }))}
            >
              <span className="agent-type-icon">{type === 'fabric-mcp' ? '🔷' : '🟠'}</span>
              {label}
            </button>
          ))}
        </div>

        <div className="admin-form-grid">
          <div className="form-field">
            <label className="form-label">Nombre del agente</label>
            <input className="form-input" placeholder="Mi agente de datos" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="form-field">
            <label className="form-label">Cliente</label>
            <select className="form-input" value={form.clientId} onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value, reportIds: [] }))}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </select>
          </div>
          <div className="form-field full-width">
            <label className="form-label">{endpointLabel}</label>
            <input className="form-input" placeholder={endpointPlaceholder} value={form.responsesEndpoint} onChange={(e) => setForm((p) => ({ ...p, responsesEndpoint: e.target.value }))} />
          </div>

          {!isFabric && (
            <>
              <div className="form-field">
                <label className="form-label">Activity endpoint <span className="form-hint">(opcional)</span></label>
                <input className="form-input" placeholder="https://..." value={form.activityEndpoint} onChange={(e) => setForm((p) => ({ ...p, activityEndpoint: e.target.value }))} />
              </div>
              <div className="form-field">
                <label className="form-label">Foundry project</label>
                <input className="form-input" placeholder="my-project" value={form.foundryProject} onChange={(e) => setForm((p) => ({ ...p, foundryProject: e.target.value }))} />
              </div>
              <div className="form-field">
                <label className="form-label">Foundry agent name</label>
                <input className="form-input" placeholder="agent-name" value={form.foundryAgentName} onChange={(e) => setForm((p) => ({ ...p, foundryAgentName: e.target.value }))} />
              </div>
              <div className="form-field">
                <label className="form-label">Foundry agent version <span className="form-hint">(opcional)</span></label>
                <input className="form-input" placeholder="v1.0" value={form.foundryAgentVersion} onChange={(e) => setForm((p) => ({ ...p, foundryAgentVersion: e.target.value }))} />
              </div>
            </>
          )}

          <div className="form-field">
            <label className="form-label">Modo de seguridad</label>
            <select className="form-input" value={form.securityMode} onChange={(e) => setForm((p) => ({ ...p, securityMode: e.target.value as 'none' | 'rls-inherit' }))}>
              <option value="none">Sin seguridad RLS</option>
              <option value="rls-inherit">Heredar RLS del usuario</option>
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">Estado de migracion</label>
            <select className="form-input" value={form.migrationStatus} onChange={(e) => setForm((p) => ({ ...p, migrationStatus: e.target.value as 'migrated' | 'legacy' | 'manual' }))}>
              <option value="manual">Manual</option>
              <option value="migrated">Migrado</option>
              <option value="legacy">Legacy</option>
            </select>
          </div>
          <div className="form-field">
            <label className="admin-checkbox-inline">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} />
              Agente activo
            </label>
          </div>
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
