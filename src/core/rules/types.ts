import type { Project, Room, Outlet } from '../model/schema';

export type Severity = 'ok' | 'hinweis' | 'warnung' | 'fehler';

export interface RuleFinding {
  ruleId: string;
  severity: Severity;
  message: string;
  /** Norm oder „Praxisregel“. */
  source: string;
  /** Wert/Regel muss von der Elektrofachkraft bestätigt werden. */
  confirm: boolean;
  roomId?: string;
  outletId?: string;
  /** Kurzer Verweis für Tabellen (z. B. Auslass-Label). */
  ref?: string;
}

export interface RuleContext {
  project: Project;
}

export interface Rule {
  id: string;
  title: string;
  source: string;
  confirm: boolean;
  /** Bereich, für den die Regel läuft. */
  scope: 'projekt' | 'raum' | 'auslass';
  check: (ctx: RuleContext, room?: Room, outlet?: Outlet) => Omit<RuleFinding, 'ruleId' | 'source' | 'confirm'>[];
}
