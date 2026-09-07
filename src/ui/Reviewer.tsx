import { useCallback, useEffect, useRef, useState } from 'react';
import { Queue, Rating, type Collection } from '../model/types';
import { buildSides, srcdoc, type Sides } from '../render/card';
import { pick } from '../scheduler';
import { answer, nextCard, setQueue, type Next } from '../store/queries';

const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export function Reviewer({ col, deckId, deckName, onExit }: { col: Collection; deckId: number; deckName: string; onExit: () => void }) {
  const [cur, setCur] = useState<Next | null>();
  const [sides, setSides] = useState<Sides>();
  const [showAnswer, setShowAnswer] = useState(false);
  const shown = useRef(Date.now());

  const load = useCallback(async () => {
    const n = await nextCard(deckId, col, new Date());
    setCur(n ?? null); setShowAnswer(false);
    setSides(n ? await buildSides(n) : undefined);
    shown.current = Date.now();
  }, [deckId, col]);
  useEffect(() => { load(); }, [load]);

  const rate = async (r: Rating) => { if (cur) { await answer(cur, r, col, new Date(), Date.now() - shown.current); await load(); } };
  const bury = async (q: Queue) => { if (cur) { await setQueue(cur.card.id, q); await load(); } };

  useEffect(() => {
    const key = (k: string) => {
      if (k === ' ' || k === 'Enter') showAnswer ? rate(Rating.Good) : setShowAnswer(true);
      else if (showAnswer && ['1', '2', '3', '4'].includes(k)) rate(Number(k) as Rating);
      else if (k === 'Escape') onExit();
    };
    const kd = (e: KeyboardEvent) => { if (e.key === ' ') e.preventDefault(); key(e.key); };
    const msg = (e: MessageEvent) => { if (typeof e.data?.key === 'string') key(e.data.key); };
    addEventListener('keydown', kd); addEventListener('message', msg);
    return () => { removeEventListener('keydown', kd); removeEventListener('message', msg); };
  });

  const preview = cur ? pick(cur.cfg, col).preview(cur.card, cur.cfg, col, new Date()) : undefined;
  return (
    <div className="page review">
      <header><button onClick={onExit}>‹ Decks</button><span className="title">{deckName}</span>
        {cur && <span className="tools"><button onClick={() => bury(Queue.UserBuried)}>Bury</button><button onClick={() => bury(Queue.Suspended)}>Suspend</button></span>}
      </header>
      {cur === undefined ? <div className="center">Loading…</div>
        : cur === null ? <div className="center">Done for now.</div>
        : sides && <iframe key={`${cur.card.id}-${showAnswer}`} className="card" sandbox="allow-scripts allow-same-origin" srcDoc={srcdoc(showAnswer ? sides.a : sides.q, sides.css, sides.math, dark())} />}
      {cur && (
        <footer>
          {!showAnswer ? <button className="show" onClick={() => setShowAnswer(true)}>Show answer</button> : (
            <div className="ratings">
              {([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const).map((r) => (
                <button key={r} className={`r${r}`} onClick={() => rate(r)}><small>{preview![r]}</small>{Rating[r]}</button>
              ))}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}
