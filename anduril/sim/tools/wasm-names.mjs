// wasm-names.mjs: map wasm function-table indices to function names.
//
// Anduril keeps its current UI state in a function pointer.  In wasm a function
// pointer is an index into the module's table, so pairing the element segments
// with the name section is what lets the simulator report "steady_state"
// instead of "0x2".
import fs from 'node:fs';

export function tableNames(bytes) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;  // skip magic + version
  const names = new Map();      // function index -> name
  const table = new Map();      // table index -> function index
  let importedFuncs = 0;

  const u32 = () => { let r = 0, s = 0, b; do { b = bytes[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  const str = () => { const n = u32(); const s = new TextDecoder().decode(bytes.subarray(p, p + n)); p += n; return s; };
  const skipExpr = () => { while (bytes[p] !== 0x0b) { if (bytes[p] === 0x41) { p++; u32(); } else p++; } p++; };

  while (p < bytes.length) {
    const id = bytes[p++];
    const size = u32();
    const end = p + size;

    if (id === 2) {  // imports: they occupy the low function indices
      const n = u32();
      for (let i = 0; i < n; i++) {
        str(); str();
        const kind = bytes[p++];
        if (kind === 0) { u32(); importedFuncs++; }
        else if (kind === 1) { p++; const fl = bytes[p++]; u32(); if (fl) u32(); }
        else if (kind === 2) { const fl = bytes[p++]; u32(); if (fl) u32(); }
        else if (kind === 3) { p++; p++; }
      }
    } else if (id === 9) {  // element segments
      const n = u32();
      for (let i = 0; i < n; i++) {
        const flags = u32();
        if (flags === 0 || flags === 2) {
          if (flags === 2) u32();          // table index
          const save = p; skipExpr();
          // read the offset out of the (i32.const N) we just skipped
          let off = 0, q = save;
          if (bytes[q] === 0x41) { q++; let r = 0, s = 0, b; do { b = bytes[q++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); off = r; }
          if (flags === 2) p++;            // elemkind
          const cnt = u32();
          for (let k = 0; k < cnt; k++) table.set(off + k, u32());
        } else {
          p = end; break;                  // passive/declared segments carry no pointers we need
        }
      }
    } else if (id === 0) {  // custom
      const save = p;
      const name = str();
      if (name === 'name') {
        while (p < end) {
          const sub = bytes[p++];
          const subSize = u32();
          const subEnd = p + subSize;
          if (sub === 1) {
            const n = u32();
            for (let i = 0; i < n; i++) { const idx = u32(); names.set(idx, str()); }
          }
          p = subEnd;
        }
      } else p = save;
    }
    p = end;
  }

  const out = {};
  for (const [slot, fn] of table) {
    const n = names.get(fn);
    if (n) out[slot] = n;
  }
  return { table: out, importedFuncs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { table } = tableNames(fs.readFileSync(process.argv[2]));
  console.log(JSON.stringify(table, null, 1));
}
