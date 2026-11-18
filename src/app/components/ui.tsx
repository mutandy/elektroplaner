/** Wiederverwendbare Eingabe-Bausteine (Felder, editierbare Tabellen). */
import { useEffect, useState, type ReactNode } from 'react';

export interface Option { value: string; label: string }

export function NumberInput({ value, onChange, step = 0.5, min, placeholder, nullable, width }: {
  value: number | null | undefined; onChange: (v: number | null) => void; step?: number; min?: number; placeholder?: string; nullable?: boolean; width?: string;
}) {
  const [txt, setTxt] = useState(value == null ? '' : String(value).replace('.', ','));
  useEffect(() => setTxt(value == null ? '' : String(value).replace('.', ',')), [value]);
  const commit = () => {
    const t = txt.trim().replace(',', '.');
    if (t === '') {
      if (nullable) onChange(null);
      else setTxt(value == null ? '' : String(value).replace('.', ','));
      return;
    }
    const v = Number(t);
    if (Number.isFinite(v) && (min == null || v >= min)) {
      if (v !== value) onChange(v);
    } else setTxt(value == null ? '' : String(value).replace('.', ','));
  };
  return (
    <input className="num" inputMode="decimal" value={txt} placeholder={placeholder} style={width ? { width } : undefined}
      onChange={(e) => setTxt(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const cur = Number(txt.replace(',', '.')) || 0; onChange(Math.round((cur + (e.key === 'ArrowUp' ? step : -step)) * 10) / 10); } }} />
  );
}

export function TextInput({ value, onChange, placeholder, list, wide }: { value: string; onChange: (v: string) => void; placeholder?: string; list?: string; wide?: boolean }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  return <input className={wide ? 'wide' : undefined} value={txt} placeholder={placeholder} list={list} onChange={(e) => setTxt(e.target.value)} onBlur={() => txt !== value && onChange(txt)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function Select({ value, options, onChange, allowEmpty }: { value: string | undefined; options: Option[]; onChange: (v: string | undefined) => void; allowEmpty?: string }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}>
      {allowEmpty != null && <option value="">{allowEmpty}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field"><span className="flabel">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>
  );
}

export const opts = (rec: Record<string, string>): Option[] => Object.entries(rec).map(([value, label]) => ({ value, label }));

export type Col<T> = {
  key: keyof T & string;
  label: string;
  type: 'text' | 'number' | 'select' | 'check' | 'nullnumber' | 'readonly';
  options?: Option[];
  width?: string;
  allowEmpty?: string;
  render?: (row: T) => ReactNode;
  title?: string;
};

/** Editierbare Tabelle: jede Zeile ein Objekt, Änderungen gehen als (index, key, wert) raus. */
export function EditTable<T extends Record<string, any>>({ rows, cols, onChange, onRemove, onAdd, addLabel = 'Hinzufügen', rowKey, selectedKey, onSelect, empty }: {
  rows: T[]; cols: Col<T>[]; onChange: (i: number, key: keyof T & string, v: any) => void; onRemove?: (i: number) => void; onAdd?: () => void; addLabel?: string;
  rowKey: (r: T, i: number) => string; selectedKey?: string; onSelect?: (r: T, i: number) => void; empty?: string;
}) {
  return (
    <div className="tablewrap">
      <table className="edit">
        <thead><tr>{cols.map((c) => <th key={c.key} style={{ width: c.width }} title={c.title}>{c.label}</th>)}{onRemove && <th />}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={cols.length + 1} className="muted">{empty ?? 'Noch keine Einträge.'}</td></tr>}
          {rows.map((r, i) => {
            const k = rowKey(r, i);
            return (
              <tr key={k} className={selectedKey === k ? 'selected' : undefined} onClick={() => onSelect?.(r, i)}>
                {cols.map((c) => (
                  <td key={c.key}>
                    {c.render ? c.render(r)
                      : c.type === 'text' ? <TextInput value={r[c.key] ?? ''} onChange={(v) => onChange(i, c.key, v)} />
                      : c.type === 'number' ? <NumberInput value={r[c.key]} onChange={(v) => onChange(i, c.key, v)} />
                      : c.type === 'nullnumber' ? <NumberInput value={r[c.key]} nullable placeholder="–" onChange={(v) => onChange(i, c.key, v)} />
                      : c.type === 'select' ? <Select value={r[c.key] == null ? undefined : String(r[c.key])} options={c.options ?? []} allowEmpty={c.allowEmpty} onChange={(v) => onChange(i, c.key, v)} />
                      : c.type === 'check' ? <input type="checkbox" checked={!!r[c.key]} onChange={(e) => onChange(i, c.key, e.target.checked)} />
                      : <span>{String(r[c.key] ?? '')}</span>}
                  </td>
                ))}
                {onRemove && <td><button className="icon danger" title="Entfernen" onClick={(e) => { e.stopPropagation(); if (confirm('Eintrag entfernen?')) onRemove(i); }}>✕</button></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {onAdd && <button className="add" onClick={onAdd}>＋ {addLabel}</button>}
    </div>
  );
}

export function Section({ title, children, right, open = true }: { title: ReactNode; children: ReactNode; right?: ReactNode; open?: boolean }) {
  return (
    <details className="section" open={open}>
      <summary><span>{title}</span>{right}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
