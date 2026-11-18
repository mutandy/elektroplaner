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

Danach <http://localhost:5173> öffnen. Beim ersten Start erscheint eine Willkommensseite: **Neues Projekt beginnen** startet den Assistenten, außerdem lässt sich eine Projektdatei öffnen oder das Beispiel „Kellerwohnung mit Garage“ ansehen. Änderungen werden automatisch im Browser gespeichert (IndexedDB). Über „Speichern als Datei“ entsteht eine Projektdatei (`*.elektroplan.json`), die sich mit „Öffnen“ wieder laden lässt.

Weitere Befehle:

| Befehl | Zweck |
|---|---|
| `npm test` | Tests (Datenmodell, Geometrie, Regeln, Rendering-Snapshots, Dokumente) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run build` | statische App nach `dist/` (läuft ohne Server, z. B. von USB-Stick oder Webspace) |
| `npm run example` | `examples/kellerwohnung.json` aus `examples/keller.ts` neu erzeugen |
| `npm run schema` | Datenmodell als JSON Schema nach `schema/` exportieren |
| `npm run pdf -- projekt.json ausgabeordner` | alle Dokumente als PDF (A4 quer) über Chromium plus Materialliste als CSV/XLSX; braucht einmalig `npm i -D playwright && npx playwright install chromium` |

Die fertigen Ausgaben des Beispielprojekts liegen in [`beispiel-ausgaben/`](beispiel-ausgaben/).

## Bedienung in Kürze

### Assistent (Start bei Null)

Ein neues Projekt beginnt immer im Assistenten. Er fragt Schritt für Schritt und macht erst danach Empfehlungen:

1. **Projekt:** Art des Vorhabens, Gebäude und **alle Geschosse mit Geschosshöhe** (Schnellanlage KG/EG/OG/DG), Höhenbezug und üblicher Bodenaufbau, Installationsart und Schalterprogramm, Zähler und Verteilung (freie Sicherungen, FI/RCD, Unterverteilungen), was unverändert bleibt, Smart Home, Netzwerk.
2. **Grundrisse je Geschoss (optional):** Bild hochladen, Maßstab über ein bekanntes Maß festlegen (zwei Punkte anklicken, Länge eingeben).
3. **Räume je Geschoss anlegen:** Bezeichnung im Bestandsplan, künftiger Name, **Nutzung (Raumtyp)**. Mit Grundriss lässt sich jeder Raum darauf aufziehen; Lage und ungefähre Größe werden übernommen.
4. **Je Raum:** zuerst **Nutzung und Verbraucher** (Raumtyp wählen → typische Geräte mit Leistung, z. B. Kochfeld 11 kW Drehstrom, Waschmaschine 2,2 kW mit eigenem Kreis; anpassbar), dann Maße und Höhe (auch Kamin/Vorsprung in einer Ecke), Wände, Türen (Bänder, Aufschlag, Brandschutz), Fenster, Vorwand/Tabuzonen/Hindernisse, Boden (Aufbau, Bodenschlitze, Folientiefe), Decke, **Leitungswege: was ist möglich?**, Möbel und Geräte, Bestandsleitungen (nur im Bestand), Zusammenfassung zum Bestätigen.
5. **Abschluss:** Liste aller offenen Punkte mit Sprung zum jeweiligen Schritt.

Jeder Schritt erklärt unter „Warum wird das gefragt?“, wozu die Angabe dient. „Weiß ich noch nicht – später“ überspringt einen Schritt; der Punkt bleibt als offen markiert. Der Fortschritt wird im Projekt gespeichert. Der Assistent schreibt in dieselben Daten wie die Expertenansicht.

Pläne sind oft nicht maßhaltig (Foto schräg, Zeichnung ungenau). Deshalb nutzt das Programm den Grundriss nur als Vorlage für die Lage. Verbindlich sind die vor Ort gemessenen Maße, die im Schritt „Maße und Höhe“ abgefragt werden.

### Leitungswege: was ist möglich?

Je Raum fragt der Assistent, was baulich geht und was gewünscht ist: Decke abhängen (mit Aufbauhöhe → lichte Höhe danach gegen die Mindesthöhe der Landesbauordnung), Estrichdicke und Lage von Folie/Dämmung (→ mögliche Bodenschlitztiefe gegen die nötige Tiefe), Aufputz sichtbar ok?, Sockelleisten-Kabelkanal ok?, waagerechte Wandschlitze je Wand. Daraus bewertet das Programm jeden Weg mit ✔/?/✖ und Begründung (z. B. „Decke abhängen: lichte Höhe danach 213,9 cm < 240 cm – Raum wird zu niedrig“) und empfiehlt den sinnvollsten; du bestätigst oder wählst einen anderen. Die Antworten lassen sich auf alle Räume eines Geschosses übertragen. Der Schlitzplan zeigt die Abwägung je Raum.

### Empfehlungen (Etappe 2)

Nach der Erfassung schlägt das Programm vor – nichts davon wird ohne Zustimmung übernommen:

* **Auslässe:** Schalter an jeder Tür (Griffseite, 15 cm neben Zarge; bei 3+ Türen Taster), Deckenlicht, Rauchwarnmelder, Steckdosen/Anschlüsse aus Möbeln und Geräten (Bett, Schreibtisch, TV, Rack, Küchenzeile, Kühlschrank, Spülmaschine, Herd, Waschtisch, Werkbank, Waschmaschine, Wallbox, Beamer …), fehlende Steckdosen je Wand nach Ausstattungswert. Positionen meiden Türöffnung, Türblatt, Fenster, Tabuzonen und Ecken; in Vorwänden wird automatisch die Hohlwanddose gewählt. Jeder Vorschlag wird vorab gegen die Regeln geprüft.
* **Stromkreise:** Großgeräte und Drehstrom eigener Kreis, Küche zwei Arbeitsflächenkreise, Bad und AV/Technik getrennt, Steckdosen je Raum (max. 8 Plätze), Licht getrennt (bis 3 Räume), Außenbereich mit Erdkabel, Wallbox mit eigenem RCD. Verteilung auf RCDs (max. 4 je RCD, Licht und Steckdosen eines Raums möglichst getrennt), Abgleich mit den freien LS; fehlende LS und RCD werden benannt.
* **Leitungswege je Raum:** nach der Machbarkeit (siehe oben) – Bodenschlitz, Decke/Hohlraum, abgehängte Decke, Sockelleistenkanal, waagerechte Wandschlitze oder Aufputz (je Raum änderbar). Alle Leitungen kommen an einer Einspeisung neben der Haupttür an (Durchbruch, bei Brandabschnitt mit Abschottungshinweis) und laufen auf einer gemeinsamen Trasse nebeneinander – dadurch kreuzungsfrei und einlagig. Bodenschlitze 12 cm vor der Wand, senkrechte Stiche zu den Dosen; in Vorwänden/Baffle-Wänden im Hohlraum ohne Schlitz, darüber Schlitz ab Vorwand-Oberkante; Lautsprecher sternförmig zum AV-Rack; waagerechte Wandschlitze nicht in Stürze; Aufputztrasse bei niedrigen Räumen knapp über dem höchsten Sturz.
* **Schlitzmaße** aus den Kabeldurchmessern (Breite = Summe + Abstände, Tiefe = dickstes Kabel + Überdeckung), geprüft gegen die erlaubte Bodenschlitztiefe und die Schlitztiefen ohne statischen Nachweis.
* **Leitungslängen** je Verbindung (Kette Verteilung → Raum → Auslass → Auslass, LAN sternförmig zum Netzwerkschrank) inkl. Reserven und Zuschlag; **Spannungsfall** je Stromkreis (konservativ mit Nennstrom am Kreisende).

### Material, Kosten, Aufgaben (Etappe 3)

* **Material- und Bestellliste**, gruppiert: Kabel und Leitungen, Dosen, Schalterprogramm (Rahmen nach Fachzahl), Klemmen und Kleinmaterial, Verteiler und Schutzgeräte, Netzwerk/Multimedia/Smart Home, Leuchten und Geräte, Werkzeug und Miete. Bedarf aus Plan, Leitungswegen (Schlitzvolumen → Mörtel/Gips, Aufputzrohr, Schellen, Durchbrüche) und Leitungslängen; Bestellmenge auf Gebinde aufgerundet; Richtpreise (änderbar), Summen je Gruppe, Abhaken, eigene Positionen. Export als **XLSX** (drei Blätter, Summenformeln), **CSV** (Semikolon, für Excel) und **PDF**.
* **Kostenschätzung** nach Gewerken mit Spanne: Material, Schlitzen/Bohren, Dosen/Aufputz, Kabel, Schließen, Elektrofachkraft (Verteiler, Anschluss, Erstprüfung), Brandschutz, Ausbessern, Entsorgung, Unvorhergesehenes. Umschaltbar: Vorarbeiten in Eigenleistung oder durch Handwerker; Stundensätze änderbar. Ausdrücklich ein Richtwert.
* **Aufgaben- und Prüfliste** in zehn Bauphasen (Vorbereitung bis Abnahme) mit Haltepunkten (z. B. Fotos und Isolationsmessung vor dem Verschließen), Zuständigkeit (Eigenleistung/Elektrofachkraft/Fachbetrieb), Abhaken und Notizen; Prüfaufgaben für jede Bestandsleitung.

### Leistungsbedarf und Normprüfung (Etappe 4)

* **Leistungsbedarf:** Verbraucher je Raum mit Leistung und Phasen; Summe je Raum, Last je Stromkreis (gegen den LS), installierte und geschätzt gleichzeitige Leistung gegen die Hauptsicherung. Großverbraucher bekommen einen Anschlussvorschlag und im Stromkreisvorschlag einen eigenen, passend dimensionierten Kreis (z. B. Durchlauferhitzer 21 kW → B32, 5×6 mm²).
* **Normmodule** (alle Werte konfigurierbar, ⚠ = vom Elektriker zu bestätigen):
  * DIN VDE 0100-701 Bad: Schutzbereiche 1 und 2 aus Dusche/Wanne (keine Steckdosen/Schalter, IPX4-Hinweise), RCD für alle Badstromkreise.
  * DIN VDE 0100-520 / 0298-4: Strombelastbarkeit nach Verlegeart (C im Mauerwerk, B2 im Rohr/Hohlraum) und Häufung im gemeinsamen Schlitz/Rohr; Spannungsfall.
  * DIN VDE 0100-420: AFDD-Hinweis für Schlafräume.
  * DIN VDE 0100-443/534: Überspannungsschutz.
  * DIN VDE 0100-722: Wallbox mit eigenem Kreis, RCD-Typ, Anmeldung/Genehmigung beim Netzbetreiber.
  * Erdverlegung: kein NYM in der Erde, Tiefe/Warnband/Sandbett.
  * DIN 18015-2 / RAL-RG 678: Mindestausstattung (Steckdosen, Licht) nach Raumtyp, Fläche und Ausstattungswert.
  * Landesbauordnung: Rauchwarnmelder nach Raumtyp.
* **Regelübersicht** (Status je Regel) und **Prüfprotokoll** als Druckdokument: Anlagendaten und Leistungsbilanz, Planungsprüfung zum Abzeichnen, Leitungsdimensionierung, leeres Messprotokoll je Stromkreis für die Erstprüfung nach DIN VDE 0100-600, Unterschriften. Normwerte lassen sich unter Projekt → Norm- und Praxiswerte von der Elektrofachkraft als bestätigt eintragen.

### Etappe 5: KI, Fotos, Heimkino, Licht, Abstände

* **KI-Unterstützung (optional, Claude-API):** unter Projekt → „KI-Unterstützung“ einen eigenen API-Schlüssel eintragen. Er wird nur im Browser gespeichert (nicht in der Projektdatei); Bilder und Texte gehen für die Auswertung an die Claude-API (Modell `claude-opus-5-5`, strukturierte JSON-Antwort, bei Ablehnung serverseitige Ausweichlösung `fallbacks: "default"`). Funktionen – jeweils mit Prüftabelle vor der Übernahme:
  * **Räume aus dem Grundriss lesen:** Bezeichnungen wie im Plan, Maße laut Bemaßung, Lage im Bild → mit Maßstab direkt Lage und Größe; künftigen Namen eintragen, auswählen, anlegen (als „aus Plan“ markiert).
  * **Foto der Verteilung auslesen:** LS (Charakteristik, Nennstrom, Polzahl), FI/RCD, SPD, freie Teilungseinheiten → in die Verteilung übernehmen (von der Elektrofachkraft zu bestätigen).
  * **Raum in eigenen Worten beschreiben:** → Raumtyp, Geräte mit Leistung, Möbel an der genannten Wand, Wünsche und offene Fragen.
* **Fotos** je Raum (einer Wand zugeordnet, beschriftet) und je Verteilung; im Ausführungsplan als Anhang je Raum.
* **Heimkino-Baustein:** Layout (5.1 bis 9.1.4), Leinwandwand, Hörabstand, Ohrhöhe, Bildbreite, Projektionsverhältnis → Lautsprecherpositionen nach gängigen Dolby-Winkeln (Front ±27°, Surround ±100°/110°, Rear ±142°, Front Wide ±60°, Höhen in Linie mit Front L/R bei 30–55° Elevation), Prüfung der Winkel, Beamer-Abstand und Bildhöhe; fehlende Kanäle erscheinen als Auslass-Vorschläge.
* **Beleuchtung:** Lichtstrom je Raum aus Lux-Ziel (Raumtyp) × Fläche / Nutzungsfaktor 0,5 → empfohlene Anzahl Leuchten (Lichtstrom je Leuchte einstellbar), Hinweis bei zu wenigen Lichtauslässen.
* **Abstände:** Möbel und Einbauten im Türaufschlag werden gemeldet.

### Expertenansicht

1. **Projekt**: Projektart, Bundesland, Höhenbezug, Standardhöhen, Schalterprogramm (Standard: Merten System M, frei änderbar), **Smart Home** (aus/ein, System: KNX, Home Assistant, Shelly, Zigbee, Matter/Thread, Homematic IP, gemischt; mit Erklärung, was das für die Leitungsplanung bedeutet), Geschosse und Räume.
2. **Verteilung & Stromkreise**: Hauptverteilung und Unterverteilungen mit freien LS und RCDs, Stromkreise mit Zuordnung.
3. **Räume**, Raum für Raum in vier Schritten: *Bauliches* (Grundriss, Wände, Vorwand-Abschnitte mit eigener Höhe, Kaminwange/Tabuzonen, Türen, Fenster, Boden- und Deckenaufbau, Hindernisse, Bestandsleitungen), *Einrichtung* (Möbel/Geräte), *Auslässe* (Schnellanlage, Detailformular, Verschieben per Maus in Draufsicht und Wandabwicklung), *Zusammenfassung* (offene Fragen, Regelprüfung, „Raum bestätigen“).
4. **Prüfung**: alle Regelmeldungen (Fehler/Warnung/Hinweis) mit Quelle, Klick springt zum Raum.
5. **Material, Kosten, Aufgaben** (siehe oben). **Ausgaben**: Raumlayouts (Bauherr), Ausführungsplan (Elektriker, mit Stromkreisliste inkl. Länge/ΔU und Leitungsliste) und Schlitzplan (Regeln, Werkzeug, Summen, je Raum Bodenschlitze, Wandschlitze, Bohrungen, Durchbrüche, Wandabwicklungen mit Schlitzen) als Druckvorschau → „Drucken / als PDF speichern“.
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
  model/schema.ts      Datenmodell (Zod) = die einzige Datenquelle, versioniert (SCHEMA_VERSION, aktuell 2)
  model/factory.ts     Anlegen, Laden, Migrieren, Referenzprüfung
  model/labels.ts      deutsche Bezeichnungen
  model/catalog.ts     Möbel-/Gerätekatalog, Schalterprogramme
  geometry/room.ts     Wände aus Polygon, Bezugssystem, Dosenmitten, Höhenumrechnung
  geometry/edit.ts     Geometrie-Änderungen mit Bezugsnachführung (z. B. Kamin in Ecke ausschneiden)
  wizard/steps.ts      Assistent: Schrittfolge, fehlende Angaben, Fortschritt
  planning/cables.ts   Kabelkatalog (Durchmesser, Gebinde), Leerrohr/Stecker-Prüfung
  planning/suggest.ts  Auslass-Vorschläge
  planning/feasibility.ts  Machbarkeit der Leitungswege je Raum (mit Begründung)
  planning/routes.ts   Leitungswege je Raum: Schlitze, Stiche, Bohrungen, Durchbrüche
  planning/circuits.ts Leitungslängen, Spannungsfall, Stromkreisvorschlag
  planning/prices.ts   Richtpreise (änderbar)
  planning/bom.ts      Material- und Bestellliste
  planning/costs.ts    Kostenschätzung
  planning/tasks.ts    Aufgaben- und Prüfliste
  planning/loads.ts    Leistungsbedarf, Last je Stromkreis, Hauptsicherung
  model/roomTypes.ts   Raumtypen: typische Verbraucher, Mindestausstattung, Lux, Besonderheiten
  rules/norms.ts       Normmodule (Bad, Belastbarkeit, AFDD, SPD, E-Mobilität, Erde, Leistung, Ausstattung)
  export/material.ts   CSV- und XLSX-Export
  ai/tasks.ts          KI-Aufgaben: Antwort-Schemas, Anweisungen, Übernahme ins Projekt (ohne API testbar)
  planning/theater.ts  Heimkino: Lautsprecherwinkel, Beamer-Abstand
  planning/lighting.ts Beleuchtungsabschätzung
src/app/ai/claude.ts   Claude-API-Aufruf aus dem Browser (SDK, strukturierte Ausgabe, Fehlerbehandlung)
src/app/ai/AiPanels.tsx KI- und Foto-Bausteine der Oberfläche
  rules/normValues.ts  Norm- und Praxiswerte mit Quelle und Kennzeichen „vom Elektriker zu bestätigen“
  rules/rules.ts       Regelbasis (reine Funktionen) + runRules()
  render/plan.ts       Draufsicht und Geschossübersicht als SVG-String
  render/elevation.ts  maßstäbliche Wandabwicklung als SVG-String
  docs/tables.ts       Dosentabelle, Stromkreisliste, Einsatz-Stückliste
  docs/documents.ts    Druckdokumente A4 quer als HTML (Browser-Druck und Playwright-PDF)
src/app/               React-Oberfläche (Vite)
  store.ts             Projektzustand, Undo/Redo, Änderungsprotokoll, Autospeichern
  wizard/Wizard.tsx    Assistent (ein Formular je Schritt)
  components/PlanTracer.tsx  Grundriss hochladen, kalibrieren, Räume aufziehen
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

Grundlage ist der Bestandsplan Kellergeschoss (18,00 × 10,50 m) und das Aufmaß vor Ort. Die Wände sind aus Bims, die Decke ist Hourdis (nicht schlitzbar). Der Boden ist Estrich mit Folie in 5–6 cm Tiefe, Bodenschlitze maximal 2,5 cm. In der Hauptverteilung sind 9× B16 und 3× B10 frei.

| Neuer Raum | Bestandsplan | Aufmaß (cm) |
|---|---|---|
| Flur | FLUR (schraffiert) | 438 × 125 × 225 |
| Bad | KELLER ④ | 182 × 317, Vorwand: Dusche raumhoch, WC/Waschtisch 120 |
| Küche | WASCH.+TROCKNEN ③ | 235 × 331, Kaminwange 54 × 38 unten links (im Plan nicht eingezeichnet), Installationsvorwand |
| Heimkino | KELLER ③ oben rechts | 347,7 × 486,2 × 223,4, Baffle-Wall 60 cm, 7.1.4 |
| Partyraum / Spielzimmer | KELLER ③ unten rechts | 341 × 472,5 |
| Büro / Gäste | KELLER ① | 283,7 × 471,9 |

**Noch angenommen** (im Projekt als „Annahme“ markiert): der Standort der Hauptverteilung (Raum HEIZUNG), die Tür zum Treppenhaus und die Tür zum Partyraum, der Kellerraum mit Unterverteilung und Gartenanschluss (KELLER 1,80 × 3,38), die Garage (GARAGE ②) und alle Brüstungshöhen. Die Farben und Kreisnummern im Bestandsplan haben keine Bedeutung.

## Was fehlt / vereinfacht

**Etappe 1 (vorhanden):** Datenmodell mit Versionierung, Migration und JSON Schema; Projekt-, Verteilungs- und Raumerfassung (Rechteck und Polygon, Türen, Fenster, Vorwände mit Abschnittshöhen, Tabuzonen, Boden- und Deckenaufbau, Hindernisse, Bestandsleitungen, Möbel); Auslässe manuell mit Mehrfachdosen und Konvention; Draufsicht, Geschossübersicht, Wandabwicklungen; Dosentabelle, Stromkreisliste (manuell), Einsatz-Stückliste; 16 Regeln; Druck/PDF; Undo/Redo, Versionen, Protokoll; Smart-Home-Grundeinstellungen.

**Noch nicht umgesetzt:**

* Etappe 2 (Rest): Leerrohre als eigene Trasse mit Stecker-Prüfung in der Oberfläche (die Prüffunktion gibt es schon), Leitungswege zwischen Räumen (heute Schätzung über die Lage im Geschoss), Schaltdrähte Schalter → Leuchte bei Bestands-Deckenauslässen.
* Etappe 4 (Rest): Abstände/Bewegungsflächen (Möbel, Türaufschlag), Beleuchtungsstärke-Abschätzung je Raum (Lux-Ziele sind je Raumtyp hinterlegt), Selektivität.
* Etappe 5 (Rest): von Fotos, Plänen und Freitext mit Bestätigung, Bausteine Heimkino (Lautsprecherwinkel, Throw Ratio), Garage, Garten, Unterverteilung.

**Vereinfachungen:**

* Der Grundriss wird nur als Bild genutzt (JPG/PNG; PDF bitte als Foto oder Screenshot). Er wird nicht entzerrt; Räume werden als achsparallele Rechtecke aufgezogen.

* Türen werden je Raum erfasst. Eine Tür zwischen zwei Räumen steht in beiden Räumen getrennt; die beiden Einträge werden noch nicht verknüpft.
* Die Wanddicke ist im Plan nur symbolisch gezeichnet. Die Lage der Räume im Geschoss dient nur der Orientierung.
* Die Rauchwarnmelder-Regel nutzt den Raumtyp (Schlafen, Kinder, Gäste, Flur), nicht eine genaue Auswertung der jeweiligen Landesbauordnung.
* Schutzbereiche im Bad werden aus der Dusch-/Wannenfläche im Grundriss bestimmt; bei bodengleichen Duschen reicht Bereich 1 bis 120 cm um den Brausekopf – vor Ort prüfen.
* Gleichzeitige Leistung ist eine einfache Schätzung (größter Verbraucher voll, weitere anteilig), keine Bemessung nach DIN 18015-1.
* Leitungen zwischen Geschossen werden über die Geschosshöhen und die Lage im Grundriss geschätzt; die Grundrisse verschiedener Geschosse müssen dafür übereinander ausgerichtet sein (gleicher Nullpunkt).
* Leitungswege werden je Raum berechnet; zwischen Räumen und zur Verteilung schätzt das Programm die Länge rechtwinklig über die Lage im Geschoss (in Listen als „Schätzung“ markiert).
* Innerhalb eines Stromkreises wird eine Kette Auslass → Auslass angenommen (Reihenfolge nach Entfernung von der Einspeisung).
* Kabeldurchmesser und Gebinde sind typische Herstellerwerte; maßgeblich ist das Datenblatt.
* Preise sind Richtwerte (Ende 2026) ohne Händleranbindung; Stundenaufwände sind Erfahrungswerte. Leuchten erscheinen als Platzhalter.
* Schalterprogramm: Einsätze werden als „Einsatz mit Abdeckung“ gezählt; bei Serien mit getrennter Wippe/Zentralplatte vor der Bestellung zuordnen.
* KI: Die Claude-API wird direkt aus dem Browser aufgerufen (für die lokale Nutzung mit eigenem Schlüssel gedacht – die App so nicht öffentlich mit einem fremden Schlüssel betreiben). Ergebnisse sind Vorschläge; Pläne sind oft verzerrt, Maße aus dem Plan immer mit dem Aufmaß prüfen.
* Heimkino: Positionen nach Faustformeln; Raumakustik, Sitzreihen und Lautsprecher-Abstrahlung werden nicht simuliert.
* Beleuchtung: Wirkungsgrad stark vereinfacht (fester Nutzungsfaktor), keine Lichtberechnung nach Normverfahren.
* Die Normwerte stammen aus allgemein zugänglichen Darstellungen. Die Normtexte sind nicht hinterlegt. Alle mit ⚠ gekennzeichneten Werte muss die Elektrofachkraft bestätigen.
* Der Browser-Druck setzt Seitenzahlen fest pro Seite. Wird eine Tabelle zu lang, wird sie auf Folgeseiten verteilt (feste Zeilenanzahl).
