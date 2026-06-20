'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ConfiguredAgent,
  SequenceMessage,
  ConversationTurn,
  AgentDecision,
} from '@/lib/types';
import { Thinking } from './Thinking';

// The one genuinely interactive stage — and it's sanctioned by the brief ("simulate a candidate
// reply by hand to watch how it reacts"). The user plays the candidate; the agent still reasons
// autonomously (classify → decide → write). Reaction, not driving.
export function ConversationStep({
  agent,
  sequence,
}: {
  agent: ConfiguredAgent;
  sequence: SequenceMessage[];
}) {
  const { context, persona, strategy } = agent;
  const [history, setHistory] = useState<ConversationTurn[]>(
    sequence[0] ? [{ role: 'agent', text: sequence[0].body }] : [],
  );
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as the conversation grows / while the agent is reasoning.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, loading]);

  async function send() {
    if (!draft.trim()) return;
    const candidateMessage = draft.trim();
    setHistory((h) => [...h, { role: 'candidate', text: candidateMessage }]);
    setDraft('');
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send the history BEFORE this candidate turn; the server renders it + candidateMessage.
        body: JSON.stringify({ context, persona, strategy, history, candidateMessage }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'failed');
      setHistory((h) => [...h, { role: 'agent', text: data.message, decision: data.decision as AgentDecision }]);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card chat">
      <div className="card-head">
        <h2>Test it — simulate a candidate reply</h2>
        <p className="section-note">
          Nothing is sent for real. You play the candidate; watch the agent classify → decide → respond.
          You’re reacting, not driving.
        </p>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {history.map((t, i) => (
          <div key={i}>
            {t.role === 'agent' && t.decision && <ReasoningTrace d={t.decision} />}
            <div className={`turn ${t.role}`}>
              <div className="bubble">{t.text}</div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="turn agent">
            <div className="bubble thinking-bubble">
              <Thinking />
            </div>
          </div>
        )}
      </div>

      <div className="card-foot">
        <label>Candidate reply</label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Sounds interesting but I'm pretty happy where I am — what's different about you?"
        />
        <button onClick={send} disabled={loading}>
          {loading ? 'Agent reasoning…' : 'Send reply →'}
        </button>
        {err && <p className="err">Error: {err}</p>}
      </div>
    </div>
  );
}

// The audited decision, rendered as a trace a reviewer can read: the classification, the
// deterministic STATE transition, the POLICY rule that fired, the ALLOWED actions (with the
// model's constrained pick highlighted), and the output VERIFICATION. This is the "where the
// intelligence is" — code-level decisions, not the model narrating itself.
function ReasoningTrace({ d }: { d: AgentDecision }) {
  const { classification: c, policy: p, verification: v } = d;
  const { stage: before } = p.stateBefore;
  const { stage: after } = p.stateAfter;
  const topSignal = c.signals[0];

  return (
    <div className="trace">
      <div className="row">
        <span className="k">read</span> {c.intent}{' '}
        <span className="conf">({Math.round(c.confidence * 100)}%)</span>
        {topSignal && <span className="muted"> · “{topSignal}”</span>}
      </div>

      <div className="row">
        <span className="k">state</span>{' '}
        {before === after ? before : <>{before} → <b>{after}</b></>}
        <span className="muted">
          {'   '}asks {p.stateAfter.askCount} · objections {p.stateAfter.openObjections.length} · goal{' '}
          {p.stateAfter.goalMet ? '✓' : '✗'}
        </span>
      </div>

      <div className="row">
        <span className="k">policy</span> <span className="rule">{p.ruleFired}</span>
      </div>

      <div className="row">
        <span className="k">action</span>{' '}
        {p.allowed.map((a) => (
          <span key={a} className={`chip${a === d.chosenActionType ? ' chosen' : ''}`}>
            {a.toLowerCase().replace(/_/g, ' ')}{a === d.chosenActionType ? ' ✓' : ''}
          </span>
        ))}
      </div>

      <div className="row"><span className="k">why</span> {d.rationale}</div>

      {v && (
        <div className="row">
          <span className="k">verify</span>{' '}
          <span className={v.grounded ? 'ok' : 'bad'}>grounding {v.grounded ? '✓' : '✗'}</span>
          <span className="muted"> · </span>
          <span className={v.personaPass ? 'ok' : 'bad'}>persona {v.personaPass ? '✓' : '✗'}</span>
          {v.revised && <span className="tag"> · revised ↻</span>}
          {!v.grounded && v.unsupportedClaims.length > 0 && (
            <div className="viol">unsupported: {v.unsupportedClaims.join(' · ')}</div>
          )}
          {!v.personaPass && v.personaViolations.length > 0 && (
            <div className="viol">persona: {v.personaViolations.join(' · ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
