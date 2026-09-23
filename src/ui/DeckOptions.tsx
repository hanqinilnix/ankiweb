// Daily limits, following Anki's deck options (ts/routes/deck-options/DailyLimits.svelte):
// each limit is set at one of three scopes, and picking a scope clears the narrower ones.
import { useEffect, useState } from 'react';
import type { Collection } from '../model/types';
import { activeLimit, type LimitKindName, type LimitScope } from '../scheduler/limits';
import { loadDeckOptions, saveDeckOptions, type DeckOptions as Data } from '../store/queries';

const SCOPES: { id: LimitScope; label: string }[] = [
  { id: 'preset', label: 'Preset' }, { id: 'deck', label: 'This deck' }, { id: 'today', label: 'Today only' },
];
type Row = { scope: LimitScope; values: Record<LimitScope, number> };

function initialRow(d: Data, kind: LimitKindName): Row {
  const { scope, value } = activeLimit(d.deck, d.cfg, kind, d.today);
  const deckVal = kind === 'new' ? d.deck.normal.newLimit : d.deck.normal.reviewLimit;
  const todayLim = kind === 'new' ? d.deck.normal.newLimitToday : d.deck.normal.reviewLimitToday;
  return {
    scope,
    values: {
      preset: kind === 'new' ? d.cfg.newPerDay : d.cfg.revPerDay,
      deck: deckVal ?? value,
      today: todayLim?.today === d.today ? todayLim.limit : value,
    },
  };
}

export function DeckOptions({ col, deckId, deckName, onExit, onSaved }: {
  col: Collection; deckId: number; deckName: string; onExit: () => void; onSaved: (col: Collection) => void;
}) {
  const [data, setData] = useState<Data | null>();
  const [nw, setNw] = useState<Row>();
  const [rev, setRev] = useState<Row>();
  const [ignoreRev, setIgnoreRev] = useState(col.newCardsIgnoreReviewLimit);
  const [fromTop, setFromTop] = useState(col.applyAllParentLimits);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadDeckOptions(deckId, col, new Date()).then((d) => {
      setData(d ?? null);
      if (d) { setNw(initialRow(d, 'new')); setRev(initialRow(d, 'review')); }
    });
  }, [deckId, col]);

  if (data === undefined) return <div className="center">Loading…</div>;
  if (data === null || !nw || !rev) return <div className="center">Deck not found.</div>;

  const newValue = nw.values[nw.scope], revValue = rev.values[rev.scope];
  const wantReviews = Math.min(9999, newValue * 10);
  const save = async () => {
    setSaving(true);
    const next = await saveDeckOptions(deckId, col, new Date(), {
      new: { scope: nw.scope, value: newValue }, review: { scope: rev.scope, value: revValue },
      newCardsIgnoreReviewLimit: ignoreRev, applyAllParentLimits: fromTop,
    });
    onSaved(next);
  };

  return (
    <div className="page options">
      <header>
        <button onClick={onExit}>‹ Decks</button>
        <span className="title">{deckName.split('::').pop()}</span>
        <button className="primary" disabled={saving} onClick={save}>Save</button>
      </header>
      <div className="body">
        <h2>Daily Limits</h2>
        <LimitField label="New cards/day" row={nw} set={setNw} preset={data.cfg.name} presetDecks={data.presetDeckCount} cap={data.caps.new} />
        <LimitField label="Maximum reviews/day" row={rev} set={setRev} preset={data.cfg.name} presetDecks={data.presetDeckCount} cap={data.caps.review} />
        {wantReviews > revValue && (
          <p className="warn">If adding {newValue} new cards each day, your review limit should be at least {wantReviews}.</p>
        )}
        <h2>Collection</h2>
        <label className="switch"><input type="checkbox" checked={ignoreRev} onChange={(e) => setIgnoreRev(e.target.checked)} /> New cards ignore review limit</label>
        <label className="switch"><input type="checkbox" checked={fromTop} onChange={(e) => setFromTop(e.target.checked)} /> Limits start from top</label>
        <p className="hint">Affects the entire collection.</p>
      </div>
    </div>
  );
}

function LimitField({ label, row, set, preset, presetDecks, cap }: {
  label: string; row: Row; set: (r: Row) => void; preset: string; presetDecks: number; cap?: number;
}) {
  const value = row.values[row.scope];
  return (
    <div className="field">
      <div className="tabs">
        {SCOPES.map((s) => (
          <button key={s.id} className={row.scope === s.id ? 'on' : ''} onClick={() => set({ ...row, scope: s.id })}>{s.label}</button>
        ))}
      </div>
      <label className="row">
        <span>{label}</span>
        <input type="number" min={0} max={9999} value={value}
          onChange={(e) => set({ ...row, values: { ...row.values, [row.scope]: Math.max(0, Number(e.target.value) || 0) } })} />
      </label>
      <p className="hint">
        {row.scope === 'preset' && `Preset "${preset}"${presetDecks > 1 ? `, shared by ${presetDecks} decks` : ''}.`}
        {row.scope === 'deck' && 'This deck only, every day.'}
        {row.scope === 'today' && 'Today only. Reverts at the next day rollover.'}
      </p>
      {cap !== undefined && cap < value && <p className="warn">A parent deck has a limit of {cap} cards, which will override this limit.</p>}
    </div>
  );
}
