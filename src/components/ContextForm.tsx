'use client';

import { useState } from 'react';
import type { CompanyContext } from '@/lib/types';

const SAMPLE: CompanyContext = {
  companyName: 'PSVIEW',
  whatTheyDo:
    'We build autonomous AI agents that engage candidates on behalf of a company — agents with a personality that reason and act on their own, not prompt wrappers.',
  culture: 'Small, high-agency, taste-driven. We value autonomy, craft, and shipping things that surprise people.',
  hiringProfile: 'A founding engineer who can build a deployed product end-to-end and has real opinions about where the intelligence lives in an agent.',
  tone: 'Direct, warm, a little playful. Confident without being salesy.',
  outreachGoal: 'Get a strong founding-engineer candidate to take a 20-minute intro call this week.',
};

// Start empty — the SAMPLE above is shown as placeholders only, to give direction without
// pre-committing the user to the PSVIEW example.
const EMPTY: CompanyContext = {
  companyName: '',
  whatTheyDo: '',
  culture: '',
  hiringProfile: '',
  tone: '',
  outreachGoal: '',
};

export function ContextForm({
  onConfigure,
  loading,
}: {
  onConfigure: (c: CompanyContext) => void;
  loading: boolean;
}) {
  const [c, setC] = useState<CompanyContext>(EMPTY);
  const [url, setUrl] = useState('');
  const [researching, setResearching] = useState(false);
  const [researchErr, setResearchErr] = useState('');
  const [lang, setLang] = useState('');        // language the fields are currently in
  const [nativeLang, setNativeLang] = useState(''); // the site's own language (auto-detected)
  const set = (k: keyof CompanyContext) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setC((prev) => ({ ...prev, [k]: e.target.value }));

  // targetLanguage undefined => auto-detect & localize to the page; a string => force that language.
  async function research(targetLanguage?: string) {
    if (!url.trim()) return;
    setResearching(true);
    setResearchErr('');
    try {
      const r = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), language: targetLanguage }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'failed');
      setC(data.context); // pre-fill every field; the user can edit before configuring
      setLang(data.language || '');
      if (!targetLanguage) setNativeLang(data.language || ''); // remember the site's own language
    } catch (e) {
      setResearchErr(String(e instanceof Error ? e.message : e));
    } finally {
      setResearching(false);
    }
  }

  const isEnglish = (l: string) => l.trim().toLowerCase().startsWith('english');
  // Only worth a toggle when the site isn't English (otherwise there's nothing to switch to).
  const canToggleLang = !!nativeLang && !isEnglish(nativeLang);
  const toggleTarget = isEnglish(lang) ? nativeLang : 'English';

  // --- Optional: shape the hiring profile from example candidate profiles ---
  const [links, setLinks] = useState<string[]>(['']);
  const [shaping, setShaping] = useState(false);
  const [shapeErr, setShapeErr] = useState('');
  const [shapeNote, setShapeNote] = useState('');
  const updateLink = (i: number, v: string) => setLinks((ls) => ls.map((l, j) => (j === i ? v : l)));
  const addLink = () => setLinks((ls) => [...ls, '']);
  const removeLink = (i: number) => setLinks((ls) => (ls.length <= 1 ? [''] : ls.filter((_, j) => j !== i)));

  async function shapeProfile() {
    const entries = links.map((l) => l.trim()).filter(Boolean);
    if (!entries.length) return;
    setShaping(true);
    setShapeErr('');
    setShapeNote('');
    try {
      const r = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries, context: { companyName: c.companyName, whatTheyDo: c.whatTheyDo } }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'failed');
      setC((prev) => ({ ...prev, hiringProfile: data.hiringProfile }));
      const skipped = data.skipped?.length ? ` (${data.skipped.length} couldn’t be read — paste their text instead)` : '';
      setShapeNote(`Synthesized from ${data.used} profile${data.used === 1 ? '' : 's'}${skipped}.`);
    } catch (e) {
      setShapeErr(String(e instanceof Error ? e.message : e));
    } finally {
      setShaping(false);
    }
  }

  return (
    <div className="card form-card">
      <div className="card-head">
        <h2>1 · Company context</h2>
        <p className="section-note">
          Everything the agent does comes from this. It will configure its own personality and plan from it.
        </p>
        <button type="button" className="secondary example-btn" onClick={() => setC(SAMPLE)}>
          Use the PSVIEW example →
        </button>
      </div>

      <div className="card-scroll">
      <div className="research">
        <label>Auto-fill from a company URL (optional)</label>
        <div className="research-row">
          <input
            type="url"
            placeholder="https://company.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={researching}
          />
          <button type="button" className="secondary" onClick={() => research()} disabled={researching || !url.trim()}>
            {researching ? 'Researching…' : 'Research & fill →'}
          </button>
        </div>
        <p className="section-note" style={{ margin: '6px 0 0' }}>
          The agent reads the site and fills the fields below. Edit anything before configuring.
        </p>
        {lang && (
          <p className="section-note" style={{ margin: '6px 0 0' }}>
            Fields written in <b style={{ color: 'var(--text)' }}>{lang}</b>
            {canToggleLang && isEnglish(lang) ? ' (localizes to the company’s language by default).' : '.'}
            {canToggleLang && (
              <>
                {' '}
                <button type="button" className="linkbtn" onClick={() => research(toggleTarget)} disabled={researching}>
                  Rewrite in {toggleTarget}
                </button>
              </>
            )}
          </p>
        )}
        {researchErr && <p className="err">Couldn’t research that URL: {researchErr}</p>}
      </div>

      <label>Company name</label>
      <input value={c.companyName} onChange={set('companyName')} placeholder={SAMPLE.companyName} />

      <label>What they do</label>
      <textarea value={c.whatTheyDo} onChange={set('whatTheyDo')} placeholder={SAMPLE.whatTheyDo} />

      <label>Culture</label>
      <textarea value={c.culture} onChange={set('culture')} placeholder={SAMPLE.culture} />

      <label>Who they hire (target profile)</label>
      <textarea value={c.hiringProfile} onChange={set('hiringProfile')} placeholder={SAMPLE.hiringProfile} />

      <div className="examples">
        <label>Shape it from example profiles (optional)</label>
        {links.map((link, i) => (
          <div className="link-row" key={i}>
            <input
              placeholder="Profile URL — or paste profile text"
              value={link}
              onChange={(e) => updateLink(i, e.target.value)}
              disabled={shaping}
            />
            <button type="button" className="iconbtn" onClick={() => removeLink(i)} disabled={shaping} aria-label="Remove">
              ×
            </button>
          </div>
        ))}
        <div className="examples-actions">
          <button type="button" className="linkbtn" onClick={addLink} disabled={shaping}>+ Add another</button>
          <button
            type="button"
            className="secondary"
            onClick={shapeProfile}
            disabled={shaping || !links.some((l) => l.trim())}
          >
            {shaping ? 'Synthesizing…' : 'Synthesize profile →'}
          </button>
        </div>
        <p className="section-note" style={{ margin: '6px 0 0' }}>
          GitHub & personal sites work directly; for LinkedIn, paste the profile text. The agent distills the common
          archetype into the field above.
        </p>
        {shapeNote && <p className="section-note" style={{ margin: '6px 0 0', color: 'var(--good)' }}>{shapeNote}</p>}
        {shapeErr && <p className="err">{shapeErr}</p>}
      </div>

      <label>Desired tone</label>
      <input value={c.tone} onChange={set('tone')} placeholder={SAMPLE.tone} />

      <label>Outreach goal (the intent you give the agent)</label>
      <input value={c.outreachGoal} onChange={set('outreachGoal')} placeholder={SAMPLE.outreachGoal} />
      </div>

      <div className="card-foot">
        <button onClick={() => onConfigure(c)} disabled={loading || !c.companyName.trim() || !c.outreachGoal.trim()}>
          {loading ? 'Configuring agent…' : 'Configure agent →'}
        </button>
      </div>
    </div>
  );
}
