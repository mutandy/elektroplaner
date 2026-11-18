# Elektroplaner

Planungswerkzeug für Elektroinstallationen in Wohngebäuden in Deutschland: Neubau, Bestand mit kompletter Erneuerung, Teilsanierung und Mischformen (UP/AP, Unterverteilungen, Außenbereich).

> ⚡ **Ersetzt keine Elektrofachkraft.** Das Programm erzeugt Planungsunterlagen für Vorarbeiten (Schlitze, Dosen, Leerrohre, Kabel einziehen). Anschluss, Prüfung, Messung und Inbetriebnahme macht ausschließlich eine eingetragene Elektrofachkraft. Der Hinweis steht in der App und auf jeder Druckseite.

Stand: **Etappe 1 (MVP)**. Was fehlt, steht unten unter [Was fehlt / vereinfacht](#was-fehlt--vereinfacht).

## Starten

Voraussetzung: Node.js ≥ 20.

```bash
npm install
```

```bash
npm run dev
```

Danach <http://localhost:5173> öffnen. Beim ersten Start ist das Beispielprojekt „Kellerwohnung mit Garage“ geladen. Änderungen werden automatisch im Browser gespeichert (IndexedDB). Über „Speichern als Datei“ entsteht eine Projektdatei (`*.elektroplan.json`), die sich mit „Öffnen“ wieder laden lässt.

Weitere Befehle:

| Befehl | Zweck |
|---|---|
| `npm test` | Tests (Datenmodell, Geometrie, Regeln, Rendering-Snapshots, Dokumente) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run build` | statische App nach `dist/` (läuft ohne Server, z. B. von USB-Stick oder Webspace) |
| `npm run example` | `examples/kellerwohnung.json` aus `examples/keller.ts` neu erzeugen |
| `npm run schema` | Datenmodell als JSON Schema nach `schema/` exportieren |
| `npm run pdf -- projekt.json ausgabeordner` | PDFs (A4 quer) über Chromium erzeugen; braucht einmalig `npm i -D playwright && npx playwright install chromium` |

Die fertigen Ausgaben des Beispielprojekts liegen in [`beispiel-ausgaben/`](beispiel-ausgaben/).

## Bedienung in Kürze

1. **Projekt**: Projektart, Bundesland, Höhenbezug, Standardhöhen, Schalterprogramm (Standard: Merten System M, frei änderbar), **Smart Home** (aus/ein, System: KNX, Home Assistant, Shelly, Zigbee, Matter/Thread, Homematic IP, gemischt; mit Erklärung, was das für die Leitungsplanung bedeutet), Geschosse und Räume.
2. **Verteilung & Stromkreise**: Hauptverteilung und Unterverteilungen mit freien LS und RCDs, Stromkreise mit Zuordnung.
3. **Räume**, Raum für Raum in vier Schritten: *Bauliches* (Grundriss, Wände, Vorwand-Abschnitte mit eigener Höhe, Kaminwange/Tabuzonen, Türen, Fenster, Boden- und Deckenaufbau, Hindernisse, Bestandsleitungen), *Einrichtung* (Möbel/Geräte), *Auslässe* (Schnellanlage, Detailformular, Verschieben per Maus in Draufsicht und Wandabwicklung), *Zusammenfassung* (offene Fragen, Regelprüfung, „Raum bestätigen“).
4. **Prüfung**: alle Regelmeldungen (Fehler/Warnung/Hinweis) mit Quelle, Klick springt zum Raum.
5. **Ausgaben**: Raumlayouts (Bauherr) und Ausführungsplan (Elektriker) als Druckvorschau → „Drucken / als PDF speichern“.
6. **Versionen & Protokoll**: benannte Stände („Stand 28.10.“) sichern und wiederherstellen, Änderungsprotokoll. Rückgängig/Wiederholen mit Strg+Z / Strg+Y.

### Bezugssystem (wichtig gegen Verwechslungen)

* Jeder Raum hat einen **Nullpunkt** (Ecke 1, rot markiert mit Achsen x/y).
* Ecken und Wände sind **im Uhrzeigersinn** nummeriert. Wand *n* läuft von Ecke *n* nach Ecke *n+1*.
* Jeder Abstand auf einer Wand gilt **ab der linken Ecke beim Blick von innen auf diese Wand**. Jede Wandabwicklung zeigt „◀ links: Ecke n“ und „rechts: Ecke n+1 ▶“.
* Höhen gelten über dem **Höhenbezug des Projekts** (z. B. „OK Estrich Bestand“). Der künftige Bodenaufbau je Raum wird eingerechnet; Tabellen zeigen beide Werte (über Bezug / über FFB).
* Räume haben eine **neue Bezeichnung** und die **Bezeichnung im Bestandsplan**. Beide erscheinen in Navigation, Übersicht und Ausdrucken.

## Architektur

```
src/core/              reine TypeScript-Logik, ohne Browser-Abhängigkeit (läuft auch in Node)
  model/schema.ts      Datenmodell (Zod) = die einzige Datenquelle, versioniert (SCHEMA_VERSION)
  model/factory.ts     Anlegen, Laden, Migrieren, Referenzprüfung
  model/labels.ts      deutsche Bezeichnungen
  model/catalog.ts     Möbel-/Gerätekatalog, Schalterprogramme
  geometry/room.ts     Wände aus Polygon, Bezugssystem, Dosenmitten, Höhenumrechnung
  rules/normValues.ts  Norm- und Praxiswerte mit Quelle und Kennzeichen „vom Elektriker zu bestätigen“
  rules/rules.ts       Regelbasis (reine Funktionen) + runRules()
  render/plan.ts       Draufsicht und Geschossübersicht als SVG-String
  render/elevation.ts  maßstäbliche Wandabwicklung als SVG-String
  docs/tables.ts       Dosentabelle, Stromkreisliste, Einsatz-Stückliste
  docs/documents.ts    Druckdokumente A4 quer als HTML (Browser-Druck und Playwright-PDF)
src/app/               React-Oberfläche (Vite)
  store.ts             Projektzustand, Undo/Redo, Änderungsprotokoll, Autospeichern
examples/keller.ts     Beispielprojekt als Code → examples/kellerwohnung.json
scripts/               Beispiel bauen, JSON Schema, PDF-Export
tests/                 Vitest
```

Grundsätze:

* **Eine Datenquelle.** Pläne, Tabellen und Prüfungen werden bei jeder Änderung neu aus dem Projekt berechnet. Nichts wird von Hand gepflegt. Ein Test prüft, dass eine verschobene Dose in allen Ausgaben ankommt.
* **Gleicher Renderer für Bildschirm und Druck.** Die SVG-Generatoren liefern Strings. Die App zeigt sie interaktiv an (Auswahl, Ziehen, Tooltips über `<title>`, Ebenen ein/aus, hell/dunkel über CSS-Variablen). Der PDF-Export nutzt sie unverändert.
* **Regeln getrennt von der Oberfläche.** Jede Regel hat eine ID, eine Quelle (Norm oder „Praxisregel“), einen Bestätigungsvermerk und verständliche Meldungen.
* **Nichts erfinden.** Unsichere oder versionsabhängige Normwerte stehen zentral in `normValues.ts`, sind gekennzeichnet und pro Projekt überschreibbar (Projekt → Norm- und Praxiswerte).

### Eine Regel ergänzen

1. Bei Bedarf einen Wert in `src/core/rules/normValues.ts` anlegen (Schlüssel, Wert, Einheit, Quelle, `confirm`).
2. In `src/core/rules/rules.ts` ein Objekt zu `RULES` hinzufügen: `id`, `title`, `source`, `confirm`, `scope` (`projekt` | `raum` | `auslass`) und `check()`. `check()` gibt eine Liste `{ severity, message }` zurück.
3. Einen Test in `tests/rules.test.ts` schreiben (Positiv- und Negativfall).

### Das Datenmodell ändern

1. `src/core/model/schema.ts` anpassen und `SCHEMA_VERSION` erhöhen.
2. In `src/core/model/factory.ts` unter `migrations` eine Funktion von der alten zur neuen Version ergänzen. Alte Projektdateien bleiben so ladbar.
3. `npm run example && npm run schema && npm test`.

### Einen Baustein ergänzen (ab Etappe 2)

Bausteine wie Bad, Küche, Heimkino, Garage, Garten und Unterverteilung werden Funktionen in `src/core/planning/`. Sie erhalten Raum und Projekt und liefern Vorschläge (Auslässe, Stromkreise, Hinweise). Der Nutzer übernimmt, verschiebt oder löscht die Vorschläge. Gespeichert wird nur, was übernommen wurde.

## Beispielprojekt „Kellerwohnung mit Garage“

Raummaße aus der Aufgabenstellung: Flur 438 × 125 × 225, Bad 182 × 317 mit Vorwand (Dusche raumhoch, WC/Waschtisch 120), Küche 235 × 331 mit Kaminwange 54 × 38 und Installationsvorwand, Heimkino 347,7 × 486,2 × 223,4 mit 60-cm-Baffle-Wall und 7.1.4, Partyraum/Büro 341 × 472,5, Büro/Gäste 283,7 × 471,9. Wände Bims, Decke Hourdis (nicht schlitzbar), Estrich mit Folie in 5–6 cm, Bodenschlitze max. 2,5 cm. Hauptverteilung mit 9× B16 und 3× B10 frei. Dazu Technikraum (HV), Kellerraum mit Unterverteilung und Gartenzuleitung, Garage (Aufputz) mit Wallbox, Torantrieb, Sektionaltor-Bereich und T30-Tür.

**Annahmen:** Lage der Räume zueinander, Türen, Fenster, Vorwand-Abschnitte, Bestandsbezeichnungen und die Räume Technik/Kellerraum/Garage sind angenommen und als „Annahme“ markiert. Sie werden durch den echten Grundriss ersetzt.

## Was fehlt / vereinfacht

**Etappe 1 (vorhanden):** Datenmodell mit Versionierung, Migration und JSON Schema; Projekt-, Verteilungs- und Raumerfassung (Rechteck und Polygon, Türen, Fenster, Vorwände mit Abschnittshöhen, Tabuzonen, Boden- und Deckenaufbau, Hindernisse, Bestandsleitungen, Möbel); Auslässe manuell mit Mehrfachdosen und Konvention; Draufsicht, Geschossübersicht, Wandabwicklungen; Dosentabelle, Stromkreisliste (manuell), Einsatz-Stückliste; 16 Regeln; Druck/PDF; Undo/Redo, Versionen, Protokoll; Smart-Home-Grundeinstellungen.

**Noch nicht umgesetzt:**

* Etappe 2: automatische Auslass-Vorschläge aus Nutzung und Möbeln, automatischer Stromkreisvorschlag, **Leitungstrassen** (Wandschlitze in Zonen, Bodenschlitz-Trassen kreuzungsfrei mit Abstand vor der Wand, Vorwand/Aufputz/Hohlräume, Durchbrüche, Brandschutz-Abschottungen), **Schlitzplan**, Leitungslängen und Spannungsfall, Leerrohr-Prüfung gegen Steckergröße.
* Etappe 3: Material- und Bestellliste mit Gebinden und Preisen (XLSX/CSV/PDF), Kostenschätzung, Aufgaben- und Prüfliste für die Bauphase.
* Etappe 4: vollständige Regelmodule (VDE 0100-701 Bad-Schutzbereiche, -520 Strombelastbarkeit, -420 AFDD, -443/-534 SPD, -722 E-Mobilität, Erdverlegung, Abstände/Bewegungsflächen, Beleuchtungsstärke) und ein Prüfprotokoll zum Abzeichnen.
* Etappe 5: Fotos je Wand/Raum, Grundriss-Upload als Hintergrund zum Nachzeichnen, **KI-Auswertung (Claude-API)** von Fotos, Plänen und Freitext mit Bestätigung, Bausteine Heimkino (Lautsprecherwinkel, Throw Ratio), Garage, Garten, Unterverteilung.

**Vereinfachungen in Etappe 1:**

* Türen werden je Raum erfasst. Eine Tür zwischen zwei Räumen steht in beiden Räumen getrennt; die beiden Einträge werden noch nicht verknüpft.
* Die Wanddicke ist im Plan nur symbolisch gezeichnet. Die Lage der Räume im Geschoss dient nur der Orientierung.
* Die Rauchwarnmelder-Regel erkennt Schlaf-, Kinder- und Flurräume am Namen und an der Nutzung, nicht an einer genauen Auswertung der jeweiligen Landesbauordnung.
* Die Installationszonen-Regel prüft die Lage der Dose, aber noch nicht den Leitungsweg (der kommt mit den Trassen).
* Die Normwerte stammen aus allgemein zugänglichen Darstellungen. Die Normtexte sind nicht hinterlegt. Alle mit ⚠ gekennzeichneten Werte muss die Elektrofachkraft bestätigen.
* Der Browser-Druck setzt Seitenzahlen fest pro Seite. Wird eine Tabelle zu lang, wird sie auf Folgeseiten verteilt (feste Zeilenanzahl).
