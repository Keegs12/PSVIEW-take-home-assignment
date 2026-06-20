'use client';

import { useEffect, useState } from 'react';

// Shared "reasoning" verbs — the same cycling string is used by the autonomous run overlay and
// the in-chat typing indicator, so the agent's "thinking" reads consistently across the app.
export const THINKING_VERBS = ['Reading the context', 'Thinking', 'Reasoning', 'Deciding', 'Composing'];

export function Thinking({
  verbs = THINKING_VERBS,
  intervalMs = 1300,
}: {
  verbs?: string[];
  intervalMs?: number;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % verbs.length), intervalMs);
    return () => clearInterval(id);
  }, [verbs, intervalMs]);

  return (
    <span className="thinking">
      {verbs[i]}
      <span className="ellipsis" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
