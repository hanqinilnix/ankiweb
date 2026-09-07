// Minimal protobuf wire decoder. Returns field number -> raw values (varint bigint | Uint8Array | fixed32).
export type PbValue = bigint | Uint8Array | number;
export type PbMsg = Map<number, PbValue[]>;

export function decode(buf: Uint8Array): PbMsg {
  const out: PbMsg = new Map();
  let i = 0;
  const varint = () => {
    let v = 0n, s = 0n;
    for (;;) {
      const b = buf[i++]!;
      v |= BigInt(b & 0x7f) << s;
      if (b < 0x80) return v;
      s += 7n;
    }
  };
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (i < buf.length) {
    const tag = Number(varint());
    const field = tag >>> 3, wt = tag & 7;
    let v: PbValue;
    if (wt === 0) v = varint();
    else if (wt === 1) { v = Number(dv.getBigInt64(i, true)); i += 8; }
    else if (wt === 2) { const n = Number(varint()); v = buf.subarray(i, i + n); i += n; }
    else if (wt === 5) { v = dv.getFloat32(i, true); i += 4; }
    else throw new Error(`pb wire type ${wt}`);
    (out.get(field) ?? out.set(field, []).get(field)!).push(v);
  }
  return out;
}

const td = new TextDecoder();
export const str = (m: PbMsg, f: number, d = '') => { const v = m.get(f)?.[0]; return v instanceof Uint8Array ? td.decode(v) : d; };
export const int = (m: PbMsg, f: number, d = 0) => { const v = m.get(f)?.[0]; return typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : d; };
export const f32 = (m: PbMsg, f: number, d = 0) => { const v = m.get(f)?.[0]; return typeof v === 'number' ? v : d; };
export const sub = (m: PbMsg, f: number) => { const v = m.get(f)?.[0]; return v instanceof Uint8Array ? decode(v) : new Map(); };
export const subs = (m: PbMsg, f: number) => (m.get(f) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map(decode);
// repeated float: packed (bytes) or unpacked (fixed32 each)
export function floats(m: PbMsg, f: number): number[] {
  const out: number[] = [];
  for (const v of m.get(f) ?? []) {
    if (typeof v === 'number') out.push(v);
    else if (v instanceof Uint8Array) {
      const dv = new DataView(v.buffer, v.byteOffset, v.byteLength);
      for (let i = 0; i + 4 <= v.length; i += 4) out.push(dv.getFloat32(i, true));
    }
  }
  return out;
}
