# Grundriss

Einfaches 2D-CAD im Browser, um Grundrisse von bestehenden Gebäuden zu zeichnen und als PNG für
Home Assistant zu exportieren. Konzept: [KONZEPT.md](KONZEPT.md)

**Version 0.3.1.** Zielgerät ist vorerst ein Windows-PC (Chrome/Edge). Die Bedienung über Pointer-Events ist
für iPad und Apple Pencil vorbereitet.

## Starten
- Lokal: `powershell -ExecutionPolicy Bypass -File tools/serve.ps1` ausführen, dann http://localhost:8765 öffnen.
- Online: über GitHub Pages veröffentlichen (Repository → Settings → Pages → Branch `main`, Ordner `/`).

## Bedienung
| Stufe | Funktion |
|---|---|
| 1 Skizze | **Wand (W):** Punkte nacheinander klicken. Ein erneuter Klick auf den letzten Punkt, Enter oder „Fertig“ beendet den Wandzug. Ein Klick auf einen vorhandenen Eckpunkt (grün) oder eine Wand (orange) verbindet und beendet den Wandzug. **Auswahl (V):** Wand oder Eckpunkt anklicken und ziehen. Wird ein Eckpunkt auf einen anderen gezogen, werden beide verbunden. Entf löscht. **Nullpunkt (N):** Bezugspunkt für die Koordinatenanzeige und das Raster setzen. |
| 2 Winkel | **„Alle Winkel ausrichten“:** Ist der Plan insgesamt schief, wird er zuerst gerade gedreht. Danach werden Wände, die bis zu ±10° von 0°/45°/90°/135° abweichen, exakt ausgerichtet und fixiert. Ecke anklicken → Winkel eingeben oder 90°/135°/45° wählen; „Andere Wand drehen“ tauscht die Wand, die gedreht wird. Wand anklicken → Richtung fixieren oder lösen. Orange markiert, was noch schief bzw. frei ist. |
| 3 Dicke | Wand anklicken (mehrere mit Strg+Klick oder „Mehrfach“, alle mit Strg+A), dann 36,5 / 30 / 24 / 17,5 / 11,5 cm oder einen eigenen Wert wählen. **„Außenwände erkennen“:** wählt die Außenwände aus und legt ihre Linie auf die Innenkante, die Dicke wächst nach außen. „Seite wechseln“ und „Mittig“ ändern das je Wand. Die Farben zeigen die Dicke. |
| 2 Winkel – Flucht | **Mehrere Wände auf eine Linie:** mit Strg+Klick markieren (die zuerst markierte bleibt stehen), dann „Auf eine Linie ausrichten“. Die Wände müssen nicht verbunden sein. Versprünge, die zwei markierte Wände direkt verbinden, werden entfernt; echte Rücksprünge aus mehreren Wänden bleiben erhalten. Alternativ Werkzeug „Flucht“: zwei Wände nacheinander anklicken. Fluchten bleiben erhalten (lila gestrichelt), „Flucht lösen“ hebt sie auf. |
| 4 Maße | Wand anklicken und das **Innenmaß in Metern** eintippen (z. B. `4,12`), Enter übernimmt. Bei Außenwänden ist die Innenseite vorgewählt, bei Innenwänden die angeklickte Seite; „Andere Seite“ wechselt sie. Das schwarze Quadrat („fest“) markiert das Ende, das stehen bleibt; „Anderes Ende fest“ tauscht es. Werkzeug **„Abstand“:** zwei parallele Wände anklicken und den lichten Abstand eingeben. Grün = gemessen, grau = gezeichnet. Ein Maß, das den vorhandenen widerspricht, wird nicht übernommen, die beteiligten Wände werden rot markiert. Innenmaße bleiben auch bei geänderter Wanddicke erhalten. |
| 7 Vorschau | Ansicht ohne Hilfslinien, Export als PNG |

**Gerade Wände:** Wird eine Wand an eine durchgehende Wand angedockt, bleibt diese beim Ziehen gerade. Der Anschlusspunkt gleitet entlang der Wand.
**Fixierte Richtungen:** Wände mit fixierter Richtung bleiben beim Ziehen in ihrer Richtung, angeschlossene Wände ziehen mit.

- Zoomen mit dem Mausrad, verschieben mit gedrückter mittlerer/rechter Maustaste, Leertaste + Ziehen oder dem Werkzeug „Ansicht“ (H). „Alles“ (F) zeigt den ganzen Plan.
- Rückgängig/Wiederholen: Strg+Z / Strg+Y.
- Die Koordinaten unten rechts beziehen sich auf den Nullpunkt (y positiv nach oben). Während des Zeichnens wird zusätzlich Δx/Δy zum letzten Punkt angezeigt.
- Menü ☰: Projektname, Hintergrundfarbe oder transparent, Projekt speichern/öffnen (`.grundriss.json`), PNG-Export.

## Export
PNG, 2000 px breit, die Höhe ergibt sich aus dem Plan. Rand 50 cm, Hintergrund laut Einstellung.

## Versionen
- 0.3.1: Stufe 2 – mehrere Wände per Strg+Klick auf eine Linie ausrichten, Versprünge werden entfernt; Fehler behoben, durch den weit entfernte Wände beim Fluchten seitlich verrutschten
- 0.3.0: Stufe 4 Maße (Innenmaß in m, Abstand paralleler Wände, Widerspruchsprüfung), Flucht (nicht verbundene
  Wände auf eine Linie)
- 0.2.0: Stufe 2 Winkel (Löser, Eckwinkel, 45°), Stufe 3 Wanddicken (Außenwände an der Innenkante, saubere Ecken),
  durchgehende Wände bleiben gerade, Nullpunkt und Koordinatenanzeige
- 0.1.0: Grundgerüst, Stufe 1 Skizze, Undo/Redo, Speichern/Laden, PNG-Export, Vorschau
