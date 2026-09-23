import type { Progress } from './index';

export type ImportResult = { notes: number; cards: number; media: number };

// Module workers need Safari 15+. If the worker cannot start, import on the main thread instead of
// failing: a blocked worker used to look like "nothing happens" on older iPhones.
export async function runImport(bytes: Uint8Array, onProgress: (p: Progress) => void): Promise<ImportResult> {
  try {
    return await inWorker(bytes, onProgress);
  } catch (e) {
    console.warn('worker import failed, falling back to main thread', e);
    const { importPackage } = await import('./index');
    return importPackage(bytes, onProgress, () => `${import.meta.env.BASE_URL}sql-wasm.wasm`);
  }
}

function inWorker(bytes: Uint8Array, onProgress: (p: Progress) => void) {
  return new Promise<ImportResult>((res, rej) => {
    let w: Worker;
    try { w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); }
    catch (e) { rej(e); return; }
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; w.terminate(); fn(); } };
    w.onmessage = (e) => {
      if (e.data.progress) onProgress(e.data.progress);
      else if (e.data.done) finish(() => res(e.data.done));
      else if (e.data.error) finish(() => rej(new Error(e.data.error)));
    };
    w.onerror = (e) => finish(() => rej(new Error(e.message || 'worker failed to start')));
    w.postMessage({ bytes }, [bytes.buffer as ArrayBuffer]);
  });
}
