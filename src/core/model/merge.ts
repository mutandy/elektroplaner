/**
 * Drei-Wege-Zusammenführung von Projektständen (für das gleichzeitige Arbeiten
 * auf mehreren Geräten).
 *
 *  base   – der Stand, auf dem die eigenen Änderungen aufbauen (zuletzt mit dem Server abgeglichen)
 *  mine   – der eigene, noch nicht gespeicherte Stand
 *  theirs – der neue Stand vom Server (von einem anderen Gerät)
 *
 * Regeln: Was nur eine Seite geändert hat, wird übernommen. Listen von Objekten
 * mit `id` (Räume, Auslässe, Türen, Stromkreise …) werden je Eintrag
 * zusammengeführt: Neues von beiden Seiten bleibt, Gelöschtes verschwindet.
 * Ändern beide Seiten denselben Wert, gilt der eigene (er wird gleich
 * gespeichert und ist damit die jüngste Änderung).
 */

type J = unknown;

const isObj = (v: J): v is Record<string, J> => typeof v === 'object' && v !== null && !Array.isArray(v);
const eq = (a: J, b: J) => a === b || JSON.stringify(a) === JSON.stringify(b);
const hasIds = (arr: J[]) => arr.length > 0 && arr.every((x) => isObj(x) && typeof x.id === 'string');

export function merge3<T>(base: T, mine: T, theirs: T): T {
  return m(base, mine, theirs) as T;
}

function m(b: J, a: J, t: J): J {
  if (eq(a, b)) return t; // nur die andere Seite (oder niemand) hat geändert
  if (eq(t, b) || eq(a, t)) return a; // nur ich habe geändert, oder beide gleich
  // beide haben geändert
  if (isObj(a) && isObj(t)) {
    const bo = isObj(b) ? b : {};
    const out: Record<string, J> = {};
    for (const k of new Set([...Object.keys(t), ...Object.keys(a)])) {
      const inA = k in a, inT = k in t, inB = k in bo;
      if (inA && inT) out[k] = m(bo[k], a[k], t[k]);
      else if (inA && !inT) { if (!inB || !eq(a[k], bo[k])) out[k] = a[k]; } // von denen gelöscht, außer ich habe es geändert
      else if (inT && !inA) { if (!inB || !eq(t[k], bo[k])) out[k] = t[k]; }
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(t)) {
    const ba = Array.isArray(b) ? b : [];
    if ((hasIds(a) || a.length === 0) && (hasIds(t) || t.length === 0) && (hasIds(ba) || ba.length === 0) && (a.length || t.length)) return mergeById(ba as Rec[], a as Rec[], t as Rec[]);
    if (isLog(a) && isLog(t)) return mergeLog(ba as Rec[], a as Rec[], t as Rec[]);
  }
  return a; // gleicher Wert auf beiden Seiten geändert: eigener gewinnt
}

type Rec = Record<string, J> & { id?: string };

function mergeById(b: Rec[], a: Rec[], t: Rec[]): Rec[] {
  const bm = new Map(b.map((x) => [x.id!, x]));
  const am = new Map(a.map((x) => [x.id!, x]));
  const tm = new Map(t.map((x) => [x.id!, x]));
  const out: Rec[] = [];
  // Reihenfolge der anderen Seite, eigene neue Einträge an ihrer Stelle danach
  for (const x of t) {
    const id = x.id!;
    if (am.has(id)) out.push(m(bm.get(id), am.get(id), x) as Rec);
    else if (!bm.has(id)) out.push(x); // neu bei denen
    else if (!eq(bm.get(id), x)) out.push(x); // ich habe gelöscht, die haben geändert: behalten
    // sonst: ich habe gelöscht
  }
  for (const [i, x] of a.entries()) {
    const id = x.id!;
    if (tm.has(id) || bm.has(id)) continue; // schon behandelt bzw. von denen gelöscht
    // neu bei mir: hinter den Vorgänger aus meiner Liste setzen
    const prev = i > 0 ? a[i - 1].id : undefined;
    const at = prev ? out.findIndex((y) => y.id === prev) : -1;
    out.splice(at + 1, 0, x);
  }
  // von denen gelöscht, bei mir geändert: behalten
  for (const x of a) if (!tm.has(x.id!) && bm.has(x.id!) && !eq(bm.get(x.id!), x) && !out.some((y) => y.id === x.id)) out.push(x);
  return out;
}

/** Protokoll-/Versionslisten: Einträge mit `at`, nur angehängt → Vereinigung, zeitlich sortiert. */
const isLog = (arr: J[]) => arr.every((x) => isObj(x) && typeof x.at === 'string');
function mergeLog(_b: Rec[], a: Rec[], t: Rec[]): Rec[] {
  const key = (x: Rec) => `${x.at}|${JSON.stringify(x.text ?? x.name ?? '')}`;
  const seen = new Set<string>();
  const out: Rec[] = [];
  for (const x of [...t, ...a]) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out.sort((x, y) => String(x.at).localeCompare(String(y.at)));
}
