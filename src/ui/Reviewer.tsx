import { useCallback, useEffect, useRef, useState } from 'react';
import { Queue, Rating, type Collection } from '../model/types';
import { answerHtml, bodyClass, buildSides, srcdoc, type Sides } from '../render/card';
import type { AvTag } from '../render/avtags';
import { answer, congratsInfo, describe, extendLimits, mediaUrl, nextCard, setQueue, unburyDeck, type Congrats, type Next } from '../store/queries';

const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export function Reviewer({ col, deckId, deckName, onExit }: { col: Collection; deckId: number; deckName: string; onExit: () => void }) {
  const [cur, setCur] = useState<Next | null>();
  const [sides, setSides] = useState<Sides>();
  const [showAnswer, setShowAnswer] = useState(false);
  const [congrats, setCongrats] = useState<Congrats>();
  const [ready, setReady] = useState(0); // bumped on each iframe 'ready' message (after every load)
  const iframe = useRef<HTMLIFrameElement>(null);
  const shown = useRef(Date.now());
  const audio = useRef<HTMLAudioElement | undefined>(undefined);
  const typed = useRef('');

  const load = useCallback(async () => {
    const n = await nextCard(deckId, col, new Date());
    setCur(n ?? null); setShowAnswer(false); typed.current = '';
    setSides(n ? await buildSides(n) : undefined);
    if (!n) setCongrats(await congratsInfo(deckId, col, new Date()));
    shown.current = Date.now();
  }, [deckId, col]);
  useEffect(() => { load(); }, [load]);

  const post = (m: unknown) => iframe.current?.contentWindow?.postMessage(m, '*');
  // show question/answer once iframe script is ready
  useEffect(() => {
    if (!ready || !cur || !sides) return;
    const html = showAnswer ? answerHtml(sides, typed.current) : sides.q;
    post({ show: { html, bodyclass: bodyClass(cur, dark()), answer: showAnswer } });
  }, [ready, cur, sides, showAnswer]);

  const play = async (tags: AvTag[], idx?: number) => {
    audio.current?.pause();
    const list = idx === undefined ? tags : [tags[idx]!];
    for (const t of list) {
      if (!('sound' in t)) continue;
      const url = await mediaUrl(t.sound);
      if (!url) continue;
      const a = new Audio(url); audio.current = a;
      await new Promise<void>((res) => { a.onended = () => res(); a.onerror = () => res(); a.play().catch(() => res()); });
    }
  };

  const reveal = () => { post({ getTyped: true }); setShowAnswer(true); };
  const rate = async (r: Rating) => { if (cur) { audio.current?.pause(); await answer(cur, r, col, new Date(), Date.now() - shown.current); await load(); } };
  const bury = async (q: Queue) => { if (cur) { await setQueue(cur.card.id, q); await load(); } };

  useEffect(() => {
    const key = (k: string) => {
      if (k === ' ' || k === 'Enter') showAnswer ? rate(Rating.Good) : reveal();
      else if (showAnswer && ['1', '2', '3', '4'].includes(k)) rate(Number(k) as Rating);
      else if (k === 'r' || k === 'F5') { if (sides) play(showAnswer ? sides.aTags : sides.qTags); }
      else if (k === 'Escape') onExit();
    };
    const kd = (e: KeyboardEvent) => { if (e.key === ' ') e.preventDefault(); key(e.key); };
    const msg = (e: MessageEvent) => {
      const d = e.data ?? {};
      if (d.ready) setReady((n) => n + 1);
      if (typeof d.key === 'string') key(d.key);
      if (typeof d.typed === 'string') typed.current = d.typed;
      if (d.pycmd === 'ans') reveal();
      else if (typeof d.pycmd === 'string' && d.pycmd.startsWith('play:') && sides) { const [, side, i] = d.pycmd.split(':'); play(side === 'q' ? sides.qTags : sides.aTags, Number(i)); }
      if (d.shown === 'q' && sides) play(sides.qTags);
      if (d.shown === 'a' && sides) play(sides.aTags);
    };
    addEventListener('keydown', kd); addEventListener('message', msg);
    return () => { removeEventListener('keydown', kd); removeEventListener('message', msg); };
  });

  const labels = cur ? describe(cur, col) : undefined;
  return (
    <div className="page review">
      <header><button onClick={onExit}>‹ Decks</button><span className="title">{deckName}</span>
        {cur && <span className="tools"><button onClick={() => bury(Queue.UserBuried)}>Bury</button><button onClick={() => bury(Queue.Suspended)}>Suspend</button></span>}
      </header>
      {cur === undefined ? <div className="center">Loading…</div>
        : cur === null ? <Done congrats={congrats} onMore={async (n, r) => { await extendLimits(deckId, col, new Date(), n, r); await load(); }} onUnbury={async () => { await unburyDeck(deckId); await load(); }} />
        : sides && <iframe ref={iframe} className="card" sandbox="allow-scripts" srcDoc={srcdoc(sides.css, dark())} />}
      {cur && (
        <footer>
          <div className="counts"><b className={`new${cur.kind === 'new' ? ' cur' : ''}`}>{cur.counts.new}</b><b className={`learn${cur.kind === 'learning' ? ' cur' : ''}`}>{cur.counts.learning}</b><b className={`review${cur.kind === 'review' ? ' cur' : ''}`}>{cur.counts.review}</b></div>
          {!showAnswer ? <button className="show" onClick={reveal}>Show answer</button> : (
            <div className="ratings">
              {([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const).map((r) => (
                <button key={r} className={`r${r}`} onClick={() => rate(r)}><small>{labels![r]}</small>{Rating[r]}</button>
              ))}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

function Done({ congrats, onMore, onUnbury }: { congrats?: Congrats; onMore: (n: number, r: number) => void; onUnbury: () => void }) {
  const [n, setN] = useState(10);
  if (!congrats) return <div className="center">Done for now.</div>;
  const mins = Math.ceil(congrats.secsUntilNextLearn / 60);
  return (
    <div className="center congrats">
      <h2>Congratulations! You have finished this deck for now.</h2>
      {congrats.learnRemaining > 0 && <p>The next learning card will be ready in {mins < 60 ? `${mins} minutes` : `${Math.round(mins / 60)} hours`}.</p>}
      {(congrats.newRemaining || congrats.reviewRemaining) && (
        <p>
          <label>Study more <input type="number" min={1} max={9999} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} /></label>
          {congrats.newRemaining && <button onClick={() => onMore(n, 0)}>+{n} new</button>}
          {congrats.reviewRemaining && <button onClick={() => onMore(0, n)}>+{n} reviews</button>}
        </p>
      )}
      {(congrats.haveSchedBuried || congrats.haveUserBuried) && <p>Some related or buried cards were delayed until a later session. <button onClick={onUnbury}>Unbury</button></p>}
    </div>
  );
}
