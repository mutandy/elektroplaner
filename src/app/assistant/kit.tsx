/**
 * Bausteine des Assistenten: große Kacheln mit Symbol, Chips, Zahlenfelder.
 * Alles für Daumenbedienung gebaut (min. 48 px hoch).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown } from 'lucide-react';

/** Kachelraster; `stacked`: Symbol über dem Text (für viele kurze Auswahlen, z. B. Räume). */
export function Tiles({ children, cols = 2, stacked }: { children: ReactNode; cols?: 1 | 2 | 3; stacked?: boolean }) {
  return <div className={`a-tiles cols-${cols}${stacked ? ' is-stacked' : ''}`}>{children}</div>;
}

export function Tile({ icon: Icon, label, hint, selected, onClick, disabled, badge, swatch }: {
  icon?: LucideIcon; label: string; hint?: string; selected?: boolean; onClick: () => void; disabled?: boolean; badge?: ReactNode; swatch?: string;
}) {
  return (
    <button type="button" className={`a-tile ${selected ? 'is-selected' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={selected}>
      {swatch ? <span className="a-swatch" style={{ background: swatch }} aria-hidden /> : Icon ? <Icon className="a-tile-icon" size={26} strokeWidth={1.8} aria-hidden /> : null}
      <span className="a-tile-text">
        <span className="a-tile-label">{label}</span>
        {hint && <span className="a-tile-hint">{hint}</span>}
        {badge && <span className="a-tile-badge">{badge}</span>}
      </span>
      {selected && <Check className="a-tile-check" size={18} strokeWidth={2.5} aria-hidden />}
    </button>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <div className="a-chips">{children}</div>;
}

export function Chip({ label, selected, onClick }: { label: string; selected?: boolean; onClick: () => void }) {
  return <button type="button" className={`a-chip ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onClick}>{label}</button>;
}

/** Großes Zahlenfeld (Ziffernblock am Handy), Komma oder Punkt. Übernimmt beim Verlassen. */
export function NumField({ label, value, onChange, unit = 'cm', autoFocus }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; unit?: string; autoFocus?: boolean }) {
  const show = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
  const [txt, setTxt] = useState(show(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setTxt(show(value)), [value]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const commit = () => {
    const t = txt.trim().replace(',', '.');
    const v = t === '' ? null : Number(t);
    if (v === null || Number.isFinite(v)) { if (v !== value) onChange(v); } else setTxt(show(value));
  };
  return (
    <label className="a-num">
      <span className="a-num-label">{label}</span>
      <span className="a-num-row">
        <input ref={ref} inputMode="decimal" autoComplete="off" value={txt} onChange={(e) => setTxt(e.target.value.replace(/[^\d,.]/g, ''))} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        {unit && <span className="a-num-unit">{unit}</span>}
      </span>
    </label>
  );
}

export function TextField({ value, onChange, placeholder, autoFocus, label }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; label?: string }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  return (
    <label className="a-text">
      {label && <span className="a-num-label">{label}</span>}
      <input value={txt} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => setTxt(e.target.value)} onBlur={() => txt !== value && onChange(txt)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

/** Aufklappbar: Fachdetails nur auf Wunsch. */
export function More({ label = 'Genauer angeben', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`a-more ${open ? 'is-open' : ''}`}>
      <button type="button" className="a-more-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronDown size={18} aria-hidden /> {label}
      </button>
      {open && <div className="a-more-body">{children}</div>}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="a-note">{children}</p>;
}
