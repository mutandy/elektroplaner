/**
 * Aufgaben- und Prüfliste für die Bauphase – in der richtigen Reihenfolge,
 * aus dem Projekt erzeugt. Erledigt-Status steht in project.tasks[id].
 */
import type { Project } from '../model/schema';
import { fmt, futureBuildup } from '../geometry/room';
import { computeAllRoutes, routeTotals, type RoomRoutes } from './routes';
import { NORM_VALUES } from '../rules/normValues';

export type Who = 'Eigenleistung' | 'Elektrofachkraft' | 'Fachbetrieb' | 'alle';

export interface Task {
  id: string;
  phase: string;
  text: string;
  who: Who;
  roomId?: string;
  /** Muss vor dem nächsten Schritt erledigt sein (Haltepunkt). */
  hold?: boolean;
  done: boolean;
  note: string;
}

export const PHASES = [
  '1 Vorbereitung',
  '2 Bestand prüfen',
  '3 Anzeichnen',
  '4 Schlitzen und Bohren',
  '5 Dosen setzen und Leitungen verlegen',
  '6 Dokumentieren und messen',
  '7 Schließen',
  '8 Verteiler und Anschluss',
  '9 Endmontage',
  '10 Prüfung und Abnahme',
];

export function buildTasks(project: Project, routes: Map<string, RoomRoutes> = computeAllRoutes(project)): Task[] {
  const tasks: Omit<Task, 'done' | 'note'>[] = [];
  const t = (id: string, phase: number, text: string, who: Who, extra: Partial<Task> = {}) => tasks.push({ id, phase: PHASES[phase - 1], text, who, ...extra });
  const rooms = project.rooms.filter((r) => r.inScope);
  const confirm = NORM_VALUES.filter((n) => n.confirm).length;

  // 1 Vorbereitung
  t('vorb.abstimmung', 1, `Planung mit der Elektrofachkraft durchsprechen: Verteilung, Absicherung, RCD-Zuordnung, ${confirm} Normwerte „vom Elektriker zu bestätigen“, Leitungswege freigeben.`, 'Elektrofachkraft', { hold: true });
  t('vorb.material', 1, 'Material laut Bestellliste bestellen (Gebinde), Werkzeug mieten (Mauernutfräse, Sauger Klasse M).', 'Eigenleistung');
  t('vorb.strom', 1, 'Betroffene Stromkreise abschalten, gegen Wiedereinschalten sichern, Spannungsfreiheit durch Elektrofachkraft feststellen lassen. Baustrom/Leuchten für die Arbeit organisieren.', 'Elektrofachkraft', { hold: true });
  t('vorb.schutz', 1, 'Staubschutz (Folie, Türen abkleben), FFP2, Gehör- und Augenschutz bereitlegen.', 'Eigenleistung');

  // 2 Bestand
  for (const r of rooms) for (const c of r.existingCables) {
    t(`bestand.${c.id}.zug`, 2, `${r.name}: ${c.label || 'Bestandsleitung'} (${c.cableType}) – Zugtest: lose → neue Leitung mit einziehen; fest → messen lassen.`, 'Eigenleistung', { roomId: r.id });
    t(`bestand.${c.id}.mess`, 2, `${r.name}: ${c.label || 'Bestandsleitung'} – Adernzahl/Schutzleiter prüfen, Isolationsmessung; ggf. Leuchte Schutzklasse II.`, 'Elektrofachkraft', { roomId: r.id });
  }
  for (const r of rooms) {
    const keep = r.outlets.filter((o) => o.status === 'bestand_bleibt').map((o) => o.label);
    if (keep.length) t(`bestand.${r.id}.dosen`, 2, `${r.name}: Bestandsauslässe ${keep.join(', ')} prüfen (Leitung, Zustand, Klemmstelle weiterverwendbar?).`, 'Elektrofachkraft', { roomId: r.id });
  }

  // 3 Anzeichnen
  for (const r of rooms) {
    const fb = futureBuildup(r);
    t(`anz.${r.id}`, 3, `${r.name}: Nullpunkt (Ecke 1) markieren, Wände W1… beschriften, Meterriss/Höhenbezug „${project.settings.heightReference.label}“ anzeichnen${fb ? ` (künftiger Boden +${fmt(fb)} cm)` : ''}; Dosenmitten und Schlitze nach Schlitzplan anzeichnen.`, 'Eigenleistung', { roomId: r.id });
    t(`anz.${r.id}.ortung`, 3, `${r.name}: Trassen mit Leitungssucher prüfen; vor dem Schlitzen auf Betonstürze und alte Leitungen/Rohre prüfen.`, 'Eigenleistung', { roomId: r.id });
  }
  t('anz.kontrolle', 3, 'Angezeichnete Positionen vor Ort mit dem Bauherrn kontrollieren (Möbel, Türanschlag, Höhen).', 'alle', { hold: true });

  // 4 Schlitzen/Bohren
  for (const r of rooms) {
    const rr = routes.get(r.id);
    if (!rr) continue;
    const tt = routeTotals(rr);
    if (tt.floorSlotM > 0) t(`schlitz.${r.id}.boden`, 4, `${r.name}: ${fmt(tt.floorSlotM, 1)} m Bodenschlitz – max. ${fmt(r.floor.maxSlotDepth * 10, 0)} mm tief (Folie/Dämmung ab ${fmt(r.floor.protectedLayerDepth)} cm nie anschneiden), keine Dübel.`, 'Eigenleistung', { roomId: r.id });
    if (tt.wallSlotM > 0) t(`schlitz.${r.id}.wand`, 4, `${r.name}: ${fmt(tt.wallSlotM, 1)} m Wandschlitz (Maße laut Schlitzplan, senkrecht in den Zonen).`, 'Eigenleistung', { roomId: r.id });
    if (tt.drillUP + tt.drillHollow + tt.drillCeiling > 0) t(`schlitz.${r.id}.bohr`, 4, `${r.name}: ${tt.drillUP} UP-Bohrungen Ø 68, ${tt.drillHollow} Hohlwanddosen, ${tt.drillCeiling} Deckendosen.`, 'Eigenleistung', { roomId: r.id });
    for (const p of rr.penetrations) t(`schlitz.${r.id}.${p.id}`, 4, `${r.name}: Durchbruch Ø ${p.diameter} mm in W${p.wallIndex + 1} bei ${fmt(p.s)} cm, Höhe ${fmt(p.z)} cm${p.fireStop ? ' – Brandabschnitt: Abschottung durch Fachbetrieb' : ''}.`, p.fireStop ? 'Fachbetrieb' : 'Eigenleistung', { roomId: r.id });
    if (tt.surfaceM > 0) t(`schlitz.${r.id}.ap`, 4, `${r.name}: ${fmt(tt.surfaceM, 1)} m Aufputzrohr montieren (Schellen alle 50 cm${/garage/i.test(r.name) ? ', bis 1,5 m Stahlrohr/Kanal' : ''}).`, 'Eigenleistung', { roomId: r.id });
  }

  // 5 Dosen + Leitungen
  t('verl.dosen', 5, 'Dosen bündig zur Rohwand setzen (Dosenmörtel); Putzausgleichsringe nur bei späterem Putz > 5 mm.', 'Eigenleistung');
  t('verl.kabel', 5, 'Leitungen laut Leitungsliste einziehen, an beiden Enden mit Leitungsnummer beschriften; einlagig, nebeneinander; im Boden mit Schnellzement-Batzen fixieren; Reserve an Dosen (ca. 30 cm) und in der Verteilung (ca. 1 m).', 'Eigenleistung');
  if (rooms.some((r) => routes.get(r.id)?.floorSlots.some((f) => f.crossesDoor))) t('verl.schwelle', 5, 'Übergänge unter Türschwellen mit Schutzrohr ausführen, bevor Schwellen gesetzt werden.', 'Eigenleistung');
  if (project.circuits.some((c) => c.cable.startsWith('NYY'))) t('verl.erde', 5, 'Erdkabel: Graben frostfrei (ca. 60–80 cm), Sandbett, Schutzrohr, Warnband ca. 20–30 cm über dem Kabel, Reserve-Leerrohr mitlegen; Lage einmessen und fotografieren.', 'Eigenleistung');

  // 6 Dokumentieren/Messen
  t('doku.fotos', 6, 'Jede offene Trasse mit Zollstock fotografieren (Raum, Wand, Nullpunkt erkennbar) – vor dem Verschließen!', 'Eigenleistung', { hold: true });
  t('doku.iso', 6, 'Isolationsmessung aller neu verlegten Leitungen vor dem Einmörteln/Verschließen.', 'Elektrofachkraft', { hold: true });

  // 7 Schließen
  t('schl.boden', 7, 'Bodenschlitze mit zementärem Reparaturmörtel verfüllen (nicht Gips), danach Ausgleichsmasse.', 'Eigenleistung');
  t('schl.wand', 7, 'Wandschlitze mit Gips/Haftputz schließen, Durchbrüche verschließen.', 'Eigenleistung');

  // 8 Verteiler
  for (const d of project.distributions) {
    const nl = project.circuits.filter((c) => c.distributionId === d.id && !c.breakerGroupId).length;
    const nr = d.rcds.filter((r) => !r.existing).length;
    if (d.kind === 'UV') t(`vert.${d.id}`, 8, `${d.name} setzen (trocken, frostfrei, nicht im Türaufschlag/Anfahrbereich), Zuleitung ${d.feedCable} anschließen, bestücken${d.hasSpd ? ', Überspannungsschutz' : ''}.`, 'Elektrofachkraft');
    else if (nl || nr) t(`vert.${d.id}`, 8, `${d.name}: ${nl} neue LS, ${nr} neue RCD einbauen, Stromkreise nach Stromkreisliste auflegen und beschriften.`, 'Elektrofachkraft');
  }

  // 9 Endmontage
  t('end.einsaetze', 9, 'Nach Maler: Einsätze und Rahmen montieren (Einsatz-Stückliste), Leuchten anschließen.', 'Elektrofachkraft');
  if (project.smartHome.enabled) t('end.smart', 9, 'Smart-Home-Aktoren einbauen, einbinden und Funktionen testen.', 'Elektrofachkraft');

  // 10 Prüfung
  t('pruef.erst', 10, 'Erstprüfung nach DIN VDE 0100-600: Besichtigen, Erproben, Messen (Schutzleiter, Isolation, Schleifenimpedanz, RCD-Auslösung); Prüfprotokoll erstellen.', 'Elektrofachkraft', { hold: true });
  t('pruef.uebergabe', 10, 'Übergabe: Stromkreisliste in die Verteilung, Pläne und Fotos der Trassen archivieren.', 'alle');
  t('pruef.rwm', 10, 'Rauchwarnmelder montieren und testen.', 'Eigenleistung');

  return tasks.map((x) => ({ ...x, done: !!project.tasks[x.id]?.done, note: project.tasks[x.id]?.note ?? '' }));
}
