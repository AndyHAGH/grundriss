# Grundriss

Einfaches 2D-CAD im Browser, um Grundrisse von bestehenden Gebäuden zu zeichnen und als PNG für
Home Assistant zu exportieren. Konzept: [KONZEPT.md](KONZEPT.md)

**Version 0.1.0.** Zielgerät ist vorerst ein Windows-PC (Chrome/Edge). Die Bedienung über Pointer-Events ist
für iPad und Apple Pencil vorbereitet.

## Starten
- Lokal: `index.html` im Browser öffnen. Offline-Modus und Installation funktionieren nur über http(s).
- Online: über GitHub Pages veröffentlichen (Repository → Settings → Pages → Branch `main`, Ordner `/`).

## Bedienung (v0.1)
| Stufe | Funktion |
|---|---|
| 1 Skizze | **Wand (W):** Punkte nacheinander klicken. Ein erneuter Klick auf den letzten Punkt, Enter oder „Fertig“ beendet den Wandzug. Ein Klick auf einen vorhandenen Eckpunkt (grün) oder eine Wand (orange) verbindet und beendet den Wandzug. **Auswahl (V):** Wand oder Eckpunkt anklicken und ziehen. Wird ein Eckpunkt auf einen anderen gezogen, werden beide verbunden. Entf löscht. |
| 7 Vorschau | Ansicht ohne Hilfslinien, Export als PNG |

- Zoomen mit dem Mausrad, verschieben mit gedrückter mittlerer/rechter Maustaste, Leertaste + Ziehen oder dem Werkzeug „Ansicht“ (H). „Alles“ (F) zeigt den ganzen Plan.
- Rückgängig/Wiederholen: Strg+Z / Strg+Y.
- „Fangen“ (∟) richtet Linien in der Nähe von 0°/45°/90° gerade aus.
- Menü ☰: Projektname, Hintergrundfarbe oder transparent, Projekt speichern/öffnen (`.grundriss.json`), PNG-Export.
- Das Projekt wird automatisch im Browser gespeichert. Für eine Sicherung oder ein anderes Gerät die Funktion „Projekt speichern“ nutzen.

## Export
PNG, 2000 px breit, die Höhe ergibt sich aus dem Plan. Rand 50 cm, Hintergrund laut Einstellung.

## Versionen
- 0.1.0: Grundgerüst, Stufe 1 Skizze, Undo/Redo, Speichern/Laden, PNG-Export, Vorschau
