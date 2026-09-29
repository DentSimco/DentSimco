// DentSimco — grafik çizici
// Harici kütüphane kullanmaz; tek bir <canvas> üzerine çizer, tablette hızlı çalışır.
//   Çizgiler (fiyatlar) sağdaki fiyat eksenini, sütunlar (hacimler) alttaki hacim bölgesini kullanır.
//   Bir seri açılıp kapanınca eksenler ve kalan çizgiler yumuşakça yer değiştirip boşluğu kapatır.
//   Kalite değişince çizgiler yeni değerlerine kayar; ürün ya da aralık değişince soldan sağa çizilir.
//   Grafiğe dokunup sağa sola sürükleyince imleç o noktayı seçer (onHover ile bildirir).

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const FONT = '500 12px "Barlow Semi Condensed", "Barlow", system-ui, sans-serif';
const THEME = {
  grid: 'rgba(120, 165, 230, 0.08)',
  base: 'rgba(120, 165, 230, 0.22)',
  dayLine: 'rgba(143, 211, 255, 0.14)',
  label: '#7489a8',
  cross: 'rgba(143, 211, 255, 0.5)',
  pill: '#132540',
  pillText: '#e3eefa',
  ring: '#060c17',
  tagText: '#02131b',
};

export function niceTicks(min, max, count) {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return { step: 1, values: [] };
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const values = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) values.push(Number(v.toPrecision(12)));
  return { step, values };
}

// Yerel saate hizalı zaman çentikleri
const STEPS = [5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 61 * DAY, 91 * DAY, 182 * DAY, 365 * DAY];

export function timeTicks(min, max, maxCount) {
  const span = max - min;
  const step = STEPS.find((s) => span / s <= maxCount) ?? STEPS[STEPS.length - 1];
  const values = [];
  const d = new Date(min);
  d.setHours(0, 0, 0, 0);
  if (step < DAY) {
    for (let t = d.getTime(); t <= max; t += step) if (t >= min) values.push(t);
  } else if (step < 30 * DAY) {
    const k = Math.round(step / DAY);
    for (; d.getTime() <= max; d.setDate(d.getDate() + k)) if (d.getTime() >= min) values.push(d.getTime());
  } else {
    const months = Math.max(1, Math.round(step / (30.4 * DAY)));
    d.setDate(1);
    d.setMonth(Math.floor(d.getMonth() / months) * months);
    for (; d.getTime() <= max; d.setMonth(d.getMonth() + months)) if (d.getTime() >= min) values.push(d.getTime());
  }
  return { step, values };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function medianStep(xs) {
  if (xs.length < 2) return 0;
  const d = [];
  for (let i = 1; i < xs.length; i++) d.push(xs[i] - xs[i - 1]);
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

function pill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export function createChart(host, { series, formatPrice, formatVolume, formatTick, formatPoint, onHover }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'chart-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  const message = document.createElement('p');
  message.className = 'chart-msg';
  message.hidden = true;
  host.append(canvas, message);
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const drawOrder = [...series].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const visible = new Map(series.map((s) => [s.key, s.visible !== false]));
  const alpha = new Map(series.map((s) => [s.key, visible.get(s.key) ? 1 : 0]));

  let data = null; // { xs: [ms], values: {key: [sayı|null]}, daily: bool, dayStarts: Set }
  let from = null; // geçiş sırasındaki eski değerler (aynı zaman ekseni)
  let morph = 1; // 0 → 1: eski değerlerden yenilerine
  let reveal = 1; // 0 → 1: soldan sağa çizim
  let view = null; // anlık ölçek {pMin, pMax, vMax, pBot, vFrac}
  let anim = null;
  let raf = 0;
  let hover = null;
  let dragging = false;
  let size = { w: 0, h: 0, dpr: 1 };
  let geom = null;

  // ---- Hedef ölçek: görünen serilere göre ----
  function targetView() {
    const lines = series.filter((s) => s.kind === 'line' && visible.get(s.key));
    const bars = series.filter((s) => s.kind === 'bar' && visible.get(s.key));
    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (const s of lines) for (const v of data.values[s.key] || []) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (const s of bars) for (const v of data.values[s.key] || []) if (v != null && v > vmax) vmax = v;
    let pMin = view?.pMin ?? 0, pMax = view?.pMax ?? 1;
    if (lo <= hi) {
      const span = hi - lo || Math.abs(hi) * 0.04 || 1;
      pMin = lo - span * 0.12;
      pMax = hi + span * 0.12;
      if (lo >= 0 && pMin < 0) pMin = 0;
    }
    return {
      pMin, pMax,
      vMax: vmax > 0 ? vmax * 1.06 : view?.vMax ?? 1,
      pBot: bars.length ? 0.31 : 0.05, // fiyat bölgesinin altında sütunlara bırakılan pay
      vFrac: lines.length ? 0.27 : 0.9, // sütunların çıkabileceği en fazla yükseklik
    };
  }

  function valueAt(key, i) {
    const to = data.values[key]?.[i];
    if (to == null) return null;
    if (morph >= 1 || !from) return to;
    const a = from[key]?.[i];
    return a == null ? to : lerp(a, to, morph);
  }

  function shownValues() {
    if (!data) return null;
    const out = {};
    for (const s of series) out[s.key] = data.xs.map((_, i) => valueAt(s.key, i));
    return out;
  }

  // ---- Animasyon ----
  function start({ doMorph = false, doReveal = false, dur = 420, instant = false } = {}) {
    const to = targetView();
    const alphaTo = new Map(series.map((s) => [s.key, visible.get(s.key) ? 1 : 0]));
    if (instant || reduceMotion) {
      cancelAnimationFrame(raf);
      view = to;
      alphaTo.forEach((a, k) => alpha.set(k, a));
      morph = 1; reveal = 1; from = null; anim = null;
      draw();
      return;
    }
    anim = {
      t0: performance.now(), dur, from: { ...(doReveal || !view ? to : view) }, to,
      alphaFrom: new Map(alpha), alphaTo,
      morph0: doMorph ? 0 : morph, reveal0: doReveal ? 0 : reveal,
    };
    morph = anim.morph0;
    reveal = anim.reveal0;
    view = anim.from;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  }

  function step(now) {
    if (!anim) return;
    const k = Math.min(1, (now - anim.t0) / anim.dur);
    const e = EASE(k);
    const v = {};
    for (const key in anim.to) v[key] = lerp(anim.from[key], anim.to[key], e);
    view = v;
    anim.alphaFrom.forEach((a, key) => alpha.set(key, lerp(a, anim.alphaTo.get(key), e)));
    morph = lerp(anim.morph0, 1, e);
    reveal = lerp(anim.reveal0, 1, e);
    draw();
    if (k < 1) raf = requestAnimationFrame(step);
    else { anim = null; from = null; morph = 1; reveal = 1; }
  }

  // transition: 'sweep' (soldan çiz), 'morph' (değerler kayar), 'update' (sadece ölçek), 'none'
  function setData(next, transition = 'sweep') {
    const incoming = next && next.xs.length ? next : null;
    const same = data && incoming && data.xs.length === incoming.xs.length && data.xs.every((x, i) => x === incoming.xs[i]);
    if (transition === 'morph' && !same) transition = 'update';
    from = transition === 'morph' ? shownValues() : null;
    data = incoming;
    if (hover != null && (!data || hover >= data.xs.length)) setHover(null);
    if (!data) { anim = null; cancelAnimationFrame(raf); draw(); return; }
    if (transition === 'none') { start({ instant: true }); return; }
    if (transition === 'sweep') { start({ doReveal: true, dur: 620 }); return; }
    start({ doMorph: transition === 'morph' });
  }

  function setVisible(key, on) {
    if (!visible.has(key) || visible.get(key) === on) return;
    visible.set(key, on);
    if (data) start();
    else alpha.set(key, on ? 1 : 0);
  }

  // ---- Çizim ----
  function draw() {
    const { w, h, dpr } = size;
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    geom = null;
    if (!data || !view) return;

    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    const xs = data.xs;
    const n = xs.length;
    const top = 12;
    const bottom = h - 26;
    const ph = bottom - top;
    const pTop = top + ph * 0.03;
    const pBottom = bottom - ph * view.pBot;
    const pSpan = view.pMax - view.pMin || 1;
    const py = (v) => pBottom - ((v - view.pMin) / pSpan) * (pBottom - pTop);
    const vy = (v) => bottom - (v / (view.vMax || 1)) * ph * view.vFrac;
    const lineAlpha = Math.max(0, ...series.filter((s) => s.kind === 'line').map((s) => alpha.get(s.key)));
    const barAlpha = Math.max(0, ...series.filter((s) => s.kind === 'bar').map((s) => alpha.get(s.key)));

    // Sağdaki fiyat ekseni için yer
    const ticks = niceTicks(view.pMin, view.pMax, Math.max(2, Math.min(6, Math.floor((pBottom - pTop) / 46))));
    const lastIdx = lastIndex('anlik');
    const lastVal = lastIdx >= 0 ? valueAt('anlik', lastIdx) : null;
    let gutter = 0;
    for (const v of ticks.values) gutter = Math.max(gutter, ctx.measureText(formatPrice(v, ticks.step)).width);
    if (lastVal != null) gutter = Math.max(gutter, ctx.measureText(formatPrice(lastVal)).width + 10);
    const x0 = 4;
    const x1 = w - Math.ceil(Math.min(120, Math.max(42, gutter + 16)));

    // Zaman ekseni
    const stepMs = medianStep(xs) || (data.daily ? DAY : 15 * MIN);
    const xMin = xs[0] - stepMs / 2;
    const xMax = xs[n - 1] + stepMs / 2;
    const px = (t) => x0 + ((t - xMin) / (xMax - xMin)) * (x1 - x0);
    const barW = Math.max(1.5, Math.min(26, (((x1 - x0) * stepMs) / (xMax - xMin)) * 0.72));
    geom = { x0, x1, xMin, xMax };

    // Izgara ve gün sınırları
    ctx.lineWidth = 1;
    if (lineAlpha > 0.01) {
      ctx.strokeStyle = THEME.grid;
      ctx.globalAlpha = lineAlpha;
      ctx.beginPath();
      for (const v of ticks.values) {
        const y = Math.round(py(v)) + 0.5;
        if (y < top - 1 || y > bottom) continue;
        ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (!data.daily && data.dayStarts?.size) {
      ctx.strokeStyle = THEME.dayLine;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      for (const i of data.dayStarts) {
        const x = Math.round(px(Math.floor(xs[i] / DAY) * DAY)) + 0.5;
        ctx.moveTo(x, top); ctx.lineTo(x, bottom);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = THEME.base;
    ctx.beginPath(); ctx.moveTo(x0, bottom + 0.5); ctx.lineTo(x1, bottom + 0.5); ctx.stroke();

    // Veriler (açılışta soldan sağa)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, x0 + (x1 - x0 + barW) * reveal, h);
    ctx.clip();

    for (const s of drawOrder) {
      if (s.kind !== 'bar') continue;
      const a = alpha.get(s.key) * (s.opacity ?? 1);
      if (a < 0.01) continue;
      const bw = s.inner && barW >= 5 ? barW * 0.56 : barW;
      const r = bw >= 6 ? 2 : 0;
      ctx.fillStyle = hexA(s.color, a);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = valueAt(s.key, i);
        if (!(v > 0)) continue;
        const y = Math.min(vy(v), bottom - 1);
        const x = px(xs[i]) - bw / 2;
        if (r && ctx.roundRect) ctx.roundRect(x, y, bw, bottom - y, [r, r, 0, 0]);
        else ctx.rect(x, y, bw, bottom - y);
      }
      ctx.fill();
    }

    for (const s of drawOrder) {
      if (s.kind !== 'line') continue;
      const a = alpha.get(s.key);
      if (a < 0.01) continue;
      const breaks = s.resets && !data.daily; // gün başında sıfırlanan seriler
      const stepped = s.step && !data.daily; // gün içi en düşük/yüksek basamak gibi çizilir
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width ?? 1.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(s.dash || []);
      ctx.shadowColor = hexA(s.color, 0.85);
      ctx.shadowBlur = (s.glow ?? 7) * dpr;
      ctx.beginPath();
      const dots = [];
      let pen = false, prevY = 0, runStart = 0;
      for (let i = 0; i < n; i++) {
        const v = valueAt(s.key, i);
        if (breaks && pen && data.dayStarts?.has(i)) { if (runStart === i - 1) dots.push(i - 1); pen = false; }
        if (v == null) { if (pen && runStart === i - 1) dots.push(i - 1); pen = false; continue; }
        const x = px(xs[i]);
        const y = py(v);
        if (!pen) { ctx.moveTo(x, y); pen = true; runStart = i; } else {
          if (stepped) ctx.lineTo(x, prevY);
          ctx.lineTo(x, y);
        }
        prevY = y;
      }
      if (pen && runStart === n - 1) dots.push(n - 1);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const i of dots) {
        ctx.beginPath();
        ctx.arc(px(xs[i]), py(valueAt(s.key, i)), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();

    // Hacim ekseni (sol, sütun bölgesinin içinde)
    if (barAlpha > 0.01) {
      const vt = niceTicks(0, view.vMax, 2);
      ctx.globalAlpha = barAlpha;
      ctx.fillStyle = THEME.label;
      ctx.textAlign = 'left';
      for (const v of vt.values) {
        if (v <= 0) continue;
        const y = vy(v);
        if (y < top + 6) continue;
        ctx.strokeStyle = THEME.grid;
        ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x0 + 26, Math.round(y) + 0.5); ctx.stroke();
        ctx.fillText(formatVolume(v), x0 + 30, y);
      }
      ctx.globalAlpha = 1;
    }

    // Fiyat ekseni (sağ) ve son fiyat etiketi
    const tagA = lastVal != null ? alpha.get('anlik') : 0;
    const tagY = lastVal != null ? Math.max(top + 9, Math.min(bottom - 9, py(lastVal))) : -99;
    if (lineAlpha > 0.01) {
      ctx.globalAlpha = lineAlpha;
      ctx.fillStyle = THEME.label;
      ctx.textAlign = 'left';
      for (const v of ticks.values) {
        const y = py(v);
        if (y < top - 1 || y > bottom - 4) continue;
        if (tagA > 0.3 && Math.abs(y - tagY) < 20) continue;
        ctx.fillText(formatPrice(v, ticks.step), x1 + 8, y);
      }
      ctx.globalAlpha = 1;
    }
    if (tagA > 0.01) {
      const color = series.find((s) => s.key === 'anlik')?.color || '#3cefff';
      ctx.globalAlpha = tagA * 0.4;
      ctx.strokeStyle = color;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(x0, Math.round(tagY) + 0.5); ctx.lineTo(x1, Math.round(tagY) + 0.5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = tagA;
      const text = formatPrice(lastVal);
      const tw = ctx.measureText(text).width + 10;
      ctx.fillStyle = color;
      pill(ctx, x1 + 3, tagY - 9, Math.min(tw, w - x1 - 4), 18, 4);
      ctx.fill();
      ctx.fillStyle = THEME.tagText;
      ctx.fillText(text, x1 + 8, tagY + 0.5);
      ctx.globalAlpha = 1;
    }

    // Zaman etiketleri
    const tt = timeTicks(xMin, xMax, Math.max(2, Math.floor((x1 - x0) / 88)));
    ctx.fillStyle = THEME.label;
    ctx.textAlign = 'center';
    let lastRight = -Infinity;
    for (const t of tt.values) {
      const x = px(t);
      const label = formatTick(t, tt.step);
      const half = ctx.measureText(label).width / 2;
      if (x - half < x0 || x + half > x1 || x - half < lastRight + 10) continue;
      ctx.fillText(label, x, bottom + 14);
      lastRight = x + half;
    }

    // İmleç
    if (hover != null && hover < n) {
      const x = Math.round(px(xs[hover])) + 0.5;
      ctx.strokeStyle = THEME.cross;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      for (const s of drawOrder) {
        if (s.kind !== 'line' || alpha.get(s.key) < 0.5) continue;
        const v = valueAt(s.key, hover);
        if (v == null) continue;
        ctx.beginPath();
        ctx.arc(x, py(v), 3.6, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = THEME.ring;
        ctx.stroke();
      }
      const label = formatPoint(xs[hover], data.daily);
      const lw = ctx.measureText(label).width + 14;
      const lx = Math.max(x0, Math.min(x1 - lw, x - lw / 2));
      ctx.fillStyle = THEME.pill;
      pill(ctx, lx, bottom + 4, lw, 19, 5);
      ctx.fill();
      ctx.fillStyle = THEME.pillText;
      ctx.textAlign = 'center';
      ctx.fillText(label, lx + lw / 2, bottom + 14);
    }
  }

  function lastIndex(key) {
    if (!data) return -1;
    const vals = data.values[key] || [];
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i;
    return -1;
  }

  // ---- Boyut ----
  function resize() {
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w === size.w && h === size.h && dpr === size.dpr) return;
    size = { w, h, dpr };
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    draw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  document.fonts?.ready?.then(() => draw());

  // ---- İmleç: fare, dokunma, klavye ----
  function indexAt(clientX) {
    if (!geom || !data) return null;
    const rect = canvas.getBoundingClientRect();
    const t = geom.xMin + ((clientX - rect.left - geom.x0) / (geom.x1 - geom.x0)) * (geom.xMax - geom.xMin);
    const xs = data.xs;
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < t) lo = mid; else hi = mid;
    }
    return Math.abs(xs[lo] - t) <= Math.abs(xs[hi] - t) ? lo : hi;
  }

  function setHover(i) {
    if (i === hover) return;
    hover = i;
    draw();
    onHover?.(i);
  }

  const onDown = (e) => {
    dragging = true;
    if (e.pointerType === 'mouse') setHover(indexAt(e.clientX));
  };
  const onMove = (e) => { if (e.pointerType === 'mouse' || dragging) setHover(indexAt(e.clientX)); };
  const onUp = (e) => {
    if (dragging && e.pointerType !== 'mouse') setHover(indexAt(e.clientX));
    dragging = false;
  };
  const onCancel = (e) => { // parmak dikey kaydırdı: sayfa kayar, imleç kalkar
    if (dragging && e.pointerType !== 'mouse') setHover(null);
    dragging = false;
  };
  const onRelease = () => { dragging = false; };
  const onLeave = (e) => { if (e.pointerType === 'mouse') setHover(null); };
  const onOutside = (e) => { if (hover != null && !host.contains(e.target)) setHover(null); };
  const onKey = (e) => {
    if (!data) return;
    const last = data.xs.length - 1;
    const keys = {
      ArrowLeft: () => (hover == null ? last : Math.max(0, hover - 1)),
      ArrowRight: () => (hover == null ? last : Math.min(last, hover + 1)),
      Home: () => 0,
      End: () => last,
      Escape: () => null,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    setHover(keys[e.key]());
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('keydown', onKey);
  window.addEventListener('pointerup', onRelease);
  document.addEventListener('pointerdown', onOutside);

  return {
    setData,
    setVisible,
    isVisible: (key) => visible.get(key),
    setMessage(text) { message.hidden = !text; message.textContent = text || ''; },
    setLabel(text) { canvas.setAttribute('aria-label', text); },
    redraw: draw,
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointerup', onRelease);
      document.removeEventListener('pointerdown', onOutside);
      host.replaceChildren();
    },
  };
}
