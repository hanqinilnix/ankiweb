// FNV-1a 64-bit over little-endian i64 words, matching Anki's `fnvhash` SQL function (Rust `fnv` crate, Hasher::write_i64).
const PRIME = 0x100000001b3n, OFFSET = 0xcbf29ce484222325n, MASK = (1n << 64n) - 1n;
export function fnvhash(...values: number[]): bigint {
  let h = OFFSET;
  for (const v of values) {
    let x = BigInt.asUintN(64, BigInt(Math.trunc(v)));
    for (let i = 0; i < 8; i++) { h ^= x & 0xffn; h = (h * PRIME) & MASK; x >>= 8n; }
  }
  return h;
}
export const cmpBig = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
