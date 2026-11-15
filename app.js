'use strict';
/* Grundriss – einfaches 2D-CAD für Bestandspläne. Einheiten im Modell: Zentimeter. */
(() => {
const VERSION = '0.1.0';
const STORE_KEY = 'grundriss.projekt.v1';
const SNAP_PX = 16;        // Fangradius in Bildschirm-Pixeln (Touch-freundlich)
const DEFAULT_THICK = 24;  // cm, bis Stufe 3 (Wanddicken) verfügbar ist
const ORTHO_TOL = 6;       // Grad Toleranz für 0°/45°/90°-Fangen

const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d');

// ---------- Zustand ----------
let doc = load() || newDoc();
const view = { s: 0.5, ox: 0, oy: 0 };       // Bildschirm = Welt * s + o
let W = 0, H = 0, DPR = 1;
let stage = 1, tool = 'wall', ortho = true;
let sel = null;                                // {type:'wall'|'node', id}
let chain = null;                              // {from: snap} – laufender Wandzug
let cursor = null;                             // Fang-Ergebnis für Vorschau
let gesture = null, spaceDown = false;
const pointers = new Map();
const undoStack = [], redoStack = [];

function newDoc() { return { app: 'grundriss', version: 1, name: 'Mein Haus', nextId: 1, nodes: [], walls: [], settings: defaultSettings() }; }
function defaultSettings() { return { bg: '#ffffff', transparent: false }; }
const settings = () => (doc.settings ||= defaultSettings());
const uid = () => doc.nextId++;
const nodeById = id => doc.nodes.find(n => n.id === id);
const wallById = id => doc.walls.find(w => w.id === id);
const snapshot = () => JSON.stringify(doc);

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
  try { const d = JSON.parse(localStorage.getItem(STORE_KEY)); return valid(d) ? d : null; } catch (e) { return null; }
}
function valid(d) { return d && d.app === 'grundriss' && Array.isArray(d.nodes) && Array.isArray(d.walls); }

// ---------- Geometrie ----------
const toWorld = (sx, sy) => ({ x: (sx - view.ox) / view.s, y: (sy - view.oy) / view.s });
const toScreen = p => ({ x: p.x * view.s + view.ox, y: p.y * view.s + view.oy });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function distPtSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx, y = a.y + t * dy;
  return { d: Math.hypot(p.x - x, p.y - y), t, x, y };
}
// Schnitt Strahl (o + u*d) mit Strecke a-b
function raySeg(o, d, a, b) {
  const ex = b.x - a.x, ey = b.y - a.y, den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-9) return null;
  const u = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
  const t = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
  if (u <= 0 || t <= 0.001 || t >= 0.999) return null;
  return { x: o.x + u * d.x, y: o.y + u * d.y };
}
const wallLen = w => dist(nodeById(w.a), nodeById(w.b));
const fmtLen = cm => (cm / 100).toFixed(2).replace('.', ',') + ' m';

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
  return best;
}

// Fangen: vorhandener Eckpunkt > Gerade (0/45/90°) > Punkt auf Wand > frei
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
    if (dir) { const ix = raySeg(from, dir, a, b); if (ix && dist(ix, q) < tol) pt = ix; }
    bd = r.d; best = { x: pt.x, y: pt.y, wallId: w.id, kind: 'wall' };
  }
  return best || q;
}

// ---------- Modell-Operationen ----------
function splitWall(w, x, y) {
  const n = { id: uid(), x, y }; doc.nodes.push(n);
  doc.walls.push({ id: uid(), a: n.id, b: w.b, thick: w.thick });
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
  if (a !== b && !hasWall(a, b)) doc.walls.push({ id: uid(), a, b, thick: DEFAULT_THICK });
  const onExisting = sn.kind === 'node' || sn.kind === 'wall';
  chain = onExisting ? null : { from: { x: sn.x, y: sn.y, nodeId: b, kind: 'node' } };
  commit(before);
}
function endChain() { chain = null; if (!isMouse) cursor = null; refresh(); }

function deleteSelection() {
  if (!sel) return;
  const before = snapshot();
  if (sel.type === 'wall') doc.walls = doc.walls.filter(w => w.id !== sel.id);
  else doc.walls = doc.walls.filter(w => w.a !== sel.id && w.b !== sel.id);
  sel = null; cleanup(); commit(before);
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
  if (!b) { view.s = 0.5; view.ox = W / 2; view.oy = H / 2; render(); return; }
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
  }
  if (stage !== 7) drawGrid();
  ctx.setTransform(DPR * view.s, 0, 0, DPR * view.s, DPR * view.ox, DPR * view.oy);
  drawPlan(ctx, stage === 7 ? 'final' : 'sketch', view.s);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (stage !== 7) drawOverlay();
}
function drawChecker() {   // Schachbrett = transparenter Hintergrund
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#e5e7eb';
  for (let y = 0; y < H; y += 16) for (let x = (y / 16) % 2 ? 16 : 0; x < W; x += 32) ctx.fillRect(x, y, 16, 16);
}
// Wandfarbe: hell auf dunklem Hintergrund, sonst dunkel
function wallColor() {
  const s = settings(); if (s.transparent) return '#222222';
  const h = s.bg.replace('#', ''), r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128 ? '#e5e7eb' : '#222222';
}
function drawGrid() {
  const steps = [10, 25, 50, 100, 250, 500, 1000, 2500];
  const minor = steps.find(s => s * view.s >= 12) || 5000;
  const major = minor < 100 ? 100 : minor * 4;
  const a = toWorld(0, 0), b = toWorld(W, H);
  const lines = (step, color) => {
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1;
    for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step) { const sx = Math.round(x * view.s + view.ox) + .5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = Math.floor(a.y / step) * step; y <= b.y; y += step) { const sy = Math.round(y * view.s + view.oy) + .5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();
  };
  lines(minor, '#ecebe7'); lines(major, '#d9d7d0');
}
// Plan in Weltkoordinaten (Transformation ist gesetzt). mode: 'sketch' | 'final'
function drawPlan(c, mode, s) {
  c.lineCap = mode === 'final' ? 'square' : 'round';
  c.strokeStyle = mode === 'final' ? wallColor() : '#374151';
  for (const w of doc.walls) {
    const a = nodeById(w.a), b = nodeById(w.b);
    c.lineWidth = mode === 'final' ? w.thick : 2.5 / s;
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  }
}
function label(text, x, y, color) {
  ctx.font = '600 13px -apple-system, "Segoe UI", sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(255,255,255,.93)'; ctx.fillRect(x - w / 2, y - 11, w, 22);
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 + .5, y - 10.5, w - 1, 21);
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1);
}
function drawOverlay() {
  // Auswahl
  if (sel?.type === 'wall') {
    const w = wallById(sel.id);
    if (w) {
      const a = toScreen(nodeById(w.a)), b = toScreen(nodeById(w.b));
      ctx.strokeStyle = 'rgba(37,99,235,.85)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      label(fmtLen(wallLen(w)), (a.x + b.x) / 2, (a.y + b.y) / 2 - 18, '#1d4ed8');
    }
  }
  // Eckpunkte
  for (const n of doc.nodes) {
    const p = toScreen(n), on = sel?.type === 'node' && sel.id === n.id;
    ctx.beginPath(); ctx.arc(p.x, p.y, on ? 7 : 4, 0, Math.PI * 2);
    ctx.fillStyle = on ? '#2563eb' : '#fff'; ctx.fill();
    ctx.strokeStyle = on ? '#1d4ed8' : '#374151'; ctx.lineWidth = 1.5; ctx.stroke();
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
  if (cursor && tool === 'wall') {
    const p = toScreen(cursor);
    ctx.lineWidth = 2;
    if (cursor.kind === 'node') { ctx.strokeStyle = '#16a34a'; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.stroke(); }
    else if (cursor.kind === 'wall') { ctx.strokeStyle = '#ea580c'; ctx.strokeRect(p.x - 8, p.y - 8, 16, 16); }
    else { ctx.strokeStyle = cursor.kind === 'ortho' ? '#2563eb' : '#6b7280'; ctx.beginPath();
      ctx.moveTo(p.x - 9, p.y); ctx.lineTo(p.x + 9, p.y); ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x, p.y + 9); ctx.stroke(); }
  }
}

// ---------- Eingabe ----------
let isMouse = true;
const evPos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function startPan(sp) { gesture = { type: 'pan', sp, ox0: view.ox, oy0: view.oy, moved: false }; cv.classList.add('grabbing'); }
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

cv.addEventListener('pointerdown', e => {
  e.preventDefault(); closeMenu();
  isMouse = e.pointerType === 'mouse';
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* z. B. synthetische Ereignisse */ }
  const sp = evPos(e); pointers.set(e.pointerId, sp);
  if (pointers.size === 2) { abortGesture(); startPinch(); refresh(); return; }
  if (pointers.size > 2) return;
  const wp = toWorld(sp.x, sp.y);
  if (e.button === 1 || e.button === 2 || spaceDown || tool === 'pan' || stage === 7) { startPan(sp); return; }
  if (tool === 'wall') { gesture = { type: 'draw' }; cursor = findSnap(wp, chainFrom()); render(); return; }
  // Auswahl
  const tol = SNAP_PX / view.s;
  const n = hitNode(wp, tol);
  if (n) { sel = { type: 'node', id: n.id }; gesture = { type: 'dragNode', id: n.id, before: snapshot(), start: wp, sp, orig: { x: n.x, y: n.y }, moved: false }; refresh(); return; }
  const w = hitWall(wp, tol);
  if (w) {
    const a = nodeById(w.a), b = nodeById(w.b); sel = { type: 'wall', id: w.id };
    gesture = { type: 'dragWall', id: w.id, before: snapshot(), start: wp, sp, oa: { x: a.x, y: a.y }, ob: { x: b.x, y: b.y }, moved: false };
    refresh(); return;
  }
  sel = null; startPan(sp); refresh();
});

cv.addEventListener('pointermove', e => {
  const sp = evPos(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, sp);
  const g = gesture;
  if (g?.type === 'pinch') { if (pointers.size === 2) updatePinch(); return; }
  if (g?.type === 'none') return;
  const wp = toWorld(sp.x, sp.y);
  if (!g) { if (tool === 'wall' && stage === 1 && e.pointerType !== 'touch') { cursor = findSnap(wp, chainFrom()); render(); } return; }
  if (g.type === 'pan') { view.ox = g.ox0 + sp.x - g.sp.x; view.oy = g.oy0 + sp.y - g.sp.y; render(); return; }
  if (g.type === 'draw') { cursor = findSnap(wp, chainFrom()); render(); return; }
  if (!g.moved && dist(sp, g.sp) < 4) return;
  g.moved = true;
  const dx = wp.x - g.start.x, dy = wp.y - g.start.y;
  if (g.type === 'dragNode') {
    const n = nodeById(g.id); let p = { x: g.orig.x + dx, y: g.orig.y + dy };
    const m = hitNode(p, SNAP_PX / view.s, g.id);
    g.mergeTo = m ? m.id : null; if (m) p = { x: m.x, y: m.y };
    n.x = p.x; n.y = p.y;
  } else if (g.type === 'dragWall') {
    const w = wallById(g.id), a = nodeById(w.a), b = nodeById(w.b);
    a.x = g.oa.x + dx; a.y = g.oa.y + dy; b.x = g.ob.x + dx; b.y = g.ob.y + dy;
  }
  render();
});

function onUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  const g = gesture;
  if (pointers.size > 0) { if (g?.type === 'pinch') gesture = { type: 'none' }; return; }
  gesture = null; cv.classList.remove('grabbing');
  if (!g) return;
  if (g.type === 'draw') {
    const sp = evPos(e);
    cursor = findSnap(toWorld(sp.x, sp.y), chainFrom());
    placePoint(cursor);
    if (e.pointerType === 'touch') cursor = null;
  } else if (g.type === 'dragNode' && g.moved) {
    if (g.mergeTo) { mergeNodes(g.id, g.mergeTo); sel = { type: 'node', id: g.mergeTo }; }
    commit(g.before);
  } else if (g.type === 'dragWall' && g.moved) commit(g.before);
  refresh();
}
cv.addEventListener('pointerup', onUp);
cv.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); if (!pointers.size) { abortGesture(); refresh(); } });
cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !gesture) { cursor = null; render(); } });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => {
  e.preventDefault();
  if (!e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0) { view.ox -= e.deltaX; view.oy -= e.deltaY; render(); return; } // Trackpad-Wischen
  const sp = evPos(e); zoomAt(sp.x, sp.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault()));

document.addEventListener('keydown', e => {
  if (e.target.closest?.('input, select, textarea')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod) return;
  if (k === ' ') { spaceDown = true; cv.classList.add('pan'); e.preventDefault(); }
  else if (k === 'escape') { if (chain) endChain(); else { sel = null; refresh(); } }
  else if (k === 'enter') endChain();
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelection(); }
  else if (k === 'w' && stage === 1) setTool('wall');
  else if (k === 'v' && stage === 1) setTool('select');
  else if (k === 'h') setTool('pan');
  else if (k === 'f') fitView();
});
document.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; cv.classList.remove('pan'); } });

// ---------- Oberfläche ----------
function setTool(t) { tool = t; chain = null; if (t !== 'wall') cursor = null; refresh(); }
function setStage(s) { stage = s; chain = null; cursor = null; if (s === 7) sel = null; if (s === 1 && tool === 'pan') tool = 'wall'; refresh(); }

const HINTS = {
  wall: () => chain ? 'Nächsten Punkt tippen · letzten Punkt erneut tippen oder „Fertig“ = Wandzug beenden'
                    : 'Ersten Punkt tippen, um Wände zu zeichnen. Grün = Eckpunkt fangen, Orange = auf Wand andocken',
  select: () => 'Wand oder Eckpunkt antippen · ziehen = verschieben · Eckpunkt auf anderen ziehen = verbinden',
  pan: () => 'Ziehen = Ansicht verschieben · zwei Finger / Mausrad = zoomen',
};
function refresh() {
  document.body.dataset.stage = stage;
  document.querySelectorAll('.stage').forEach(b => b.classList.toggle('active', +b.dataset.stage === stage));
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  $('#orthoBtn').classList.toggle('on', ortho);
  $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length;
  cv.classList.toggle('pan', tool === 'pan' || stage === 7);
  $('#hint').innerHTML = stage === 7 ? '' : `<span>${HINTS[tool]()}</span>`;
  renderProps();
  render();
}
function renderProps() {
  const p = $('#props');
  const total = doc.walls.reduce((s, w) => s + wallLen(w), 0);
  const stats = `<span class="info">${doc.walls.length} Wände · ${fmtLen(total)} gesamt</span>`;
  if (stage === 7) {
    p.innerHTML = `<span class="info">Vorschau ohne Hilfslinien und Maße</span><button class="primary" data-act="export">Bild exportieren</button>`;
  } else if (chain) {
    const fp = chainFrom();
    p.innerHTML = `<span class="info">Wandzug: <b>${cursor ? fmtLen(dist(fp, cursor)) : '–'}</b></span><button class="primary" data-act="end">Fertig</button>`;
  } else if (sel?.type === 'wall' && wallById(sel.id)) {
    p.innerHTML = `<span class="info">Wand · Länge <b>${fmtLen(wallLen(wallById(sel.id)))}</b> · Dicke ${wallById(sel.id).thick} cm</span><button class="danger" data-act="del">Löschen</button>`;
  } else if (sel?.type === 'node' && nodeById(sel.id)) {
    const cnt = doc.walls.filter(w => w.a === sel.id || w.b === sel.id).length;
    p.innerHTML = `<span class="info">Eckpunkt · ${cnt} Wand/Wände</span><button class="danger" data-act="del">Löschen</button>`;
  } else p.innerHTML = stats;
}
$('#props').addEventListener('click', e => {
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (a === 'end') endChain(); else if (a === 'del') deleteSelection(); else if (a === 'export') openExport();
});
document.querySelectorAll('.stage').forEach(b => b.addEventListener('click', () => setStage(+b.dataset.stage)));
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#fit').addEventListener('click', fitView);
$('#orthoBtn').addEventListener('click', () => { ortho = !ortho; refresh(); });
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#exportBtn2').addEventListener('click', openExport);

// Menü
const menu = $('#menu');
function closeMenu() { menu.hidden = true; }
$('#menuBtn').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; $('#projName').value = doc.name;
  $('#bgColor').value = settings().bg; $('#bgTransp').checked = settings().transparent; });
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
      const before = snapshot(); doc = d; chain = null; sel = null; commit(before); fitView();
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
  const pad = Math.max(0, ...doc.walls.map(w => w.thick)) / 2 + margin;
  const x0 = b.x0 - pad, y0 = b.y0 - pad, bw = b.x1 - b.x0 + 2 * pad, bh = b.y1 - b.y0 + 2 * pad;
  let w = Math.max(200, Math.min(8000, Math.round(width))), h = Math.round(bh * w / bw);
  const maxArea = 16e6;                                  // iPad-Grenze für Canvas-Größe
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
window.GR = { get doc() { return doc; }, view, exportImage, undo, redo, setStage, setTool, fitView, VERSION };
})();
