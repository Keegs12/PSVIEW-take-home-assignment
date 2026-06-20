'use client';

import { useState } from 'react';
import { ContextForm } from '@/components/ContextForm';
import { RunOverlay } from '@/components/RunOverlay';
import { Stepper } from '@/components/Stepper';
import type { CompanyContext, ConfiguredAgent, SequenceMessage } from '@/lib/types';

type Phase = 'form' | 'running' | 'replay';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJSON(url: string, body: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>('form');
  const [agent, setAgent] = useState<ConfiguredAgent | null>(null);
  const [sequence, setSequence] = useState<SequenceMessage[]>([]);
  const [runStep, setRunStep] = useState(0); // index into the autonomous run's stages
  const [runErr, setRunErr] = useState('');

  // Run-all-then-replay: one submit triggers the whole pipeline; the user watches, then steps through.
  async function start(context: CompanyContext) {
    setPhase('running');
    setRunErr('');
    setRunStep(0);
    setAgent(null);
    setSequence([]);
    try {
      // Stages 1+2: the agent configures itself (persona + strategy) from the context alone.
      const cfg = await postJSON('/api/configure', context);
      setAgent({ context: cfg.context, persona: cfg.persona, strategy: cfg.strategy });
      setRunStep(1);
      await delay(700); // brief beat so persona → strategy reads as an ordered sequence
      setRunStep(2);
      // Stage 3: it plans the full outreach sequence from its own strategy.
      const seq = await postJSON('/api/sequence', {
        context: cfg.context,
        persona: cfg.persona,
        strategy: cfg.strategy,
      });
      setSequence(Array.isArray(seq.messages) ? seq.messages : []);
      setRunStep(3);
      await delay(600);
      setPhase('replay');
    } catch (e) {
      setRunErr(String(e instanceof Error ? e.message : e));
    }
  }

  function reset() {
    setPhase('form');
    setAgent(null);
    setSequence([]);
    setRunStep(0);
    setRunErr('');
  }

  return (
    <main className="wrap">
      <header className="masthead">
        <h1>Autonomous Recruiting Agent</h1>
        <p className="sub">
          Give it a company context + a goal. It configures its own personality, plans a grounded outreach
          sequence, and reasons over candidate replies — you watch the process, you don’t drive it.
        </p>
      </header>

      {phase === 'form' && (
        <div className="stage stage-form">
          <ContextForm onConfigure={start} loading={false} />
        </div>
      )}

      {phase === 'running' && (
        <RunOverlay runStep={runStep} error={runErr} onRetry={reset} companyName={agent?.context.companyName} />
      )}

      {phase === 'replay' && agent && <Stepper agent={agent} sequence={sequence} onRestart={reset} />}
    </main>
  );
}
