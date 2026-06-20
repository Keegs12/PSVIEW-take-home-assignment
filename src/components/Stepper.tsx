'use client';

import { useState } from 'react';
import type { ConfiguredAgent, CompanyContext, Persona, OutreachStrategy, SequenceMessage } from '@/lib/types';
import { ConversationStep } from './ConversationStep';

// Replay of the autonomous run: each decision the agent made is its own full window. Clicking
// Back/Next (or a rail item) only navigates — it never changes what the agent decided.
const WINDOWS = [
  { key: 'persona', title: 'Persona' },
  { key: 'strategy', title: 'Strategy' },
  { key: 'sequence', title: 'Sequence' },
  { key: 'test', title: 'Test' },
];

export function Stepper({
  agent,
  sequence,
  onRestart,
}: {
  agent: ConfiguredAgent;
  sequence: SequenceMessage[];
  onRestart: () => void;
}) {
  const [i, setI] = useState(0);
  const { context, persona, strategy } = agent;
  const last = WINDOWS.length - 1;

  return (
    <div className="stage stage-step">
      <nav className="rail">
        {WINDOWS.map((w, idx) => {
          const state = idx < i ? 'done' : idx === i ? 'active' : 'pending';
          return (
            <button
              key={w.key}
              className={`rail-step ${state}`}
              onClick={() => setI(idx)}
              aria-label={`Step ${idx + 1}: ${w.title}`}
            >
              <span className="rail-dot">{idx < i ? '✓' : idx + 1}</span>
              <span className="rail-title">{w.title}</span>
            </button>
          );
        })}
      </nav>

      <div className="window" key={i}>
        {i === 0 && <PersonaWindow persona={persona} context={context} />}
        {i === 1 && <StrategyWindow strategy={strategy} />}
        {i === 2 && <SequenceWindow sequence={sequence} />}
        {i === 3 && <ConversationStep agent={agent} sequence={sequence} />}
      </div>

      <div className="nav">
        <button className="secondary" onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}>
          ← Back
        </button>
        <span className="nav-count">{i + 1} / {WINDOWS.length}</span>
        {i < last ? (
          <button onClick={() => setI((v) => Math.min(last, v + 1))}>Next →</button>
        ) : (
          <button className="secondary" onClick={onRestart}>↺ New company</button>
        )}
      </div>
    </div>
  );
}

function PersonaWindow({ persona, context }: { persona: Persona; context: CompanyContext }) {
  return (
    <div className="card">
      <h2>The agent configured itself</h2>
      <p className="persona-name">{persona.name}</p>
      <div>
        {persona.voiceTraits.map((t) => (
          <span className="pill" key={t}>{t}</span>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 10 }}><b>Signature move:</b> {persona.signatureMove}</p>
      <p className="muted"><b className="tag">Always:</b> {persona.doRules.join(' · ')}</p>
      <p className="muted"><b className="tag">Never:</b> {persona.dontRules.join(' · ')}</p>
      <hr />
      <p className="muted"><b>Why this persona — derived from {context.companyName}’s context:</b></p>
      <ul className="derivation">
        {persona.groundedIn?.map((g, i) => <li key={i}>{g}</li>)}
      </ul>
      <p className="section-note">
        Each trait traces to a specific context fact — change the context and the persona measurably changes with it.
      </p>
    </div>
  );
}

function StrategyWindow({ strategy }: { strategy: OutreachStrategy }) {
  return (
    <div className="card">
      <h2>Its strategy</h2>
      <p className="muted"><b>Angle:</b> {strategy.candidateAngle}</p>
      <p className="muted"><b>Hooks:</b> {strategy.hooks.join(' · ')}</p>
      <p className="muted"><b>Plan:</b> {strategy.sequencePlan.join(' → ')}</p>
      <p className="muted"><b>Win looks like:</b> {strategy.successSignal}</p>
    </div>
  );
}

function SequenceWindow({ sequence }: { sequence: SequenceMessage[] }) {
  return (
    <div className="card">
      <h2>Planned outreach sequence</h2>
      <p className="section-note">
        The agent wrote the whole sequence from its own plan — and audited each message for grounding + persona,
        the same checks the live reply loop runs.
      </p>
      {sequence.length === 0 && <p className="muted">No sequence was returned. Try reconfiguring.</p>}
      {sequence.map((m) => (
        <div className="msg" key={m.step}>
          <div className="meta">
            Step {m.step} · <span className="tag">{m.intent}</span> · {m.channel}
            {m.subject ? ` · “${m.subject}”` : ''}
          </div>
          <div className="body">{m.body}</div>
          <div className="grounded">grounded in: {m.groundedIn.join(' · ')}</div>
          {m.verification && (
            <div className="grounded">
              <span className={m.verification.grounded ? 'ok' : 'bad'}>
                grounding {m.verification.grounded ? '✓' : '✗'}
              </span>
              {' · '}
              <span className={m.verification.personaPass ? 'ok' : 'bad'}>
                persona {m.verification.personaPass ? '✓' : '✗'}
              </span>
              {!m.verification.grounded && m.verification.unsupportedClaims.length > 0 && (
                <div className="viol">unsupported: {m.verification.unsupportedClaims.join(' · ')}</div>
              )}
              {!m.verification.personaPass && m.verification.personaViolations.length > 0 && (
                <div className="viol">persona: {m.verification.personaViolations.join(' · ')}</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
