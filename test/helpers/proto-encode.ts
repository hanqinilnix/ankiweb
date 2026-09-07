// Tiny protobuf encoder for fixtures.
type F = { n: number; v: number | bigint | string | Uint8Array | number[]; kind?: 'float' | 'floats' | 'sub' };

const te = new TextEncoder();
const varint = (v: bigint) => { const o: number[] = []; do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; o.push(b); } while (v); return o; };

export function enc(fields: F[]): Uint8Array {
  const out: number[] = [];
  const ld = (n: number, b: Uint8Array) => out.push(...varint(BigInt((n << 3) | 2)), ...varint(BigInt(b.length)), ...b);
  for (const f of fields) {
    if (f.kind === 'float') { out.push(...varint(BigInt((f.n << 3) | 5))); const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, f.v as number, true); out.push(...b); }
    else if (f.kind === 'floats') { const a = f.v as number[]; const b = new Uint8Array(a.length * 4); const dv = new DataView(b.buffer); a.forEach((x, i) => dv.setFloat32(i * 4, x, true)); ld(f.n, b); }
    else if (typeof f.v === 'string') ld(f.n, te.encode(f.v));
    else if (f.v instanceof Uint8Array) ld(f.n, f.v);
    else out.push(...varint(BigInt((f.n << 3) | 0)), ...varint(BigInt(f.v as number | bigint)));
  }
  return new Uint8Array(out);
}
