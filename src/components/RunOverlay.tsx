'use client';

import { useEffect, useState } from 'react';
import { THINKING_VERBS as VERBS } from './Thinking';

// The autonomous run, visualized. The agent does configure → strategy → sequence from a single
// submit; this just shows the ordered progress so the user can SEE it work without driving it.
const RUN_STEPS = [
  { key: 'persona', label: 'Configuring its persona' },
  { key: 'strategy', label: 'Forming its strategy' },
  { key: 'sequence', label: 'Planning the outreach sequence' },
];

export function RunOverlay({
  runStep,
  error,
  onRetry,
  companyName,
}: {
  runStep: number;
  error: string;
  onRetry: () => void;
  companyName?: string;
}) {
  const [verb, setVerb] = useState(0);
  useEffect(() => {
    if (error) return;
    const id = setInterval(() => setVerb((v) => (v + 1) % VERBS.length), 1300);
    return () => clearInterval(id);
  }, [error]);

  if (error) {
    return (
      <div className="stage stage-run">
        <div className="card">
          <h2>Run failed</h2>
          <p className="err">{error}</p>
          <button onClick={onRetry}>← Back to the form</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stage stage-run">
      <div className="card run-card">
        <p className="run-title">
          The agent is configuring itself{companyName ? ` for ${companyName}` : ''}…
        </p>
        <p className="run-verb">{VERBS[verb]}…</p>
        <ol className="run-steps">
          {RUN_STEPS.map((s, i) => {
            const state = i < runStep ? 'done' : i === runStep ? 'active' : 'pending';
            return (
              <li key={s.key} className={`run-step ${state}`}>
                <span className="dot">{state === 'done' ? '✓' : i + 1}</span>
                <span className="run-label">{s.label}</span>
                {state === 'active' && <span className="spinner" aria-hidden />}
              </li>
            );
          })}
        </ol>
        <p className="section-note" style={{ marginTop: 14 }}>
          One input in — the agent plans the rest on its own. You’ll step through what it decided next.
        </p>
      </div>
    </div>
  );
}
