// Runs unzip + SQLite parse off the main thread. IndexedDB writes happen here too.
import { importPackage, type Progress } from './index';

self.onmessage = async (e: MessageEvent<{ bytes: Uint8Array }>) => {
  try {
    const r = await importPackage(e.data.bytes, (p: Progress) => self.postMessage({ progress: p }), () => `${import.meta.env.BASE_URL}sql-wasm.wasm`);
    self.postMessage({ done: r });
  } catch (err) {
    self.postMessage({ error: (err as Error).message });
  }
};
