import type { Progress } from './index';

export function runImport(bytes: Uint8Array, onProgress: (p: Progress) => void) {
  return new Promise<{ notes: number; cards: number; media: number }>((res, rej) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      if (e.data.progress) onProgress(e.data.progress);
      else if (e.data.done) { res(e.data.done); w.terminate(); }
      else if (e.data.error) { rej(new Error(e.data.error)); w.terminate(); }
    };
    w.onerror = (e) => { rej(new Error(e.message)); w.terminate(); };
    w.postMessage({ bytes }, [bytes.buffer as ArrayBuffer]);
  });
}
