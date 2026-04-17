'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface AgentSummary {
  id: string;
  name: string;
  agentType: 'fabric-mcp' | 'foundry-responses';
  responsesEndpoint: string;
  securityMode: 'none' | 'rls-inherit';
  migrationStatus: 'migrated' | 'legacy' | 'manual';
  reportIds: string[];
}

interface ChatMessage {
  role: 'assistant' | 'user';
  content: string;
  timestamp: number;
}

interface AIAgentDrawerProps {
  open: boolean;
  reportId: string;
  agents: AgentSummary[];
  onClose: () => void;
}

type DrawerSize = 'normal' | 'wide' | 'full';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function ThinkingIndicator({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 200);
    return () => clearInterval(interval);
  }, [startTime]);
  const label = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  return (
    <div className="ai-bubble assistant ai-thinking">
      <div className="ai-thinking-dots">
        <span /><span /><span />
      </div>
      <span className="ai-thinking-label">Pensando… {label}</span>
    </div>
  );
}

export default function AIAgentDrawer({ open, reportId, agents, onClose }: AIAgentDrawerProps) {
  const [historyMap, setHistoryMap] = useState<Record<string, ChatMessage[]>>({});
  const [input, setInput] = useState('');
  const [drawerSize, setDrawerSize] = useState<DrawerSize>('normal');
  const [sending, setSending] = useState(false);
  const [sendStartTime, setSendStartTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId]
  );

  const agentKey = selectedAgent ? `${reportId}::${selectedAgent.id}` : '';
  const messages = agentKey ? (historyMap[agentKey] ?? []) : [];

  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      if (!agentKey) return;
      setHistoryMap((prev) => ({
        ...prev,
        [agentKey]: typeof updater === 'function' ? updater(prev[agentKey] ?? []) : updater,
      }));
    },
    [agentKey]
  );

  useEffect(() => {
    if (!open) return;
    setInput('');
    setError(null);
    setSelectedAgentId(agents[0]?.id ?? null);
  }, [open, reportId, agents]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    if (open && !sending) textareaRef.current?.focus();
  }, [open, sending, selectedAgentId]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, open, selectedAgentId, adjustTextareaHeight]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || !selectedAgent || sending) return;

    const nextUserMessage: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, nextUserMessage]);
    setInput('');
    setSending(true);
    setSendStartTime(Date.now());
    setError(null);

    try {
      const conversation = [...messages, nextUserMessage];
      const response = await fetch('/api/ai-agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId,
          agentId: selectedAgent.id,
          messages: conversation,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'No fue posible consultar el agente');
      }

      const assistant = data.message as { role: string; content: string } | undefined;
      if (!assistant || assistant.role !== 'assistant') {
        throw new Error('Respuesta invalida del agente');
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: assistant.content, timestamp: Date.now() }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error consultando el agente');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearHistory() {
    setMessages([]);
    setError(null);
  }

  function cycleDrawerSize() {
    setDrawerSize((prev) => {
      if (prev === 'normal') return 'wide';
      if (prev === 'wide') return 'full';
      return 'normal';
    });
  }

  const drawerSizeClass = drawerSize === 'wide' ? 'ai-drawer--wide' : drawerSize === 'full' ? 'ai-drawer--full' : '';
  const resizeTitle = drawerSize === 'normal' ? 'Ampliar panel' : drawerSize === 'wide' ? 'Expandir a casi pantalla completa' : 'Reducir panel';

  if (!open) return null;

  return (
    <aside className={`ai-drawer ${drawerSizeClass}`} aria-label="Panel de agente">
      {/* Header */}
      <div className="ai-drawer-header">
        <div className="ai-drawer-header-info">
          <div className="ai-drawer-icon-wrap">
            <img src="/icon-microsoft-foundry.png" alt="" className="ai-drawer-icon" />
          </div>
          <div>
            <p className="ai-drawer-eyebrow">Agente IA</p>
            <h3 className="ai-drawer-title">{selectedAgent?.name ?? 'Asistente'}</h3>
          </div>
        </div>
        <div className="ai-drawer-actions">
          <button
            className="ai-btn-icon"
            onClick={cycleDrawerSize}
            title={resizeTitle}
            aria-label={resizeTitle}
          >
            {drawerSize === 'normal' && (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
                <path d="M2.5 6.5v-3h3M13.5 9.5v3h-3M10.5 3.5h3v3M5.5 12.5h-3v-3" />
              </svg>
            )}
            {drawerSize === 'wide' && (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
                <path d="M2 2h4M2 2v4M14 2h-4M14 2v4M2 14h4M2 14v-4M14 14h-4M14 14v-4" />
              </svg>
            )}
            {drawerSize === 'full' && (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
                <path d="M6.5 2.5H3.5v3M9.5 13.5h3v-3M12.5 5.5l-3-3M3.5 10.5l3 3" />
              </svg>
            )}
          </button>
          {messages.length > 0 && (
            <button className="ai-btn-icon" onClick={clearHistory} title="Nueva conversación" aria-label="Nueva conversación">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
                <path d="M13.5 3H8.5M13.5 3v5M13.5 3L7.5 9M6.5 3h-3a1 1 0 00-1 1v8.5a1 1 0 001 1H12a1 1 0 001-1V9" />
              </svg>
            </button>
          )}
          <button className="ai-btn-icon" onClick={onClose} title="Cerrar panel" aria-label="Cerrar panel">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Agent picker */}
      {agents.length > 1 && (
        <div className="ai-drawer-agent-picker">
          <select
            className="ai-select"
            value={selectedAgent?.id ?? ''}
            onChange={(e) => {
              setSelectedAgentId(e.target.value);
              setError(null);
            }}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="ai-empty-state">
          <div className="ai-empty-icon">🤖</div>
          <p>No hay agentes disponibles para este informe.</p>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="ai-messages">
            {messages.length === 0 && !sending ? (
              <div className="ai-welcome">
                <div className="ai-welcome-icon">💬</div>
                <p className="ai-welcome-title">¿En qué puedo ayudarte?</p>
                <p className="ai-welcome-sub">Pregunta sobre los datos de este informe</p>
              </div>
            ) : (
              messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`ai-bubble ${message.role}`}>
                  <div className="ai-bubble-content">{message.content}</div>
                  <span className="ai-bubble-time">{formatTime(message.timestamp)}</span>
                </div>
              ))
            )}
            {sending && <ThinkingIndicator startTime={sendStartTime} />}
            <div ref={messagesEndRef} />
          </div>

          {/* Error */}
          {error && (
            <div className="ai-error">
              <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M8 4.5v4M8 10.5v.5"/></svg>
              <span>{error}</span>
            </div>
          )}

          {/* Composer */}
          <div className="ai-composer">
            <div className="ai-composer-input-wrap">
              <textarea
                ref={textareaRef}
                className="ai-composer-input"
                rows={1}
                placeholder="Escribe tu pregunta…"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  adjustTextareaHeight();
                }}
                onKeyDown={handleKeyDown}
                disabled={sending || !selectedAgent}
              />
              <button
                className="ai-send-btn"
                onClick={sendMessage}
                disabled={sending || !selectedAgent || !input.trim()}
                aria-label="Enviar mensaje"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
                  <path d="M1.724 1.053a.5.5 0 01.555-.033l12 7a.5.5 0 010 .86l-12 7A.5.5 0 011.5 15.5V9.307l6.735-1.307L1.5 6.693V.5a.5.5 0 01.224-.447z"/>
                </svg>
              </button>
            </div>
            <p className="ai-composer-hint">Enter para enviar · Shift+Enter para salto de línea</p>
          </div>
        </>
      )}
    </aside>
  );
}
