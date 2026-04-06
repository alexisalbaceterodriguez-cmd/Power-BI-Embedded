'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface AgentSummary {
  id: string;
  name: string;
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
  scopeAttributes?: Record<string, string[]>;
  onClose: () => void;
}

export default function AIAgentDrawer({ open, reportId, agents, scopeAttributes, onClose }: AIAgentDrawerProps) {
  const storageKeyPrefix = 'ai-chat-memory';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);

  const selectedAgent = useMemo(() => agents[0] ?? null, [agents]);
  const conversationStorageKey = useMemo(() => {
    if (!selectedAgent) return null;
    return `${storageKeyPrefix}:${reportId}:${selectedAgent.id}`;
  }, [reportId, selectedAgent]);

  useEffect(() => {
    if (!open || !conversationStorageKey) return;

    try {
      const serializedConversation = window.sessionStorage.getItem(conversationStorageKey);
      if (!serializedConversation) {
        setMessages([]);
        return;
      }

      const parsedConversation = JSON.parse(serializedConversation) as Array<Partial<ChatMessage>>;
      const nextMessages = parsedConversation
        .filter((message) => (message.role === 'assistant' || message.role === 'user') && typeof message.content === 'string')
        .map((message) => ({
          role: message.role as ChatMessage['role'],
          content: message.content as string,
          timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
        }));

      setMessages(nextMessages);
    } catch {
      setMessages([]);
    }
  }, [open, conversationStorageKey]);

  useEffect(() => {
    if (!conversationStorageKey) return;
    window.sessionStorage.setItem(conversationStorageKey, JSON.stringify(messages));
  }, [messages, conversationStorageKey]);

  useEffect(() => {
    if (!open) return;
    setInput('');
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!sending || !thinkingStartedAt) {
      setThinkingSeconds(0);
      return;
    }

    setThinkingSeconds(Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000)));
    const timer = window.setInterval(() => {
      setThinkingSeconds(Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000)));
    }, 250);

    return () => window.clearInterval(timer);
  }, [sending, thinkingStartedAt]);

  useEffect(() => {
    if (!open) return;
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending, open]);

  function toApiMessages(nextMessages: ChatMessage[]): Array<{ role: 'assistant' | 'user'; content: string }> {
    return nextMessages.map((message) => ({ role: message.role, content: message.content }));
  }

  function clearConversation() {
    setMessages([]);
    setError(null);
    if (conversationStorageKey) {
      window.sessionStorage.removeItem(conversationStorageKey);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || !selectedAgent || sending) return;

    const nextUserMessage: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    const conversation = [...messages, nextUserMessage];

    setMessages(conversation);
    setInput('');
    setSending(true);
    setThinkingStartedAt(Date.now());
    setError(null);

    try {
      const response = await fetch('/api/ai-agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId,
          agentId: selectedAgent.id,
          scopeAttributes,
          messages: toApiMessages(conversation),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'No fue posible consultar el agente');
      }

      const assistant = data.message as { role?: 'assistant' | 'user'; content?: string } | undefined;
      if (!assistant || assistant.role !== 'assistant' || typeof assistant.content !== 'string') {
        throw new Error('Respuesta invalida del agente');
      }
      const assistantContent: string = assistant.content;

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error consultando el agente');
    } finally {
      setSending(false);
      setThinkingStartedAt(null);
    }
  }

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  if (!open) return null;

  return (
    <aside className="ai-drawer" aria-label="Panel de agente">
      <div className="ai-drawer-header">
        <div>
          <p className="ai-drawer-eyebrow">Agente</p>
          <h3 className="ai-drawer-title">Asistente del informe</h3>
          {selectedAgent ? (
            <p className="ai-agent-subtitle">
              {selectedAgent.name}
              <span className={`ai-agent-status ${selectedAgent.securityMode === 'rls-inherit' ? 'is-secure' : 'is-open'}`}>
                {selectedAgent.securityMode === 'rls-inherit' ? 'Seguro' : 'Abierto'}
              </span>
            </p>
          ) : null}
        </div>
        <div className="ai-drawer-actions">
          <button className="ai-minor-btn" onClick={clearConversation} disabled={sending || messages.length === 0}>
            Limpiar
          </button>
          <button className="logout-btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="ai-drawer-empty">No hay agentes disponibles para este informe.</div>
      ) : (
        <>
          <div className="ai-messages">
            {messages.length === 0 ? (
              <div className="ai-drawer-empty">Escribe tu primera pregunta sobre el informe actual.</div>
            ) : (
              messages.map((message, index) => (
                <div key={`${message.role}-${index}-${message.timestamp}`} className={`ai-message-row ${message.role}`}>
                  <div className={`ai-bubble ${message.role}`}>
                    {message.content}
                  </div>
                  <span className="ai-message-time">
                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            )}

            {sending ? (
              <div className="ai-message-row assistant thinking">
                <div className="ai-bubble assistant ai-thinking-bubble" role="status" aria-live="polite">
                  <span className="ai-thinking-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>Pensando... {thinkingSeconds}s</span>
                </div>
              </div>
            ) : null}

            <div ref={endOfMessagesRef} />
          </div>

          {error ? <p className="error-text">{error}</p> : null}

          <div className="ai-composer">
            <textarea
              className="form-input"
              rows={3}
              placeholder="Pregunta al agente..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              disabled={sending || !selectedAgent}
            />
            <p className="ai-composer-hint">Enter para enviar. Shift + Enter para nueva linea.</p>
            <button className="login-btn" onClick={sendMessage} disabled={sending || !selectedAgent || !input.trim()}>
              {sending ? 'Consultando...' : 'Enviar'}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
