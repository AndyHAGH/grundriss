'use strict';
/* Möbel- und Objektsymbole in Draufsicht.
   Jedes Symbol zeichnet in lokalen Koordinaten (cm): x ∈ [-w/2, w/2], y ∈ [-d/2, d/2].
   Die Rückseite (Wandseite) liegt bei y = -d/2. Hilfsfunktionen kommen über das Objekt S. */
(() => {
function helpers(c, lw, stroke, fill) {
  const S = {
    path(fn, doFill = true) { c.beginPath(); fn(); if (doFill && fill) { c.fillStyle = fill; c.fill(); } c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); },
    rect(x, y, w, h, r = 0, doFill = true) {
      S.path(() => {
        if (!r) { c.rect(x, y, w, h); return; }
        r = Math.min(r, w / 2, h / 2);
        c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
      }, doFill);
    },
    circle(x, y, r, doFill = true) { S.path(() => c.arc(x, y, r, 0, Math.PI * 2), doFill); },
    ellipse(x, y, rx, ry, doFill = true) { S.path(() => c.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2), doFill); },
    line(x1, y1, x2, y2, f = 1) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineWidth = lw * f; c.strokeStyle = stroke; c.stroke(); },
    text(t, x, y, h) {
      c.save(); c.fillStyle = stroke; c.font = `600 ${h}px -apple-system, "Segoe UI", sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, x, y); c.restore();
    },
  };
  return S;
}
// Stühle um einen Tisch: n Stühle je lange Seite
function chairsAround(S, w, d, perSide) {
  const ch = Math.min(45, d * 0.25), tw = w, td = d - 2 * ch;
  S.rect(-tw / 2, -td / 2, tw, td, 3);
  const cw = Math.min(45, tw / perSide - 10);
  for (let i = 0; i < perSide; i++) {
    const cx = -tw / 2 + tw / perSide * (i + 0.5);
    S.rect(cx - cw / 2, -d / 2 + 4, cw, ch - 8, 4); S.rect(cx - cw / 2, d / 2 - ch + 4, cw, ch - 8, 4);
  }
}
function sofa(S, w, d, seats) {
  const arm = Math.min(20, w * 0.12), back = Math.min(20, d * 0.25);
  S.rect(-w / 2, -d / 2, w, d, 6);
  S.rect(-w / 2 + arm, -d / 2 + back, w - 2 * arm, d - back - 4, 3, false);
  for (let i = 1; i < seats; i++) { const x = -w / 2 + arm + (w - 2 * arm) / seats * i; S.line(x, -d / 2 + back, x, d / 2 - 4); }
}

const SYMBOLS = {
  // Wohnen
  sofa2: { name: 'Sofa 2er', cat: 'Wohnen', w: 160, d: 90, draw: (S, w, d) => sofa(S, w, d, 2) },
  sofa3: { name: 'Sofa 3er', cat: 'Wohnen', w: 220, d: 90, draw: (S, w, d) => sofa(S, w, d, 3) },
  sofaL: { name: 'Ecksofa', cat: 'Wohnen', w: 260, d: 200, draw: (S, w, d) => {
    const t = Math.min(90, w * 0.4, d * 0.45), b = 20;
    S.rect(-w / 2, -d / 2, w, t, 6); S.rect(-w / 2, -d / 2 + t - 2, t, d - t + 2, 6);
    S.line(-w / 2 + b, -d / 2 + b, w / 2 - b, -d / 2 + b); S.line(-w / 2 + b, -d / 2 + b, -w / 2 + b, d / 2 - b);
  } },
  armchair: { name: 'Sessel', cat: 'Wohnen', w: 80, d: 80, draw: (S, w, d) => sofa(S, w, d, 1) },
  coffee: { name: 'Couchtisch', cat: 'Wohnen', w: 110, d: 60, draw: (S, w, d) => S.rect(-w / 2, -d / 2, w, d, 4) },
  tv: { name: 'TV-Möbel', cat: 'Wohnen', w: 160, d: 45, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d, 2); S.rect(-w * 0.35, -d / 2 + 4, w * 0.7, 6, 1);
  } },
  shelf: { name: 'Regal', cat: 'Wohnen', w: 100, d: 35, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d); const n = Math.max(1, Math.round(w / 40));
    for (let i = 1; i < n; i++) { const x = -w / 2 + w / n * i; S.line(x, -d / 2, x, d / 2); }
  } },
  // Essen
  table4: { name: 'Esstisch 4 Stühle', cat: 'Essen', w: 140, d: 170, draw: (S, w, d) => chairsAround(S, w, d, 2) },
  table6: { name: 'Esstisch 6 Stühle', cat: 'Essen', w: 200, d: 170, draw: (S, w, d) => chairsAround(S, w, d, 3) },
  tableRound: { name: 'Runder Tisch', cat: 'Essen', w: 190, d: 190, draw: (S, w, d) => {
    const r = Math.min(w, d) / 2 - 40;
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, x = Math.cos(a) * (r + 22), y = Math.sin(a) * (r + 22); S.rect(x - 20, y - 20, 40, 40, 4); }
    S.circle(0, 0, r);
  } },
  chair: { name: 'Stuhl', cat: 'Essen', w: 45, d: 45, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d, 4); S.line(-w / 2 + 3, -d / 2 + 8, w / 2 - 3, -d / 2 + 8); } },
  // Schlafen
  bed2: { name: 'Doppelbett', cat: 'Schlafen', w: 180, d: 200, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d, 3); const p = Math.min(40, d * 0.2);
    S.rect(-w / 2 + 8, -d / 2 + 8, w / 2 - 12, p, 6, false); S.rect(4, -d / 2 + 8, w / 2 - 12, p, 6, false);
    S.line(-w / 2, -d / 2 + p + 20, w / 2, -d / 2 + p + 20);
  } },
  bed1: { name: 'Einzelbett', cat: 'Schlafen', w: 90, d: 200, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d, 3); const p = Math.min(40, d * 0.2);
    S.rect(-w / 2 + 8, -d / 2 + 8, w - 16, p, 6, false); S.line(-w / 2, -d / 2 + p + 20, w / 2, -d / 2 + p + 20);
  } },
  wardrobe: { name: 'Kleiderschrank', cat: 'Schlafen', w: 200, d: 60, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d); S.line(-w / 2 + 5, 0, w / 2 - 5, 0, 0.7);
    const n = Math.max(1, Math.round(w / 50)); for (let i = 1; i < n; i++) { const x = -w / 2 + w / n * i; S.line(x, d / 2 - 8, x, d / 2); }
  } },
  nightstand: { name: 'Nachttisch', cat: 'Schlafen', w: 45, d: 40, draw: (S, w, d) => S.rect(-w / 2, -d / 2, w, d, 2) },
  // Küche
  cab60: { name: 'Unterschrank', cat: 'Küche', w: 60, d: 60, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d); S.line(-w / 2, d / 2 - 6, w / 2, d / 2 - 6); } },
  kitchen: { name: 'Küchenzeile', cat: 'Küche', w: 240, d: 60, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d); const n = Math.max(1, Math.round(w / 60));
    for (let i = 1; i < n; i++) { const x = -w / 2 + w / n * i; S.line(x, -d / 2, x, d / 2, 0.6); }
  } },
  stove: { name: 'Herd', cat: 'Küche', w: 60, d: 60, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d); const r = Math.min(w, d) * 0.15;
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) S.circle(x * w * 0.22, y * d * 0.22, r, false);
  } },
  sink: { name: 'Spüle', cat: 'Küche', w: 60, d: 60, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d); S.rect(-w / 2 + 8, -d / 2 + 10, w - 16, d - 20, 6, false); S.circle(0, -d / 2 + 6, 2, false); } },
  fridge: { name: 'Kühlschrank', cat: 'Küche', w: 60, d: 65, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d); S.text('KS', 0, 0, Math.min(w, d) * 0.3); } },
  dishwasher: { name: 'Spülmaschine', cat: 'Küche', w: 60, d: 60, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d); S.text('GS', 0, 0, Math.min(w, d) * 0.3); } },
  // Bad
  wc: { name: 'WC', cat: 'Bad', w: 40, d: 65, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d * 0.28, 3); S.ellipse(0, d * 0.12, w * 0.45, d * 0.36); } },
  basin: { name: 'Waschbecken', cat: 'Bad', w: 60, d: 45, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d, 4); S.ellipse(0, d * 0.05, w * 0.35, d * 0.3, false); } },
  shower: { name: 'Dusche', cat: 'Bad', w: 90, d: 90, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d); S.line(-w / 2, -d / 2, w / 2, d / 2, 0.6); S.line(w / 2, -d / 2, -w / 2, d / 2, 0.6); S.circle(0, 0, 3, false);
  } },
  bathtub: { name: 'Badewanne', cat: 'Bad', w: 170, d: 75, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d, 4); S.rect(-w / 2 + 8, -d / 2 + 8, w - 16, d - 16, d * 0.3, false); S.circle(-w / 2 + 22, 0, 3, false); } },
  washer: { name: 'Waschmaschine', cat: 'Bad', w: 60, d: 60, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d, 3); S.circle(0, 2, Math.min(w, d) * 0.3, false); } },
  // Sonstiges
  plant: { name: 'Pflanze', cat: 'Sonstiges', w: 50, d: 50, draw: (S, w, d) => {
    const r = Math.min(w, d) / 2; S.circle(0, 0, r);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; S.line(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, 0.7); }
  } },
  stairs: { name: 'Treppe', cat: 'Sonstiges', w: 100, d: 300, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d, 0); const n = Math.max(2, Math.round(d / 26));
    for (let i = 1; i < n; i++) { const y = -d / 2 + d / n * i; S.line(-w / 2, y, w / 2, y, 0.7); }
    S.line(0, d / 2 - 10, 0, -d / 2 + 15); S.line(0, -d / 2 + 15, -8, -d / 2 + 30); S.line(0, -d / 2 + 15, 8, -d / 2 + 30);
  } },
  desk: { name: 'Schreibtisch', cat: 'Sonstiges', w: 140, d: 70, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d, 2); S.rect(-w * 0.2, d / 2 - 6, w * 0.4, 6, 1, false); } },
  radiator: { name: 'Heizkörper', cat: 'Sonstiges', w: 100, d: 12, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d); const n = Math.max(2, Math.round(w / 8));
    for (let i = 1; i < n; i++) { const x = -w / 2 + w / n * i; S.line(x, -d / 2, x, d / 2, 0.5); }
  } },
  fireplace: { name: 'Kamin', cat: 'Sonstiges', w: 100, d: 50, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d); S.path(() => { const c = S.ctx; c.moveTo(-w * 0.3, -d / 2 + 8); c.lineTo(w * 0.3, -d / 2 + 8); c.lineTo(w * 0.2, d / 2 - 6); c.lineTo(-w * 0.2, d / 2 - 6); c.closePath(); }, false);
  } },
  car: { name: 'Auto', cat: 'Sonstiges', w: 180, d: 450, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d, w * 0.25);
    S.rect(-w / 2 + 12, -d * 0.18, w - 24, d * 0.42, 10, false);
    S.line(-w / 2 + 14, -d * 0.18 + 2, w / 2 - 14, -d * 0.18 + 2, 1.4); S.line(-w / 2 + 16, d * 0.22, w / 2 - 16, d * 0.22, 1.2);
  } },
  piano: { name: 'Klavier', cat: 'Sonstiges', w: 150, d: 60, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d, 2); const ky = d / 2 - d * 0.3; S.line(-w / 2, ky, w / 2, ky);
    const n = Math.round(w / 6); for (let i = 1; i < n; i++) { const x = -w / 2 + w / n * i; S.line(x, ky, x, d / 2, 0.4); }
  } },
  sauna: { name: 'Sauna', cat: 'Sonstiges', w: 200, d: 200, draw: (S, w, d) => {
    S.rect(-w / 2, -d / 2, w, d); S.rect(-w / 2 + 6, -d / 2 + 6, w - 12, 50, 0, false); S.rect(-w / 2 + 6, -d / 2 + 56, 50, d - 62, 0, false);
    S.text('Sauna', w * 0.12, d * 0.15, Math.min(w, d) * 0.12);
  } },
  tech: { name: 'Heizung/Technik', cat: 'Sonstiges', w: 80, d: 60, draw: (S, w, d) => { S.rect(-w / 2, -d / 2, w, d); S.circle(-w * 0.18, 0, Math.min(w, d) * 0.28, false); S.text('HT', w * 0.22, 0, Math.min(w, d) * 0.25); } },
};
// Zeichnet ein Symbol; c steht bereits im lokalen Koordinatensystem des Objekts
function drawSymbol(c, key, w, d, lw, stroke, fill) {
  const sym = SYMBOLS[key]; if (!sym) return;
  const S = helpers(c, lw, stroke, fill); S.ctx = c;
  c.lineJoin = 'round'; c.lineCap = 'round';
  sym.draw(S, w, d);
}
window.SYMBOLS = SYMBOLS;
window.drawSymbol = drawSymbol;
})();
