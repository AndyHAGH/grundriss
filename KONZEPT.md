# Konzept / Pflichtenheft – „Grundriss“ (einfaches 2D-CAD für Bestandspläne)

Stand: 2026-11-15 · Status: **Entwurf – wartet auf Freigabe**

## 1. Planung

**Ziel:** Bestandsgrundrisse schnell und ohne CAD-Vorwissen zeichnen und als PNG/JPEG für Home Assistant
(z. B. `picture-elements`-Karte) exportieren.

**Kernidee (vom Auftraggeber):** Zeichnen in Stufen – erst grob skizzieren, dann schrittweise präzisieren:
Skizze → Winkel → Wanddicken → Maße → Fenster/Türen → Einrichtung → Vorschau/Export.

**Nutzen:** Kein Konstruieren „auf Anhieb maßgenau“ nötig; der Plan wird mit jedem Schritt richtiger.

**Machbarkeit:** Gut machbar als Web-App (PWA). Läuft im Browser auf iPad (Safari), Mac und Windows,
offline-fähig, installierbar auf dem Home-Bildschirm. Keine App-Store-Hürde.

**Aufwand (grob):** MVP (Stufen 1–4 + Export) ca. 3–4 Ausbaurunden; Öffnungen, Möbel, Etagen je eine weitere.

**Risiken:**
- *Maß-Löser (Stufe 4):* Werden Maße eingegeben, die sich widersprechen (z. B. geschlossener Umriss, Summe
  der Teilmaße ≠ Gesamtmaß), muss das Programm den Konflikt verständlich anzeigen statt den Plan zu verziehen.
  → Lösung: Wände mit Maß werden „fixiert“ (grün), widersprüchliche Wand rot markiert.
- *Touch-Bedienung iPad:* Kleine Ziele, kein Rechtsklick → große Griffe, Werkzeugleiste, Lupe beim Fangen.
- *Speicherung:* Browser-Speicher ist pro Gerät; für iPad ↔ Mac ist Datei-Export/Import oder ein
  gemeinsamer Speicherort nötig (siehe Fragen).

## 2. Anforderungen

### Funktional (User Stories, in Arbeitsreihenfolge)

| Stufe | Als Nutzer möchte ich … |
|---|---|
| 1 Skizze | … mit Tippen/Klicken gerade Linien als Wandzug ziehen (Endpunkt = Startpunkt der nächsten Wand), Umriss schließen, Innenwände an bestehende Wände andocken. Keine Maße nötig. |
| 2 Winkel | … per Knopf „Winkel ausrichten“ alle fast-rechten Winkel auf exakt 90°/180° setzen lassen; einzelne Ecken manuell auf einen Winkel (z. B. 45°, 135°) festlegen. |
| 3 Wanddicke | … Wände antippen (auch mehrere) und Dicke wählen: Vorlagen Außenwand 36,5 / Innenwand 24 / 11,5 cm, frei eingebbar. Ausrichtung innen/mittig/außen. |
| 4 Maße | … eine Wand antippen und ihr Maß (cm) eingeben; der Plan passt sich an. Fixierte Maße bleiben erhalten. Konflikte werden angezeigt. Maßketten werden automatisch angezeigt. |
| 5 Öffnungen | … Tür/Fenster auf eine Wand ziehen, Breite + Abstand zur Ecke eingeben. **Tür:** Wand wird ausgeschnitten, Türblatt mit Aufschlagbogen, Anschlag links/rechts/innen/außen. **Fenster:** Wand wird mit Fenstersymbol überlagert. Weitere: Durchgang (ohne Tür), Schiebetür, Terrassentür. |
| 6 Einrichtung | … Möbel, Sanitär, Küche, Pflanzen aus einer Bibliothek platzieren, verschieben, drehen, skalieren. Räume benennen (Fläche wird automatisch berechnet). Texte setzen. |
| 7 Vorschau | … eine saubere Ansicht ohne Maße/Hilfslinien sehen und als PNG/JPEG exportieren (Größe, Hintergrund wählbar). |

### Standard-CAD-Funktionen (stufenübergreifend)
- Zoomen/Verschieben (Mausrad, Pinch-Zoom, Zwei-Finger-Pan)
- Rückgängig/Wiederholen (beliebig viele Schritte)
- Fangen (Endpunkte, Wandmitte, Raster, Winkel 15°-Schritte), Raster ein/aus
- Auswählen, Verschieben, Kopieren, Löschen, Mehrfachauswahl
- Messwerkzeug (Abstand zweier Punkte)
- Ebenen ein-/ausblenden (Wände, Maße, Öffnungen, Möbel, Texte)
- Speichern/Laden (automatisch lokal + Projektdatei `.json` zum Austausch)
- Jederzeit zu früheren Stufen zurückspringen (Stufen sind Modi, keine Einbahnstraße)

### Nicht-funktional
- Geräte: iPad (Safari, Finger + Apple Pencil), macOS, Windows (Chrome/Edge/Safari/Firefox)
- Offline nutzbar (PWA), keine Anmeldung, keine Cloud, Daten bleiben lokal (Datenschutz)
- Bedienung: große Schaltflächen, deutsche Oberfläche, pro Stufe nur die nötigen Werkzeuge sichtbar
- Tempo: flüssig bei typischem Einfamilienhaus (≈ 200 Wände, 300 Objekte)
- Export reproduzierbar: gleicher Plan → gleicher Bildausschnitt/Maßstab (wichtig, damit in HA
  positionierte Sensoren/Icons nach einem Neu-Export an der richtigen Stelle bleiben)

## 3. Entwurf

### Optionen zur Technik

| Option | Beschreibung | Bewertung |
|---|---|---|
| **A – PWA (HTML/JS, SVG-Zeichnung)** | Eine Web-App, statisch gehostet; läuft überall im Browser | **Empfohlen.** Ein Code für alle Geräte, offline, kein Store, einfach aktualisierbar |
| B – Native Apps / Electron | Getrennte Apps bzw. Desktop-Hülle | iPad nur über App Store, hoher Aufwand – nicht sinnvoll |
| C – Fertiges Programm (z. B. Sweet Home 3D, Floorplanner) | Vorhandene Software nutzen | Kein Entwicklungsaufwand, aber nicht der gewünschte Stufen-Ablauf, iPad-Unterstützung schwach |

### Datenmodell (Kern)
```
Projekt { name, etagen[] }
Etage   { name, knoten[], waende[], oeffnungen[], objekte[], raeume[], texte[] }
Knoten  { id, x, y }                         // cm
Wand    { id, von, bis, dicke, ausrichtung, laengeFix?: cm, winkelFix? }
Oeffnung{ id, wand, typ: tuer|fenster|durchgang|schiebetuer, abstand, breite, anschlag }
Objekt  { id, symbol, x, y, drehung, breite, tiefe }
Raum    { id, name, punkt }                  // Fläche wird aus Wänden ermittelt
```
Wände hängen an gemeinsamen Knoten → verschiebt sich ein Knoten, gehen alle Wände mit (Grundlage für Stufen 2 + 4).

### Maß-Löser (Stufe 2 + 4)
Iterativer Zwangsbedingungs-Löser: Winkel- und Längenvorgaben werden als Bedingungen gespeichert und
gemeinsam erfüllt; nicht fixierte Wände geben nach. Erfüllt der Löser eine Bedingung nicht → rote Markierung
+ Hinweis „Maß widerspricht Wand X“.

### Bedienung (Skizze)
```
┌──────────────────────────────────────────────────────────┐
│ [1 Skizze][2 Winkel][3 Dicke][4 Maße][5 Fenster/Türen]   │  ← Stufen-Leiste
│ [6 Einrichtung][7 Vorschau]          ↶ ↷  💾  Etage: EG ▾ │
├────────┬─────────────────────────────────────────────────┤
│Werkzeug│                                                 │
│ ✎ Wand │          Zeichenfläche (Zoom/Pan)               │
│ ⬚ Wähle│                                                 │
│ 📏 Mess│                                                 │
│        │                                                 │
├────────┴─────────────────────────────────────────────────┤
│ Eigenschaften der Auswahl: Länge [ 412 ] cm  Dicke [36,5]│  ← unten, groß für Touch
└──────────────────────────────────────────────────────────┘
```
Die linke Werkzeugleiste und die Eigenschaftsleiste wechseln je Stufe ihren Inhalt.

### Dateien
- `index.html`, `app.js` (bzw. Module unter `src/`), `style.css`, `manifest.json`, `sw.js` (offline),
  `symbols/` (Möbelsymbole als SVG), `README.md`

### Umsetzungsrunden (Vorschlag)
1. **v0.1** Grundgerüst, Zoom/Pan, Stufe 1 Skizze, Undo, Speichern/Laden, PNG-Export
2. **v0.2** Stufe 2 Winkel + Stufe 3 Wanddicken (saubere Eckverbindungen)
3. **v0.3** Stufe 4 Maße mit Löser + Maßketten
4. **v0.4** Stufe 5 Türen/Fenster
5. **v0.5** Stufe 6 Einrichtung, Räume, Texte; Stufe 7 Vorschau/Export-Optionen
6. **v0.6** Etagen, Feinschliff iPad, PWA-Installation

## 4. Entscheidungen (2026-11-15)
- Freigabe: Option A (PWA)
- Austausch zwischen Geräten: einfach halten, Projektdatei `.json` speichern/öffnen
- Hosting: GitHub (Pages)
- Etagen: immer nur ein Abschnitt pro Projekt (keine Etagenverwaltung)
- Export: vorerst nur PNG in voreingestellter Größe (2000 px breit); Hintergrund in der App einstellbar
  (Farbe oder transparent)
- Raumnamen/Flächen: nur beim Zeichnen sichtbar, nicht im Export
- Eingabe: zuerst nur **Windows-PC** (Maus). iPad mit Apple Pencil kommt später und ist vorbereitet:
  Pointer-Events für Maus/Stift/Touch, große Bedienelemente, keine Rechtsklick-Pflicht.
- Möbel: einfache 2D-Symbole in Draufsicht
