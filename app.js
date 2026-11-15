'use strict';
/* Grundriss – einfaches 2D-CAD für Bestandspläne. Einheiten im Modell: Zentimeter, y zeigt nach unten. */
(() => {
const VERSION = '0.2.0';
const STORE_KEY = 'grundriss.projekt.v1';
const SNAP_PX = 16;        // Fangradius in Bildschirm-Pixeln (Touch-/Stift-freundlich)
const ORTHO_TOL = 6;       // Grad: Fanghilfe beim Zeichnen
const ALIGN_TOL = 10;      // Grad: „Alle Winkel ausrichten“
const THICKS = [36.5, 30, 24, 17.5, 11.5];
const THICK_COLORS = { '36.5': '#1d4ed8', '30': '#7c3aed', '24': '#059669', '17.5': '#d97706', '11.5': '#dc2626' };
const thickColor = t => THICK_COLORS[String(t)] || '#6b7280';
const fmtNum = v => String(Math.round(v * 10) / 10).replace('.', ',');
const parseNum = s => parseFloat(String(s).replace(',', '.'));

const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d');

// ---------- Zustand ----------
let doc = load() || newDoc();
const view = { s: 0.5, ox: 0, oy: 0 };       // Bildschirm = Welt * s + o
let W = 0, H = 0, DPR = 1;
let stage = 1, tool = 'wall', ortho = true, multi = false, cornerSwap = false;
let sel = null;                                // {type:'node', id} | {type:'wall', ids:[…]}
let chain = null;                              // {from: snap} – laufender Wandzug
let cursor = null;                             // Fang-Ergebnis für Vorschau
let hover = null;                              // Zeigerposition (Welt) für Koordinatenanzeige
let gesture = null, spaceDown = false, isMouse = true;
const pointers = new Map();
const undoStack = [], redoStack = [];

function newDoc() { return migrate({ app: 'grundriss', name: 'Mein Haus', nextId: 1, nodes: [], walls: [] }); }
function migrate(d) {
  d.version = 2;
  d.settings = Object.assign({ bg: '#ffffff', transparent: false, lastThick: 24, origin: { x: 0, y: 0 } }, d.settings);
  for (const w of d.walls) {
    if (!w.side) w.side = 'C';
    if (w.thick == null) w.thick = 24;
    if (w.dir === undefined) w.dir = null;
    if (w.line === undefined) w.line = null;
  }
  return d;
}
const settings = () => doc.settings;
const uid = () => doc.nextId++;
const nodeById = id => doc.nodes.find(n => n.id === id);
const wallById = id => doc.walls.find(w => w.id === id);
const other = (w, id) => (w.a === id ? w.b : w.a);
const snapshot = () => JSON.stringify(doc);
const selWalls = () => (sel?.type === 'wall' ? sel.ids.map(wallById).filter(Boolean) : []);

function commit(before) {
  if (before === snapshot()) { refresh(); return; }
  undoStack.push(before); if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0; save(); refresh();
}
function restore(json) { doc = JSON.parse(json); chain = null; sel = null; save(); refresh(); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }

function save() { try { localStorage.setItem(STORE_KEY, snapshot()); } catch (e) { /* Speicher evtl. gesperrt */ } }
function load() {
  try { const d = JSON.parse(localStorage.getItem(STORE_KEY)); return valid(d) ? migrate(d) : null; } catch (e) { return null; }
}
function valid(d) { return d && d.app === 'grundriss' && Array.isArray(d.nodes) && Array.isArray(d.walls); }

// ---------- Geometrie ----------
const toWorld = (sx, sy) => ({ x: (sx - view.ox) / view.s, y: (sy - view.oy) / view.s });
const toScreen = p => ({ x: p.x * view.s + view.ox, y: p.y * view.s + view.oy });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (p, q) => { const l = dist(p, q); return l ? { x: (q.x - p.x) / l, y: (q.y - p.y) / l } : null; };
const norm180 = a => ((a % 180) + 180) % 180;
const wallAngle = w => { const a = nodeById(w.a), b = nodeById(w.b); return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; };
function distPtSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx, y = a.y + t * dy;
  return { d: Math.hypot(p.x - x, p.y - y), t, x, y };
}
function projLine(p, a, b) {   // Projektion auf die unendliche Gerade a-b
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  if (!l2) return { x: a.x, y: a.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
// Schnitt Strahl (o + u*d, u>0) mit Strecke a-b; liefert {u, t} oder null
function rayHit(o, d, a, b, tMin = 0, tMax = 1) {
  const ex = b.x - a.x, ey = b.y - a.y, den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-12) return null;
  const u = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
  const t = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
  return u > 0 && t >= tMin && t <= tMax ? { u, t } : null;
}
function lineX(p, d, q, e) {   // Schnitt zweier Geraden p+u*d und q+v*e
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const u = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return { x: p.x + u * d.x, y: p.y + u * d.y };
}
function inPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const wallLen = w => dist(nodeById(w.a), nodeById(w.b));
const fmtLen = cm => (cm / 100).toFixed(2).replace('.', ',') + ' m';
// Koordinaten relativ zum Nullpunkt, y positiv nach oben
const rel = p => ({ x: p.x - settings().origin.x, y: settings().origin.y - p.y });

function hitNode(p, tol, excludeId) {
  let best = null, bd = tol;
  for (const n of doc.nodes) {
    if (n.id === excludeId) continue;
    const d = dist(n, p); if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function hitWall(p, tol) {
  let best = null, bd = tol;
  for (const w of doc.walls) {
    const r = distPtSeg(p, nodeById(w.a), nodeById(w.b));
    if (r.d < bd) { bd = r.d; best = w; }
  }
  if (best) return best;
  const g = geometry();                         // Klick in die Wandfläche
  return doc.walls.find(w => g.polys.has(w.id) && inPoly(p, g.polys.get(w.id))) || null;
}

// Fangen: vorhandener Eckpunkt > Gerade (0/45/90°) > Punkt auf Wand > Nullpunkt > frei
function findSnap(p, from) {
  const tol = SNAP_PX / view.s;
  const n = hitNode(p, tol);
  if (n) return { x: n.x, y: n.y, nodeId: n.id, kind: 'node' };
  let q = { x: p.x, y: p.y, kind: 'free' }, dir = null;
  if (from && ortho) {
    const dx = p.x - from.x, dy = p.y - from.y;
    if (Math.hypot(dx, dy) > 0) {
      const ang = Math.atan2(dy, dx) * 180 / Math.PI, r = Math.round(ang / 45) * 45;
      if (Math.abs(ang - r) < ORTHO_TOL) {
        const rad = r * Math.PI / 180; dir = { x: Math.cos(rad), y: Math.sin(rad) };
        const len = dx * dir.x + dy * dir.y;
        q = { x: from.x + dir.x * len, y: from.y + dir.y * len, kind: 'ortho' };
      }
    }
  }
  let best = null, bd = tol;
  for (const w of doc.walls) {
    const a = nodeById(w.a), b = nodeById(w.b);
    const r = distPtSeg(q, a, b);
    if (r.d >= bd || r.t <= 0.001 || r.t >= 0.999) continue;
    let pt = { x: r.x, y: r.y };
    if (dir) { const h = rayHit(from, dir, a, b, 0.001, 0.999); if (h) { const ix = { x: from.x + dir.x * h.u, y: from.y + dir.y * h.u }; if (dist(ix, q) < tol) pt = ix; } }
    bd = r.d; best = { x: pt.x, y: pt.y, wallId: w.id, kind: 'wall' };
  }
  if (best) return best;
  if (dist(q, settings().origin) < tol) return { x: settings().origin.x, y: settings().origin.y, kind: 'origin' };
  return q;
}

// ---------- Durchgehende Wände („Linien“) ----------
// Wird eine Wand durch einen Anschluss geteilt, behalten beide Teile dieselbe line-Kennung und bleiben gerade.
function lineGroups() {
  const m = new Map();
  for (const w of doc.walls) if (w.line != null) { if (!m.has(w.line)) m.set(w.line, []); m.get(w.line).push(w); }
  const res = new Map();
  for (const [id, ws] of m) {
    if (ws.length < 2) continue;
    const deg = new Map();
    for (const w of ws) { deg.set(w.a, (deg.get(w.a) || 0) + 1); deg.set(w.b, (deg.get(w.b) || 0) + 1); }
    const ends = [...deg].filter(([, c]) => c === 1).map(([n]) => n);
    if (ends.length !== 2) continue;
    res.set(id, { walls: ws, ends, interior: [...deg].filter(([, c]) => c === 2).map(([n]) => n) });
  }
  return res;
}
function hostLine(id, groups, exclude) {
  for (const [lid, g] of groups) if (lid !== exclude && g.interior.includes(id)) return g;
  return null;
}
const lineMembers = w => (w.line == null ? [w] : doc.walls.filter(x => x.line === w.line));

// ---------- Löser für Zwangsbedingungen ----------
// Bedingungen: fixierte Wandrichtung (dir) und gerade durchgehende Wände. Fixierte Punkte (pinned) bewegen sich nicht.
function solve(pinned = new Set(), iters = 500) {
  const N = new Map(doc.nodes.map(n => [n.id, n]));
  const groups = lineGroups();
  const cons = doc.walls.filter(w => w.dir != null).map(w => {
    const r = w.dir * Math.PI / 180;
    return { a: N.get(w.a), b: N.get(w.b), nx: -Math.sin(r), ny: Math.cos(r) };
  });
  for (let k = 0; k < iters; k++) {
    let err = 0;
    for (const c of cons) {
      const wa = pinned.has(c.a.id) ? 0 : 1, wb = pinned.has(c.b.id) ? 0 : 1;
      if (!wa && !wb) continue;
      const e = (c.b.x - c.a.x) * c.nx + (c.b.y - c.a.y) * c.ny;
      err = Math.max(err, Math.abs(e));
      const fa = e * wa / (wa + wb), fb = e * wb / (wa + wb);
      c.a.x += c.nx * fa; c.a.y += c.ny * fa; c.b.x -= c.nx * fb; c.b.y -= c.ny * fb;
    }
    for (const g of groups.values()) {
      const A = N.get(g.ends[0]), B = N.get(g.ends[1]);
      for (const id of g.interior) {
        if (pinned.has(id)) continue;
        const p = N.get(id), r = projLine(p, A, B);
        err = Math.max(err, dist(p, r)); p.x = r.x; p.y = r.y;
      }
    }
    if (err < 0.01) break;
  }
}

// ---------- Modell-Operationen ----------
function splitWall(w, x, y) {
  const n = { id: uid(), x, y }; doc.nodes.push(n);
  if (w.line == null) w.line = uid();
  doc.walls.push({ id: uid(), a: n.id, b: w.b, thick: w.thick, side: w.side, dir: w.dir, line: w.line });
  w.b = n.id;
  return n.id;
}
function resolve(sn) {
  if (sn.nodeId && nodeById(sn.nodeId)) return sn.nodeId;
  for (const n of doc.nodes) if (dist(n, sn) < 0.5) return n.id;
  for (const w of doc.walls) {
    const r = distPtSeg(sn, nodeById(w.a), nodeById(w.b));
    if (r.d < 0.5 && r.t > 0.001 && r.t < 0.999) return splitWall(w, sn.x, sn.y);
  }
  const n = { id: uid(), x: sn.x, y: sn.y }; doc.nodes.push(n); return n.id;
}
const hasWall = (a, b) => doc.walls.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a));
function cleanup() {
  doc.walls = doc.walls.filter(w => w.a !== w.b);
  const seen = new Set();
  doc.walls = doc.walls.filter(w => { const k = Math.min(w.a, w.b) + '-' + Math.max(w.a, w.b); if (seen.has(k)) return false; seen.add(k); return true; });
  doc.nodes = doc.nodes.filter(n => doc.walls.some(w => w.a === n.id || w.b === n.id));
  // Linien neu ordnen: jedes zusammenhängende Stück bekommt eine eigene Kennung
  const byLine = new Map();
  for (const w of doc.walls) if (w.line != null) { if (!byLine.has(w.line)) byLine.set(w.line, []); byLine.get(w.line).push(w); }
  for (const ws of byLine.values()) {
    const left = new Set(ws); let first = true;
    while (left.size) {
      const start = left.values().next().value; left.delete(start);
      const comp = [start], nodes = new Set([start.a, start.b]);
      for (let grown = true; grown;) {
        grown = false;
        for (const w of [...left]) if (nodes.has(w.a) || nodes.has(w.b)) { left.delete(w); comp.push(w); nodes.add(w.a); nodes.add(w.b); grown = true; }
      }
      const id = comp.length < 2 ? null : first ? start.line : uid();
      if (comp.length >= 2) first = false;
      comp.forEach(w => { w.line = id; });
    }
  }
}
function mergeNodes(src, dst) {
  for (const w of doc.walls) { if (w.a === src) w.a = dst; if (w.b === src) w.b = dst; }
  doc.nodes = doc.nodes.filter(n => n.id !== src);
  cleanup();
}
function chainFrom() { if (!chain) return null; const f = chain.from; return f.nodeId ? nodeById(f.nodeId) : f; }

function placePoint(sn) {
  if (!chain) { chain = { from: sn }; refresh(); return; }
  const fp = chainFrom();
  if (dist(sn, fp) * view.s < 6) { endChain(); return; }   // erneut auf letzten Punkt = fertig
  const before = snapshot();
  const a = resolve(chain.from), b = resolve(sn);
  if (a !== b && !hasWall(a, b)) doc.walls.push({ id: uid(), a, b, thick: settings().lastThick, side: 'C', dir: null, line: null });
  const onExisting = sn.kind === 'node' || sn.kind === 'wall';
  chain = onExisting ? null : { from: { x: sn.x, y: sn.y, nodeId: b, kind: 'node' } };
  commit(before);
}
function endChain() { chain = null; if (!isMouse) cursor = null; refresh(); }

function deleteSelection() {
  if (!sel) return;
  const before = snapshot();
  if (sel.type === 'wall') { const ids = new Set(sel.ids); doc.walls = doc.walls.filter(w => !ids.has(w.id)); }
  else doc.walls = doc.walls.filter(w => w.a !== sel.id && w.b !== sel.id);
  sel = null; cleanup(); commit(before);
}

// Ziehen: Ausgangszustand wiederherstellen, verschieben, Bedingungen lösen
function applyDrag(g, wp) {
  doc = JSON.parse(g.before);
  const dx = wp.x - g.start.x, dy = wp.y - g.start.y;
  const groups = lineGroups(), pinned = new Set();
  if (g.type === 'dragNode') {
    const n = nodeById(g.id); let p = { x: n.x + dx, y: n.y + dy };
    const host = hostLine(n.id, groups);
    g.mergeTo = null;
    if (host) p = projLine(p, nodeById(host.ends[0]), nodeById(host.ends[1]));   // Anschluss gleitet auf der Wand
    else { const m = hitNode(p, SNAP_PX / view.s, n.id); if (m) { g.mergeTo = m.id; p = { x: m.x, y: m.y }; } }
    n.x = p.x; n.y = p.y; pinned.add(n.id);
  } else {
    const w = wallById(g.id);
    const lg = w.line != null ? groups.get(w.line) : null;
    const ids = lg ? [...lg.ends, ...lg.interior] : [w.a, w.b];
    for (const id of ids) {
      const n = nodeById(id); let mx = dx, my = dy;
      const host = hostLine(id, groups, w.line);
      if (host) { const u = unit(nodeById(host.ends[0]), nodeById(host.ends[1])); if (u) { const k = dx * u.x + dy * u.y; mx = u.x * k; my = u.y * k; } }
      n.x += mx; n.y += my; pinned.add(id);
    }
  }
  solve(pinned);
}

// ---------- Stufe 2: Winkel ----------
function cornerInfo(id) {
  const inc = doc.walls.filter(w => w.a === id || w.b === id);
  if (inc.length !== 2) return null;
  const n = nodeById(id), o1 = nodeById(other(inc[0], id)), o2 = nodeById(other(inc[1], id));
  const d1 = unit(n, o1), d2 = unit(n, o2);
  if (!d1 || !d2) return null;
  const ang = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y))) * 180 / Math.PI;
  return { n, w1: inc[0], w2: inc[1], o1, o2, d1, d2, ang };
}
const isClean = a => Math.abs(a - Math.round(a / 45) * 45) < 0.05;
function skewCorners() { return doc.nodes.filter(n => { const c = cornerInfo(n.id); return c && c.ang < 179.95 && !isClean(c.ang); }).length; }

function alignAll() {
  if (!doc.walls.length) return;
  const before = snapshot();
  // 1. Ist alles schief gezeichnet, zuerst das Ganze drehen (Hauptrichtung waagerecht)
  if (!doc.walls.some(w => w.dir != null)) {
    let sx = 0, sy = 0;
    for (const w of doc.walls) { const L = wallLen(w), t = wallAngle(w) * Math.PI / 180; sx += L * Math.cos(4 * t); sy += L * Math.sin(4 * t); }
    const rot = -Math.atan2(sy, sx) / 4;
    if (Math.abs(rot) > 0.2 * Math.PI / 180) {
      const b = bbox(), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, c = Math.cos(rot), s = Math.sin(rot);
      for (const n of doc.nodes) { const x = n.x - cx, y = n.y - cy; n.x = cx + x * c - y * s; n.y = cy + x * s + y * c; }
    }
  }
  // 2. Wände nahe 0/45/90/135° fixieren
  let count = 0;
  for (const w of doc.walls) {
    if (w.dir != null) continue;
    const a = norm180(wallAngle(w)), r = Math.round(a / 45) * 45;
    if (Math.abs(a - r) <= ALIGN_TOL) { w.dir = r % 180; count++; }
  }
  solve(new Set(), 3000);
  commit(before);
  toast(`${count} Wände ausgerichtet · ${skewCorners()} schiefe Ecken übrig`);
}
function setCornerAngle(id, target) {
  const c = cornerInfo(id);
  if (!c || !(target > 0 && target <= 180)) return;
  // gedreht wird bevorzugt eine freie Wand, sonst die kürzere; „Andere Wand drehen“ tauscht
  let rotFirst = (c.w1.dir == null) !== (c.w2.dir == null) ? c.w1.dir == null : dist(c.n, c.o1) < dist(c.n, c.o2);
  if (cornerSwap) rotFirst = !rotFirst;
  const [fd, mw, mo, md0] = rotFirst ? [c.d2, c.w1, c.o1, c.d1] : [c.d1, c.w2, c.o2, c.d2];
  const before = snapshot();
  const sign = fd.x * md0.y - fd.y * md0.x >= 0 ? 1 : -1, r = target * Math.PI / 180 * sign;
  const md = { x: fd.x * Math.cos(r) - fd.y * Math.sin(r), y: fd.x * Math.sin(r) + fd.y * Math.cos(r) };
  const L = dist(c.n, mo); mo.x = c.n.x + md.x * L; mo.y = c.n.y + md.y * L;
  const a = norm180(Math.atan2(md.y, md.x) * 180 / Math.PI), r45 = Math.round(a / 45) * 45;
  mw.dir = Math.abs(a - r45) < 0.01 ? r45 % 180 : null;
  solve(new Set([c.n.id, mo.id]), 3000);
  commit(before);
}
function fixWalls(fix) {
  const before = snapshot();
  for (const w of selWalls().flatMap(lineMembers)) w.dir = fix ? Math.round(norm180(wallAngle(w)) / 45) * 45 % 180 : null;
  solve(new Set(), 3000); commit(before);
}

// ---------- Stufe 3: Wanddicken ----------
function wallOffsets(w) { const t = w.thick; return w.side === 'L' ? [t, 0] : w.side === 'R' ? [0, t] : [t / 2, t / 2]; } // [links, rechts] in Richtung a→b
function setThick(t) {
  if (!(t > 0 && t < 300)) return;
  const before = snapshot();
  for (const w of selWalls()) w.thick = t;
  settings().lastThick = t; commit(before);
}
function setSide(mode) {
  const before = snapshot();
  for (const w of selWalls()) w.side = mode === 'C' ? 'C' : w.side === 'L' ? 'R' : 'L';
  commit(before);
}
function escapes(p) {   // Punkt liegt außerhalb des Gebäudes, wenn ein Strahl keine Wand trifft
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12 + 0.013, d = { x: Math.cos(a), y: Math.sin(a) };
    if (!doc.walls.some(w => rayHit(p, d, nodeById(w.a), nodeById(w.b)))) return true;
  }
  return false;
}
function detectOuter() {
  const before = snapshot(), ids = [];
  for (const w of doc.walls) {
    const a = nodeById(w.a), b = nodeById(w.b), u = unit(a, b); if (!u) continue;
    const nl = { x: -u.y, y: u.x };
    let outL = false, outR = false;
    for (const t of [0.25, 0.5, 0.75]) {
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      outL ||= escapes({ x: m.x + nl.x * 2, y: m.y + nl.y * 2 });
      outR ||= escapes({ x: m.x - nl.x * 2, y: m.y - nl.y * 2 });
    }
    if (outL !== outR) { w.side = outL ? 'L' : 'R'; ids.push(w.id); }   // Linie = Innenkante, Dicke nach außen
  }
  sel = ids.length ? { type: 'wall', ids } : null;
  commit(before);
  toast(ids.length ? `${ids.length} Außenwände gewählt – jetzt Dicke antippen` : 'Keine Außenwände erkannt (Umriss geschlossen?)');
}

// Wandflächen mit sauberen Ecken (Gehrung) und Knotenflächen
function geometry() {
  const N = new Map(doc.nodes.map(n => [n.id, n]));
  const inc = new Map(doc.nodes.map(n => [n.id, []]));
  for (const w of doc.walls) { inc.get(w.a)?.push(w); inc.get(w.b)?.push(w); }
  const ends = new Map(), hubs = [];
  for (const n of doc.nodes) {
    const list = inc.get(n.id).map(w => {
      const o = N.get(other(w, n.id)), d = unit(n, o) || { x: 1, y: 0 }, nl = { x: -d.y, y: d.x };
      const [offL, offR] = wallOffsets(w), fwd = w.a === n.id;
      return { w, d, nl, l: fwd ? offL : offR, r: fwd ? offR : offL, ang: Math.atan2(d.y, d.x) };
    }).sort((p, q) => p.ang - q.ang);
    for (const e of list) {
      e.L = { x: n.x + e.nl.x * e.l, y: n.y + e.nl.y * e.l };
      e.R = { x: n.x - e.nl.x * e.r, y: n.y - e.nl.y * e.r };
    }
    if (list.length > 1) {
      for (let i = 0; i < list.length; i++) {
        const A = list[i], B = list[(i + 1) % list.length];
        const X = lineX(A.L, A.d, B.R, B.d);
        if (X && dist(X, n) < 4 * Math.max(A.w.thick, B.w.thick) + 1) { A.L = X; B.R = X; }
      }
      if (list.length > 2) hubs.push(list.flatMap(e => [e.R, e.L]));
    }
    for (const e of list) ends.set(e.w.id + ':' + n.id, e);
  }
  const polys = new Map();
  for (const w of doc.walls) {
    const A = ends.get(w.id + ':' + w.a), B = ends.get(w.id + ':' + w.b);
    if (A && B) polys.set(w.id, [A.L, B.R, B.L, A.R]);
  }
  return { polys, hubs };
}

// ---------- Ansicht ----------
function resize() {
  const r = cv.getBoundingClientRect(); DPR = window.devicePixelRatio || 1;
  W = r.width; H = r.height; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  render();
}
function bbox() {
  if (!doc.nodes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of doc.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
  return { x0, y0, x1, y1 };
}
function fitView() {
  const b = bbox();
  if (!b) { view.s = 0.5; view.ox = W / 2 - settings().origin.x * view.s; view.oy = H / 2 - settings().origin.y * view.s; render(); return; }
  const bw = Math.max(b.x1 - b.x0, 100), bh = Math.max(b.y1 - b.y0, 100);
  view.s = clampS(Math.min((W - 100) / bw, (H - 100) / bh));
  view.ox = W / 2 - (b.x0 + b.x1) / 2 * view.s; view.oy = H / 2 - (b.y0 + b.y1) / 2 * view.s;
  render();
}
const clampS = s => Math.max(0.02, Math.min(20, s));
function zoomAt(sx, sy, f) {
  const w = toWorld(sx, sy); view.s = clampS(view.s * f);
  view.ox = sx - w.x * view.s; view.oy = sy - w.y * view.s; render();
}

// ---------- Zeichnen ----------
let raf = 0;
function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#f8f8f6'; ctx.fillRect(0, 0, W, H);
  if (stage === 7) {
    if (settings().transparent) drawChecker(); else { ctx.fillStyle = settings().bg; ctx.fillRect(0, 0, W, H); }
  } else drawGrid();
  ctx.setTransform(DPR * view.s, 0, 0, DPR * view.s, DPR * view.ox, DPR * view.oy);
  drawPlan(ctx, stage === 7 ? 'final' : stage === 3 ? 'thick' : stage === 2 ? 'angles' : 'sketch', view.s);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (stage !== 7) drawOverlay();
}
function drawChecker() {   // Schachbrett = transparenter Hintergrund
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#e5e7eb';
  for (let y = 0; y < H; y += 16) for (let x = (y / 16) % 2 ? 16 : 0; x < W; x += 32) ctx.fillRect(x, y, 16, 16);
}
function wallColor() {     // hell auf dunklem Hintergrund, sonst dunkel
  const s = settings(); if (s.transparent) return '#222222';
  const h = s.bg.replace('#', ''), r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128 ? '#e5e7eb' : '#222222';
}
function drawGrid() {      // Raster am Nullpunkt ausgerichtet
  const steps = [10, 25, 50, 100, 250, 500, 1000, 2500];
  const minor = steps.find(s => s * view.s >= 12) || 5000;
  const major = minor < 100 ? 100 : minor * 4;
  const o = settings().origin, a = toWorld(0, 0), b = toWorld(W, H);
  const lines = (step, color) => {
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1;
    for (let x = o.x + Math.floor((a.x - o.x) / step) * step; x <= b.x; x += step) { const sx = Math.round(x * view.s + view.ox) + .5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = o.y + Math.floor((a.y - o.y) / step) * step; y <= b.y; y += step) { const sy = Math.round(y * view.s + view.oy) + .5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();
  };
  lines(minor, '#ecebe7'); lines(major, '#d9d7d0');
  // Achsen durch den Nullpunkt
  const p = toScreen(o);
  ctx.strokeStyle = 'rgba(220,38,38,.35)'; ctx.beginPath();
  ctx.moveTo(0, Math.round(p.y) + .5); ctx.lineTo(W, Math.round(p.y) + .5);
  ctx.moveTo(Math.round(p.x) + .5, 0); ctx.lineTo(Math.round(p.x) + .5, H); ctx.stroke();
}
function polyPath(c, pts) { c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y); c.closePath(); }
// Plan in Weltkoordinaten (Transformation ist gesetzt). mode: 'sketch' | 'angles' | 'thick' | 'final'
function drawPlan(c, mode, s) {
  const g = geometry();
  c.lineJoin = 'round';
  if (mode === 'final') {
    const col = wallColor(); c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 1 / s;
    for (const p of [...g.polys.values(), ...g.hubs]) { polyPath(c, p); c.fill(); c.stroke(); }
    return;
  }
  const base = mode === 'sketch' ? '#e7e5e0' : '#d1d5db';
  c.fillStyle = mode === 'thick' ? '#6b7280' : base;
  for (const h of g.hubs) { polyPath(c, h); c.fill(); }
  for (const w of doc.walls) {
    const p = g.polys.get(w.id); if (!p) continue;
    c.fillStyle = mode === 'thick' ? thickColor(w.thick) : base;
    polyPath(c, p); c.fill();
  }
  if (mode === 'thick') return;
  c.lineCap = 'round'; c.lineWidth = 2.5 / s;
  for (const w of doc.walls) {
    const a = nodeById(w.a), b = nodeById(w.b);
    c.strokeStyle = mode === 'angles' && w.dir == null ? '#ea580c' : '#374151';
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  }
}
function label(text, x, y, color, small) {
  ctx.font = (small ? '500 11px' : '600 13px') + ' -apple-system, "Segoe UI", sans-serif';
  const w = ctx.measureText(text).width + 10, h = small ? 18 : 22;
  ctx.fillStyle = 'rgba(255,255,255,.93)'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 + .5, y - h / 2 + .5, w - 1, h - 1);
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1);
}
function drawOverlay() {
  const g = stage === 3 ? geometry() : null;
  // Nullpunkt
  const o = toScreen(settings().origin);
  ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(o.x, o.y, 7, 0, Math.PI * 2); ctx.moveTo(o.x - 12, o.y); ctx.lineTo(o.x + 12, o.y); ctx.moveTo(o.x, o.y - 12); ctx.lineTo(o.x, o.y + 12); ctx.stroke();
  // Auswahl
  for (const w of selWalls()) {
    const a = toScreen(nodeById(w.a)), b = toScreen(nodeById(w.b));
    if (g && g.polys.get(w.id)) {
      const p = g.polys.get(w.id).map(toScreen);
      ctx.strokeStyle = '#111827'; ctx.lineWidth = 3; polyPath(ctx, p); ctx.stroke();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; polyPath(ctx, p); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = 'rgba(37,99,235,.85)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    if (sel.ids.length === 1) label(fmtLen(wallLen(w)), (a.x + b.x) / 2, (a.y + b.y) / 2 - 20, '#1d4ed8');
  }
  // Eckpunkte und Winkel
  if (stage <= 2) {
    for (const n of doc.nodes) {
      const p = toScreen(n), on = sel?.type === 'node' && sel.id === n.id;
      ctx.beginPath(); ctx.arc(p.x, p.y, on ? 7 : 4, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#2563eb' : '#fff'; ctx.fill();
      ctx.strokeStyle = on ? '#1d4ed8' : '#374151'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  if (stage === 2) {
    for (const n of doc.nodes) {
      const c = cornerInfo(n.id); if (!c || c.ang > 179.95) continue;
      const bx = c.d1.x + c.d2.x, by = c.d1.y + c.d2.y, bl = Math.hypot(bx, by) || 1, p = toScreen(n);
      label(fmtNum(c.ang) + '°', p.x + bx / bl * 30, p.y + by / bl * 30, isClean(c.ang) ? '#6b7280' : '#ea580c', true);
    }
  }
  // Laufender Wandzug
  const fp = chainFrom();
  if (fp) {
    const a = toScreen(fp);
    ctx.beginPath(); ctx.arc(a.x, a.y, 8, 0, Math.PI * 2); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.stroke();
    if (cursor) {
      const b = toScreen(cursor);
      ctx.setLineDash([8, 6]); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      if (dist(a, b) > 20) label(fmtLen(dist(fp, cursor)), (a.x + b.x) / 2, (a.y + b.y) / 2 - 18, '#1d4ed8');
    }
  }
  // Fang-Markierung
  if (cursor && stage === 1 && (tool === 'wall' || tool === 'origin')) {
    const p = toScreen(cursor);
    ctx.lineWidth = 2;
    if (cursor.kind === 'node' || cursor.kind === 'origin') { ctx.strokeStyle = '#16a34a'; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.stroke(); }
    else if (cursor.kind === 'wall') { ctx.strokeStyle = '#ea580c'; ctx.strokeRect(p.x - 8, p.y - 8, 16, 16); }
    else {
      ctx.strokeStyle = cursor.kind === 'ortho' ? '#2563eb' : '#6b7280'; ctx.beginPath();
      ctx.moveTo(p.x - 9, p.y); ctx.lineTo(p.x + 9, p.y); ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x, p.y + 9); ctx.stroke();
    }
  }
  // Koordinatenanzeige (relativ zum Nullpunkt)
  const cp = (stage === 1 && cursor) ? cursor : hover;
  if (cp) {
    const r = rel(cp);
    let t = `x ${fmtLen(r.x)}   y ${fmtLen(r.y)}`;
    if (fp && cursor) { const d = rel(fp); t += `   Δx ${fmtLen(r.x - d.x)}   Δy ${fmtLen(r.y - d.y)}`; }
    ctx.font = '500 13px ui-monospace, Consolas, monospace';
    const w = ctx.measureText(t).width + 16;
    ctx.fillStyle = 'rgba(17,24,39,.85)'; ctx.fillRect(W - w - 10, H - 34, w, 24);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, W - w - 2, H - 21);
  }
}

// ---------- Eingabe ----------
const evPos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function startPan(sp) { gesture = { type: 'pan', sp, ox0: view.ox, oy0: view.oy }; cv.classList.add('grabbing'); }
function abortGesture() {
  const g = gesture;
  if (g && (g.type === 'dragNode' || g.type === 'dragWall') && g.moved) doc = JSON.parse(g.before);
  gesture = null; cv.classList.remove('grabbing');
}
function startPinch() {
  const [p, q] = [...pointers.values()];
  gesture = { type: 'pinch', d0: dist(p, q) || 1, m0: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, s0: view.s, ox0: view.ox, oy0: view.oy };
}
function updatePinch() {
  const g = gesture, [p, q] = [...pointers.values()];
  const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const wx = (g.m0.x - g.ox0) / g.s0, wy = (g.m0.y - g.oy0) / g.s0;
  view.s = clampS(g.s0 * dist(p, q) / g.d0);
  view.ox = m.x - wx * view.s; view.oy = m.y - wy * view.s; render();
}
const activeTool = () => (stage === 7 ? 'pan' : tool);

cv.addEventListener('pointerdown', e => {
  e.preventDefault(); closeMenu();
  isMouse = e.pointerType === 'mouse';
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* z. B. synthetische Ereignisse */ }
  const sp = evPos(e); pointers.set(e.pointerId, sp);
  if (pointers.size === 2) { abortGesture(); startPinch(); refresh(); return; }
  if (pointers.size > 2) return;
  const wp = toWorld(sp.x, sp.y), t = activeTool();
  if (e.button === 1 || e.button === 2 || spaceDown || t === 'pan') { startPan(sp); return; }
  if (t === 'wall' || t === 'origin') { gesture = { type: 'draw' }; cursor = findSnap(wp, t === 'wall' ? chainFrom() : null); render(); return; }
  const tol = SNAP_PX / view.s;
  if (stage === 3) {                      // Wände wählen (mehrere mit Strg/Umschalt oder „Mehrfach“)
    const w = hitWall(wp, tol);
    const add = multi || e.ctrlKey || e.metaKey || e.shiftKey;
    if (w) {
      const ids = lineMembers(w).map(x => x.id);
      if (add && sel?.type === 'wall') {
        const has = ids.every(id => sel.ids.includes(id));
        const next = has ? sel.ids.filter(id => !ids.includes(id)) : [...new Set([...sel.ids, ...ids])];
        sel = next.length ? { type: 'wall', ids: next } : null;
      } else sel = { type: 'wall', ids };
      refresh(); return;
    }
    if (!add) sel = null;
    startPan(sp); refresh(); return;
  }
  const n = hitNode(wp, tol);
  if (n) { sel = { type: 'node', id: n.id }; cornerSwap = false; gesture = { type: 'dragNode', id: n.id, before: snapshot(), start: wp, sp, moved: false }; refresh(); return; }
  const w = hitWall(wp, tol);
  if (w) { sel = { type: 'wall', ids: [w.id] }; gesture = { type: 'dragWall', id: w.id, before: snapshot(), start: wp, sp, moved: false }; refresh(); return; }
  sel = null; startPan(sp); refresh();
});

cv.addEventListener('pointermove', e => {
  const sp = evPos(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, sp);
  const g = gesture;
  if (g?.type === 'pinch') { if (pointers.size === 2) updatePinch(); return; }
  if (g?.type === 'none') return;
  const wp = toWorld(sp.x, sp.y);
  if (e.pointerType !== 'touch') hover = wp;
  const t = activeTool();
  if (!g) {
    if ((t === 'wall' || t === 'origin') && e.pointerType !== 'touch') cursor = findSnap(wp, t === 'wall' ? chainFrom() : null);
    render(); return;
  }
  if (g.type === 'pan') { view.ox = g.ox0 + sp.x - g.sp.x; view.oy = g.oy0 + sp.y - g.sp.y; render(); return; }
  if (g.type === 'draw') { cursor = findSnap(wp, t === 'wall' ? chainFrom() : null); render(); return; }
  if (!g.moved && dist(sp, g.sp) < 4) return;
  g.moved = true; applyDrag(g, wp); render();
});

function onUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  const g = gesture;
  if (pointers.size > 0) { if (g?.type === 'pinch') gesture = { type: 'none' }; return; }
  gesture = null; cv.classList.remove('grabbing');
  if (!g) return;
  if (g.type === 'draw') {
    const sp = evPos(e), t = activeTool();
    cursor = findSnap(toWorld(sp.x, sp.y), t === 'wall' ? chainFrom() : null);
    if (t === 'origin') setOrigin(cursor); else placePoint(cursor);
    if (e.pointerType === 'touch') cursor = null;
  } else if (g.type === 'dragNode' && g.moved) {
    if (g.mergeTo) { mergeNodes(g.id, g.mergeTo); sel = { type: 'node', id: g.mergeTo }; }
    commit(g.before);
  } else if (g.type === 'dragWall' && g.moved) commit(g.before);
  refresh();
}
cv.addEventListener('pointerup', onUp);
cv.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); if (!pointers.size) { abortGesture(); refresh(); } });
cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !gesture) { cursor = null; hover = null; render(); } });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => {
  e.preventDefault();
  if (!e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0) { view.ox -= e.deltaX; view.oy -= e.deltaY; render(); return; } // Trackpad-Wischen
  const sp = evPos(e); zoomAt(sp.x, sp.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault()));

function setOrigin(p) {
  const before = snapshot();
  settings().origin = { x: p.x, y: p.y };
  tool = 'wall'; commit(before);
  toast('Nullpunkt gesetzt');
}

document.addEventListener('keydown', e => {
  if (e.target.closest?.('input, select, textarea')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a' && stage === 3) { e.preventDefault(); sel = doc.walls.length ? { type: 'wall', ids: doc.walls.map(w => w.id) } : null; refresh(); return; }
  if (mod) return;
  if (k === ' ') { spaceDown = true; cv.classList.add('pan'); e.preventDefault(); }
  else if (k === 'escape') { if (chain) endChain(); else { sel = null; refresh(); } }
  else if (k === 'enter') endChain();
  else if ((k === 'delete' || k === 'backspace') && stage !== 7) { e.preventDefault(); deleteSelection(); }
  else if (k === 'w' && stage === 1) setTool('wall');
  else if (k === 'n' && stage === 1) setTool('origin');
  else if (k === 'v' && stage !== 7) setTool('select');
  else if (k === 'h') setTool('pan');
  else if (k === 'f') fitView();
});
document.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; cv.classList.toggle('pan', activeTool() === 'pan'); } });

// ---------- Oberfläche ----------
function setTool(t) { tool = t; chain = null; if (t !== 'wall' && t !== 'origin') cursor = null; refresh(); }
function setStage(s) {
  stage = s; chain = null; cursor = null; cornerSwap = false;
  if (s === 7 || (s === 3 && sel?.type === 'node')) sel = null;
  if (s !== 1 && (tool === 'wall' || tool === 'origin')) tool = 'select';
  if (s === 1 && tool === 'pan') tool = 'wall';
  refresh();
}
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

function hintText() {
  const t = activeTool();
  if (stage === 7) return '';
  if (t === 'pan') return 'Ziehen = Ansicht verschieben · Mausrad / zwei Finger = zoomen';
  if (stage === 1) {
    if (t === 'origin') return 'Nullpunkt antippen (fängt an Eckpunkten). Koordinaten unten rechts beziehen sich darauf.';
    if (t === 'wall') return chain ? 'Nächsten Punkt tippen · letzten Punkt erneut tippen oder „Fertig“ = Wandzug beenden'
      : 'Ersten Punkt tippen, um Wände zu zeichnen. Grün = Eckpunkt fangen, Orange = auf Wand andocken';
    return 'Wand oder Eckpunkt antippen · ziehen = verschieben · Eckpunkt auf anderen ziehen = verbinden';
  }
  if (stage === 2) return 'Orange = noch schief bzw. Richtung frei · Ecke antippen = Winkel setzen · Wand antippen = Richtung fixieren';
  if (stage === 3) {
    const used = [...new Set(doc.walls.map(w => w.thick))].sort((a, b) => b - a);
    return 'Wand antippen (Strg+Klick = mehrere) · ' + used.map(t => `<i class="chip" style="background:${thickColor(t)}"></i>${fmtNum(t)} cm`).join('');
  }
  return '';
}
function refresh() {
  document.body.dataset.stage = stage;
  document.querySelectorAll('.stage').forEach(b => b.classList.toggle('active', +b.dataset.stage === stage));
  document.querySelectorAll('[data-stages]').forEach(b => { b.hidden = !b.dataset.stages.split(',').includes(String(stage)); });
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === activeTool()));
  $('#orthoBtn').classList.toggle('on', ortho);
  $('#multiBtn').classList.toggle('on', multi);
  $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length;
  cv.classList.toggle('pan', activeTool() === 'pan');
  const h = hintText(); $('#hint').innerHTML = h ? `<span>${h}</span>` : '';
  renderProps();
  render();
}
function renderProps() {
  const p = $('#props'), ws = selWalls();
  const total = doc.walls.reduce((s, w) => s + wallLen(w), 0);
  if (stage === 7) {
    p.innerHTML = `<span class="info">Vorschau ohne Hilfslinien und Maße</span><button class="primary" data-act="export">Bild exportieren</button>`;
  } else if (stage === 1 && chain) {
    p.innerHTML = `<span class="info">Wandzug: <b>${cursor ? fmtLen(dist(chainFrom(), cursor)) : '–'}</b></span><button class="primary" data-act="end">Fertig</button>`;
  } else if (stage === 2 && sel?.type === 'node') {
    const c = cornerInfo(sel.id);
    p.innerHTML = c
      ? `<span class="info">Ecke <b>${fmtNum(c.ang)}°</b></span>
         <input id="angIn" inputmode="decimal" value="${fmtNum(c.ang)}"><button data-act="angSet">Setzen</button>
         <span class="sep"></span>
         ${[90, 135, 45].map(a => `<button data-act="ang" data-val="${a}">${a}°</button>`).join('')}
         <button data-act="swap" class="${cornerSwap ? 'on' : ''}">Andere Wand drehen</button>`
      : `<span class="info">Winkel nur an Ecken mit genau zwei Wänden einstellbar</span>`;
  } else if (stage === 2 && ws.length) {
    const w = ws[0];
    p.innerHTML = w.dir != null
      ? `<span class="info">Wand · Richtung <b>${w.dir}°</b> fixiert · ${fmtLen(wallLen(w))}</span><button data-act="unfix">Lösen</button>`
      : `<span class="info">Wand · frei (${fmtNum(norm180(wallAngle(w)))}°) · ${fmtLen(wallLen(w))}</span><button class="primary" data-act="fix">Auf nächste 45° fixieren</button>`;
  } else if (stage === 2) {
    const free = doc.walls.filter(w => w.dir == null).length;
    p.innerHTML = `<button class="primary" data-act="align">Alle Winkel ausrichten</button>
      <span class="info">${skewCorners()} schiefe Ecken · ${free} freie Wände</span>`;
  } else if (stage === 3 && ws.length) {
    const same = ws.every(w => w.thick === ws[0].thick) ? ws[0].thick : null;
    const side = ws.every(w => w.side === 'C') ? 'mittig' : ws.every(w => w.side !== 'C') ? 'Innenkante' : 'gemischt';
    p.innerHTML = `<span class="info"><b>${ws.length}</b> ${ws.length === 1 ? 'Wand' : 'Wände'} · Bezug ${side}</span>
      ${THICKS.map(t => `<button data-act="thick" data-val="${t}" class="${same === t ? 'on' : ''}">${fmtNum(t)}</button>`).join('')}
      <input id="thIn" inputmode="decimal" placeholder="cm" value="${same != null && !THICKS.includes(same) ? fmtNum(same) : ''}"><button data-act="thSet">cm</button>
      <span class="sep"></span>
      <button data-act="side">Seite wechseln</button><button data-act="center">Mittig</button>`;
  } else if (stage === 3) {
    p.innerHTML = `<button class="primary" data-act="outer">Außenwände erkennen</button><button data-act="all">Alle wählen</button>
      <span class="info">Neue Wände: ${fmtNum(settings().lastThick)} cm</span>`;
  } else if (sel?.type === 'wall' && ws.length) {
    p.innerHTML = `<span class="info">Wand · Länge <b>${fmtLen(wallLen(ws[0]))}</b> · Dicke ${fmtNum(ws[0].thick)} cm</span><button class="danger" data-act="del">Löschen</button>`;
  } else if (sel?.type === 'node' && nodeById(sel.id)) {
    const n = nodeById(sel.id), r = rel(n), cnt = doc.walls.filter(w => w.a === sel.id || w.b === sel.id).length;
    p.innerHTML = `<span class="info">Eckpunkt · x ${fmtLen(r.x)} · y ${fmtLen(r.y)} · ${cnt} Wand/Wände</span><button class="danger" data-act="del">Löschen</button>`;
  } else p.innerHTML = `<span class="info">${doc.walls.length} Wände · ${fmtLen(total)} gesamt</span>`;
}
$('#props').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, v = parseNum(b.dataset.val);
  if (a === 'end') endChain();
  else if (a === 'del') deleteSelection();
  else if (a === 'export') openExport();
  else if (a === 'align') alignAll();
  else if (a === 'ang') setCornerAngle(sel.id, v);
  else if (a === 'angSet') setCornerAngle(sel.id, parseNum($('#angIn').value));
  else if (a === 'swap') { cornerSwap = !cornerSwap; refresh(); }
  else if (a === 'fix') fixWalls(true);
  else if (a === 'unfix') fixWalls(false);
  else if (a === 'thick') setThick(v);
  else if (a === 'thSet') setThick(parseNum($('#thIn').value));
  else if (a === 'side') setSide('flip');
  else if (a === 'center') setSide('C');
  else if (a === 'outer') detectOuter();
  else if (a === 'all') { sel = doc.walls.length ? { type: 'wall', ids: doc.walls.map(w => w.id) } : null; refresh(); }
});
$('#props').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'angIn') setCornerAngle(sel.id, parseNum(e.target.value));
  if (e.target.id === 'thIn') setThick(parseNum(e.target.value));
});
document.querySelectorAll('.stage').forEach(b => b.addEventListener('click', () => setStage(+b.dataset.stage)));
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#fit').addEventListener('click', fitView);
$('#orthoBtn').addEventListener('click', () => { ortho = !ortho; refresh(); });
$('#multiBtn').addEventListener('click', () => { multi = !multi; refresh(); });
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#exportBtn2').addEventListener('click', openExport);

// Menü
const menu = $('#menu');
function closeMenu() { menu.hidden = true; }
$('#menuBtn').addEventListener('click', e => {
  e.stopPropagation(); menu.hidden = !menu.hidden; $('#projName').value = doc.name;
  $('#bgColor').value = settings().bg; $('#bgTransp').checked = settings().transparent;
});
$('#bgColor').addEventListener('change', e => { const before = snapshot(); settings().bg = e.target.value; settings().transparent = false; $('#bgTransp').checked = false; commit(before); });
$('#bgTransp').addEventListener('change', e => { const before = snapshot(); settings().transparent = e.target.checked; commit(before); });
document.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('#menu, #menuBtn')) closeMenu(); });
$('#projName').addEventListener('change', e => { const before = snapshot(); doc.name = e.target.value.trim() || 'Mein Haus'; commit(before); });
menu.addEventListener('click', e => {
  const m = e.target.closest('[data-menu]')?.dataset.menu; if (!m) return;
  closeMenu();
  if (m === 'new') {
    if (doc.walls.length && !confirm('Neues Projekt beginnen? Der aktuelle Plan wird ersetzt (Rückgängig ist möglich).')) return;
    const before = snapshot(); doc = newDoc(); chain = null; sel = null; commit(before); fitView();
  } else if (m === 'save') {
    download(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' }), safeName() + '.grundriss.json');
  } else if (m === 'open') $('#fileIn').click();
  else if (m === 'export') openExport();
});
$('#fileIn').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result); if (!valid(d)) throw new Error('kein Grundriss-Projekt');
      const before = snapshot(); doc = migrate(d); chain = null; sel = null; commit(before); fitView();
    } catch (err) { alert('Datei konnte nicht geöffnet werden: ' + err.message); }
  };
  r.readAsText(f); e.target.value = '';
});
$('#ver').textContent = 'Version ' + VERSION;

// ---------- Export ----------
const safeName = () => (doc.name || 'grundriss').replace(/[^\wäöüÄÖÜß\- ]+/g, '').trim().replace(/\s+/g, '_') || 'grundriss';
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function openExport() {
  if (!doc.walls.length) { alert('Noch keine Wände gezeichnet.'); return; }
  exportImage().then(r => download(r.blob, r.name));
}
// PNG in voreingestellter Größe (Breite EXPORT_WIDTH px). Liefert {blob, name, width, height}
const EXPORT_WIDTH = 2000, EXPORT_MARGIN = 50;
function exportImage({ width = EXPORT_WIDTH, margin = EXPORT_MARGIN } = {}) {
  const b = bbox(); if (!b) return Promise.reject(new Error('leer'));
  const pad = Math.max(0, ...doc.walls.map(w => w.thick)) + margin;
  const x0 = b.x0 - pad, y0 = b.y0 - pad, bw = b.x1 - b.x0 + 2 * pad, bh = b.y1 - b.y0 + 2 * pad;
  let w = Math.max(200, Math.min(8000, Math.round(width))), h = Math.round(bh * w / bw);
  const maxArea = 16e6;                                  // Grenze für Canvas-Größe (iPad)
  if (w * h > maxArea) { const f = Math.sqrt(maxArea / (w * h)); w = Math.floor(w * f); h = Math.floor(h * f); }
  const k = w / bw;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!settings().transparent) { g.fillStyle = settings().bg; g.fillRect(0, 0, w, h); }
  g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  drawPlan(g, 'final', k);
  return new Promise(res => c.toBlob(blob => res({ blob, name: safeName() + '.png', width: w, height: h }), 'image/png'));
}

// ---------- Start ----------
new ResizeObserver(resize).observe(cv);
resize(); fitView(); refresh();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

// Testschnittstelle (für automatische Tests / Fehlersuche)
window.GR = { get doc() { return doc; }, view, exportImage, undo, redo, setStage, setTool, fitView, alignAll, detectOuter,
  setCornerAngle, setThick, geometry, get sel() { return sel; }, set sel(v) { sel = v; refresh(); }, VERSION };
})();
