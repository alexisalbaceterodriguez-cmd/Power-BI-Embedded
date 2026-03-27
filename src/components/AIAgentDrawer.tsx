'use client';

import { useEffect, useMemo, useState } from 'react';

interface AgentSummary {
  id: string;
  name: string;
  mcpUrl?: string;
  mcpToolName?: string;
  reportIds: string[];
}

interface ChatMessage {
  role: 'assistant' | 'user';
  content: string;
}

interface AIAgentDrawerProps {
  open: boolean;
  reportId: string;
  agents: AgentSummary[];
  onClose: () => void;
}

export default function AIAgentDrawer({ open, reportId, agents, onClose }: AIAgentDrawerProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  useEffect(() => {
    if (!open) return;
    const first = agents[0];
    setSelectedAgentId(first?.id ?? '');
    setMessages([]);
    setInput('');
    setError(null);
  }, [open, reportId, agents]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || !selectedAgentId || sending) return;

    const nextUserMessage: ChatMessage = { role: 'user', content: text };
    const conversation = [...messages, nextUserMessage];

    setMessages(conversation);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const response = await fetch('/api/ai-agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId,
          agentId: selectedAgentId,
          messages: conversation,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'No fue posible consultar el agente IA');
      }

      const assistant = data.message as ChatMessage | undefined;
      if (!assistant || assistant.role !== 'assistant') {
        throw new Error('Respuesta invalida del agente IA');
      }

      setMessages((prev) => [...prev, assistant]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error consultando el agente IA');
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <aside className="ai-drawer" aria-label="Panel de agente IA">
      <div className="ai-drawer-header">
        <div>
          <p className="ai-drawer-eyebrow">Fabric AI Agent</p>
          <h3 className="ai-drawer-title">Chat con datos del informe</h3>
        </div>
        <button className="logout-btn" onClick={onClose}>
          Cerrar
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="ai-drawer-empty">No hay agentes IA disponibles para este informe.</div>
      ) : (
        <>
          <div className="ai-agent-select-wrap">
            <label htmlFor="ai-agent-select" className="form-label">Agente IA</label>
            <select
              id="ai-agent-select"
              className="form-input"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            {selectedAgent?.mcpUrl ? (
              <p className="ai-agent-note">MCP configurado para este agente.</p>
            ) : null}
          </div>

          <div className="ai-messages">
            {messages.length === 0 ? (
              <div className="ai-drawer-empty">Escribe tu primera pregunta sobre el informe actual.</div>
            ) : (
              messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`ai-bubble ${message.role}`}>
                  {message.content}
                </div>
              ))
            )}
          </div>

          {error ? <p className="error-text">{error}</p> : null}

          <div className="ai-composer">
            <textarea
              className="form-input"
              rows={3}
              placeholder="Pregunta al agente IA..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending || !selectedAgentId}
            />
            <button className="login-btn" onClick={sendMessage} disabled={sending || !selectedAgentId || !input.trim()}>
              {sending ? 'Consultando...' : 'Enviar'}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
