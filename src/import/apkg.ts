import { unzipSync, type Unzipped } from 'fflate';
import { decompress } from 'fzstd';
import { decode, int, str, subs } from './proto';

export interface Package {
  collection: Uint8Array;       // raw SQLite bytes
  schema: 11 | 18;
  media: Map<string, string>;   // zip entry name -> media filename
  zip: Unzipped;
}

const ZSTD_MAGIC = 0xfd2fb528;
const isZstd = (b: Uint8Array) => b.length > 4 && new DataView(b.buffer, b.byteOffset).getUint32(0, true) === ZSTD_MAGIC;
const unz = (b: Uint8Array) => (isZstd(b) ? decompress(b) : b);

export function openPackage(bytes: Uint8Array): Package {
  const zip = unzipSync(bytes);
  const [name, schema] = zip['collection.anki21b'] ? (['collection.anki21b', 18] as const)
    : zip['collection.anki21'] ? (['collection.anki21', 11] as const)
    : zip['collection.anki2'] ? (['collection.anki2', 11] as const)
    : (() => { throw new Error('no collection in package'); })();
  const collection = unz(zip[name]!);
  return { collection, schema, media: readMedia(zip['media'], schema), zip };
}

function readMedia(raw: Uint8Array | undefined, schema: 11 | 18): Map<string, string> {
  const m = new Map<string, string>();
  if (!raw) return m;
  const b = unz(raw);
  if (schema === 11 || b[0] === 0x7b /* { */) {
    for (const [k, v] of Object.entries(JSON.parse(new TextDecoder().decode(b)) as Record<string, string>)) m.set(k, v);
  } else {
    subs(decode(b), 1).forEach((e, i) => m.set(String(int(e, 255, i)), str(e, 1)));
  }
  return m;
}
