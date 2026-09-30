// DentSimco — Modül 1: Canlı borsa
// Ürün ve kalite seç, zaman aralığı seç: grafik, bugünkü özet ve kalite tablosu burada.

import {
  QUALITIES, START_YEAR, MIN, HOUR, DAY, utcDay, addDays, dayStart,
  loadBasics, loadProduct, summarizeDay,
  fmtPrice, fmtNum, fmtCompact, fmtPct, fmtShare, fmtTime, fmtDate, fmtDateTime, fmtMonth, fmtMonthYear, fmtAgo,
} from './veri.js';
import { createChart } from './grafik.js';

// ---- Ayarlar (renkleri buradan değiştirebilirsin) ----

// Açıklama satırındaki sırayla. z: çizim sırası, büyük olan üstte.
export const SERIES = [
  { key: 'anlik', kind: 'line', z: 9, color: '#3cefff', width: 2.2, glow: 9 },
  { key: 'dusuk', kind: 'line', z: 6, color: '#72ff8f', width: 1.5, dash: [4, 4], step: true, resets: true },
  { key: 'yuksek', kind: 'line', z: 7, color: '#ffbe4a', width: 1.5, dash: [4, 4], step: true, resets: true },
  { key: 'vwap', kind: 'line', z: 8, color: '#ff5ad8', width: 1.8, resets: true },
  { key: 'hacim', kind: 'bar', z: 2, color: '#4a86ff', opacity: 0.95, inner: true },
  { key: 'toplam', kind: 'bar', z: 1, color: '#93a9ff', opacity: 0.26 },
];
const SERIES_BY_KEY = Object.fromEntries(SERIES.map((s) => [s.key, s]));

function seriesLabel(key, { q, daily }) {
  switch (key) {
    case 'anlik': return daily ? 'Kapanış' : 'Anlık en düşük';
    case 'dusuk': return 'Gün en düşük';
    case 'yuksek': return 'Gün en yüksek';
    case 'vwap': return 'VWAP';
    case 'hacim': return `Q${q} lot`;
    default: return 'Toplam lot';
  }
}

export const RANGES = [
  { key: '1S', name: '1 saat', kind: 'intraday', ms: HOUR },
  { key: '6S', name: '6 saat', kind: 'intraday', ms: 6 * HOUR },
  { key: '12S', name: '12 saat', kind: 'intraday', ms: 12 * HOUR },
  { key: '1G', name: '1 gün', kind: 'intraday', ms: DAY },
  { key: '1H', name: '1 hafta', kind: 'intraday', ms: 7 * DAY, bucket: 2 * HOUR },
  { key: '1A', name: '1 ay', kind: 'daily', days: 30 },
  { key: '1Y', name: '1 yıl', kind: 'daily', days: 365 },
  { key: 'T', name: 'Tüm zamanlar', label: 'Tümü', kind: 'daily', days: Infinity },
];
const DEFAULT_RANGE = '1G';
const PREFS_KEY = 'dentsimco.borsa.v1';
const RECENT_MAX = 6;

// ---- Hesaplar ----

// Aralık için okunacak belgeler: gün içi (dün + bugün, haftalıkta 8 gün) ve günlük (yıllar)
export function needs(range, now) {
  const today = utcDay(now);
  const back = range.kind === 'intraday' && range.ms > DAY ? Math.ceil(range.ms / DAY) : 1;
  const days = [];
  for (let k = back; k >= 0; k--) days.push(addDays(today, -k));
  const years = [];
  if (range.kind === 'daily') {
    const first = Number.isFinite(range.days) ? Number(addDays(today, -range.days).slice(0, 4)) : START_YEAR;
    for (let y = Math.max(START_YEAR, first); y <= Number(today.slice(0, 4)); y++) years.push(y);
  }
  return { days, years };
}

const emptyValues = () => ({ anlik: [], dusuk: [], yuksek: [], vwap: [], hacim: [], toplam: [] });
const mapValues = (values, fn) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, fn(v)]));

// Bir noktada seçili kalite. Kalite anahtarı yoksa o an ilan yoktur;
// ürün o noktada izlenebildiyse (başka kalitede satış sayısı varsa) satışı 0'dır.
function metricsAt(qs, q) {
  let tracked = false, total = 0;
  for (const m of Object.values(qs)) if (m?.[2] != null) { tracked = true; total += m[2]; }
  const e = qs[q];
  return {
    p: e?.[0] ?? null,
    s: e ? e[2] : tracked ? 0 : null,
    v: e ? e[3] : tracked ? 0 : null,
    total: tracked ? total : null,
  };
}

// Gün içi: her noktada anlık fiyat, o ana kadarki gün en düşük/yüksek, gün başından VWAP, hacimler
export function intradaySeries(byDay, q) {
  const xs = [];
  const values = emptyValues();
  for (const day of [...byDay.keys()].sort()) {
    let lo = null, hi = null, sold = 0, value = 0;
    for (const { t, qs } of byDay.get(day)) {
      const m = metricsAt(qs, q);
      if (m.p != null) {
        lo = lo == null ? m.p : Math.min(lo, m.p);
        hi = hi == null ? m.p : Math.max(hi, m.p);
      }
      if (m.s != null) { sold += m.s; value += m.v || 0; }
      xs.push(t);
      values.anlik.push(m.p);
      values.dusuk.push(lo);
      values.yuksek.push(hi);
      values.vwap.push(sold > 0 ? value / sold : null);
      values.hacim.push(m.s);
      values.toplam.push(m.total);
    }
  }
  return { xs, values };
}

function sliceFrom({ xs, values }, fromT) {
  const i = xs.findIndex((t) => t >= fromT);
  if (i === 0) return { xs, values };
  if (i < 0) return { xs: [], values: emptyValues() };
  return { xs: xs.slice(i), values: mapValues(values, (a) => a.slice(i)) };
}

// Noktaları kovalara toplar: hacimler toplanır, diğerleri kovanın son değerini alır
const SUMMED = new Set(['hacim', 'toplam']);
export function bucketSeries({ xs, values }, size) {
  const out = { xs: [], values: mapValues(values, () => []) };
  for (let i = 0; i < xs.length;) {
    const b = Math.floor(xs[i] / size);
    let j = i;
    while (j < xs.length && Math.floor(xs[j] / size) === b) j++;
    out.xs.push(xs[j - 1]);
    for (const [key, arr] of Object.entries(values)) {
      let acc = null;
      for (let k = i; k < j; k++) {
        if (arr[k] == null) continue;
        acc = SUMMED.has(key) ? (acc ?? 0) + arr[k] : arr[k];
      }
      out.values[key].push(acc);
    }
    i = j;
  }
  return out;
}

// Günlük: satır = [açılış, yüksek, düşük, kapanış, ortArz, satış, tutar]
export function dailySeries(rows, q) {
  const xs = [];
  const values = emptyValues();
  for (const day of [...rows.keys()].sort()) {
    const qs = rows.get(day);
    let tracked = false, total = 0;
    for (const m of Object.values(qs)) if (m?.[5] != null) { tracked = true; total += m[5]; }
    const e = qs[q];
    xs.push(dayStart(day) + 12 * HOUR);
    values.anlik.push(e?.[3] ?? null);
    values.dusuk.push(e?.[2] ?? null);
    values.yuksek.push(e?.[1] ?? null);
    values.vwap.push(e?.[5] > 0 ? e[6] / e[5] : null);
    values.hacim.push(e ? e[5] : tracked ? 0 : null);
    values.toplam.push(tracked ? total : null);
  }
  return { xs, values };
}

function dayStartsOf(xs) {
  const set = new Set();
  for (let i = 1; i < xs.length; i++) if (Math.floor(xs[i] / DAY) !== Math.floor(xs[i - 1] / DAY)) set.add(i);
  return set;
}

export function buildSeries(product, range, q, now) {
  if (range.kind === 'intraday') {
    let s = intradaySeries(product.byDay, q);
    const end = s.xs.length ? s.xs[s.xs.length - 1] : now;
    s = sliceFrom(s, end - range.ms);
    if (range.bucket) s = bucketSeries(s, range.bucket);
    const dayStarts = dayStartsOf(s.xs);
    // Pencere önceki günün sadece son bir iki noktasını yakaladıysa, o günün "o ana kadarki"
    // değerleri havada kalan kısa parçalar olur ve ölçeği bozar; gösterilmez.
    const firstNewDay = dayStarts.size ? Math.min(...dayStarts) : 0;
    if (firstNewDay > 0 && firstNewDay < 3) {
      for (const key of ['dusuk', 'yuksek', 'vwap']) for (let i = 0; i < firstNewDay; i++) s.values[key][i] = null;
    }
    return { ...s, daily: false, dayStarts };
  }
  const today = utcDay(now);
  const rows = new Map(product.daily);
  // Gece özeti henüz yazılmamış günler (dün, bugün) canlı noktalardan hesaplanır
  for (const [day, points] of product.byDay) {
    if (points.length && (day === today || !rows.has(day))) rows.set(day, summarizeDay(points));
  }
  const first = Number.isFinite(range.days) ? addDays(today, -(range.days - 1)) : '0000-00-00';
  for (const day of [...rows.keys()]) if (day < first || day > today) rows.delete(day);
  return { ...dailySeries(rows, q), daily: true, dayStarts: new Set() };
}

function snapshotOf(basics, product, id) {
  const live = basics?.live?.items?.[id];
  if (live) return { t: live[0], qs: live[1] || {} };
  let last = null;
  for (const points of product?.byDay.values() || []) for (const p of points) if (!last || p.t > last.t) last = p;
  return last && { t: last.t, qs: last.qs };
}

function change24h(product, q, snap) {
  const now = snap?.qs?.[q]?.[0];
  if (now == null) return null;
  const target = snap.t - DAY;
  let best = null;
  for (const points of product.byDay.values()) {
    for (const pt of points) {
      const old = pt.qs[q]?.[0];
      if (old == null) continue;
      const d = Math.abs(pt.t - target);
      if (d <= 50 * MIN && (!best || d < best.d)) best = { d, p: old };
    }
  }
  return best ? now / best.p - 1 : null;
}

function freshness(t, now) {
  if (!t) return { level: 'stale', text: 'Henüz ölçüm yok' };
  const age = now - t;
  const when = `${age < DAY ? fmtTime(t) : fmtDateTime(t)} (${fmtAgo(t, now)})`;
  if (age <= 40 * MIN) return { level: 'live', text: `Güncel, son ölçüm ${when}` };
  if (age <= 2 * HOUR) return { level: 'late', text: `Gecikmeli, son ölçüm ${when}` };
  return { level: 'stale', text: `Eski veri, son ölçüm ${when}` };
}

// ---- Grafik biçimleri ----

const axisPrice = (v, step) => fmtPrice(v, step ? Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))) : undefined);

function formatTick(t, step) {
  const d = new Date(t);
  if (step < DAY) return d.getHours() === 0 && d.getMinutes() === 0 ? fmtDate(t) : fmtTime(t);
  if (step < 28 * DAY) return fmtDate(t);
  return d.getMonth() === 0 ? fmtMonthYear(t) : fmtMonth(t);
}

const formatPoint = (t, daily) => (daily ? fmtDate(t) : fmtDateTime(t));

// ---- Arayüz ----

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => s.toLocaleLowerCase('en').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const ICON_CHEVRON = '<svg class="chev" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_RELOAD = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M16.2 10a6.2 6.2 0 1 1-1.9-4.5M16.4 3.4v3.4H13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const FIGS = [
  ['vwap', 'VWAP bugün'],
  ['hacim', 'Lot'],
  ['toplam', 'İşlem Hacmi ($)'],
  ['arz', 'Derinlik'],
];

const TEMPLATE = `
<section class="borsa">
  <div class="bar">
    <div class="pick" data-el="pick">
      <button type="button" class="product" data-el="productBtn" aria-haspopup="listbox" aria-expanded="false">
        <span class="product-name" data-el="productName">Yükleniyor</span>
        <span class="product-id" data-el="productId"></span>
        ${ICON_CHEVRON}
      </button>
      <div class="picker" data-el="picker" hidden>
        <input type="search" data-el="search" placeholder="Ürün adı ya da numarası" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="Ürün ara">
        <div class="picker-list" data-el="list" role="listbox" aria-label="Ürünler"></div>
      </div>
    </div>
    <div class="quals" data-el="quals" role="radiogroup" aria-label="Kalite">
      ${QUALITIES.map((q) => `<button type="button" role="radio" data-q="${q}" aria-checked="false" tabindex="-1">Q${q}</button>`).join('')}
    </div>
  </div>

  <div class="alert" data-el="alert" role="alert" hidden>
    <span data-el="alertText"></span>
    <button type="button" class="btn" data-el="retry">Tekrar dene</button>
  </div>

  <div class="hero">
    <div class="hero-top">
      <h1 class="hero-title"><span data-el="heroName">DentSimco borsa</span> <span class="qtag" data-el="heroQ"></span></h1>
      <div class="fresh" data-el="fresh" data-level="wait">
        <span class="dot" aria-hidden="true"></span>
        <span data-el="freshText">Veriler yükleniyor</span>
        <button type="button" class="icon-btn" data-el="reload" aria-label="Verileri yenile" title="Yenile">${ICON_RELOAD}</button>
      </div>
    </div>
    <p class="hero-price"><span class="price" data-el="price">—</span><span class="chg" data-el="chg"></span></p>
    <div class="dayrange">
      <span class="dr-cap">Gün en düşük</span><span></span><span class="dr-cap dr-end">Gün en yüksek</span>
      <span class="dr-lo" data-el="lo">—</span>
      <span class="track"><span class="mark" data-el="mark" hidden></span></span>
      <span class="dr-hi" data-el="hi">—</span>
    </div>
    <dl class="figs">
      ${FIGS.map(([key, label]) => `<div><dt>${label}</dt><dd data-fig="${key}">—</dd></div>`).join('')}
    </dl>
  </div>

  <div class="plot" data-el="plot" aria-busy="true">
    <div class="ranges" data-el="ranges" role="radiogroup" aria-label="Zaman aralığı">
      ${RANGES.map((r) => `<button type="button" role="radio" data-range="${r.key}" aria-checked="false" aria-label="${r.name}" tabindex="-1">${r.label || r.key}</button>`).join('')}
    </div>
    <div class="legend" data-el="legend">
      ${SERIES.map((s) => `<button type="button" class="lg" data-key="${s.key}" aria-pressed="true">
        <span class="lg-head"><i class="sw ${s.kind === 'bar' ? 'bar' : s.dash ? 'dash' : ''}" style="--c:${s.color}" aria-hidden="true"></i><span class="lg-label"></span></span>
        <span class="lg-val">—</span></button>`).join('')}
    </div>
    <p class="when" data-el="when"></p>
    <div class="chart" data-el="chart"></div>
    <p class="foot" data-el="foot"></p>
  </div>

  <div class="quality">
    <h2 class="quality-title">Kaliteler, bugün</h2>
    <div class="table-wrap">
      <table class="qt">
        <thead><tr><th scope="col">Kalite</th><th scope="col">Anlık</th><th scope="col">Derinlik</th><th scope="col">Lot</th><th scope="col">VWAP</th><th scope="col">Pay</th></tr></thead>
        <tbody data-el="rows"></tbody>
        <tfoot data-el="total"></tfoot>
      </table>
    </div>
  </div>
</section>`;

function readPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { p = {}; }
  const obj = (x) => (x && typeof x === 'object' ? x : {});
  return {
    range: RANGES.some((x) => x.key === p.range) ? p.range : DEFAULT_RANGE,
    visible: obj(p.visible),
    picks: obj(p.picks),
    recent: obj(p.recent),
  };
}

export function mountBorsa(root, { realm = 0 } = {}) {
  root.innerHTML = TEMPLATE;
  const el = {};
  root.querySelectorAll('[data-el]').forEach((node) => { el[node.dataset.el] = node; });
  const figs = Object.fromEntries([...root.querySelectorAll('[data-fig]')].map((n) => [n.dataset.fig, n]));

  const prefs = readPrefs();
  const save = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* gizli sekme */ } };
  let r = realm;
  let basics = null; // {products, ids, live}
  let product = null; // {byDay, daily}
  let shown = null; // grafikte çizilen seri
  let snap = null; // seçili ürünün son ölçümü {t, qs}
  let todaySum = {}; // bugünün kalite özetleri
  let hoverIndex = null;
  let token = 0;
  let lastAuto = 0;
  let destroyed = false;

  const pick = () => prefs.picks[r] || { id: null, q: 0 };
  const range = () => RANGES.find((x) => x.key === prefs.range) || RANGES[3];
  const nameOf = (id) => basics?.products?.[id]?.name || `Ürün ${id}`;

  const chart = createChart(el.chart, {
    series: SERIES.map((s) => ({ ...s, visible: prefs.visible[s.key] !== false })),
    formatPrice: axisPrice,
    formatVolume: fmtCompact,
    formatTick,
    formatPoint,
    onHover: (i) => { hoverIndex = i; renderLegendValues(); renderWhen(); },
  });

  // ---- Veri akışı ----

  async function refresh({ transition = 'sweep', fresh = false } = {}) {
    const my = ++token;
    const now = Date.now();
    const need = needs(range(), now);
    const today = utcDay(now);
    const options = fresh ? { refresh: (p) => p.startsWith('live/') || p.includes(`_${today}_`) } : undefined;
    setBusy(true);
    try {
      const saved = prefs.picks[r];
      const [b, early] = await Promise.all([
        loadBasics(r, options),
        saved?.id != null ? loadProduct(r, saved.id, need, options).catch(() => null) : null,
      ]);
      if (my !== token || destroyed) return;
      basics = b;
      if (!b.ids.length) {
        showAlert('Bu realm için ürün listesi yok. GitHub > Actions > DentSimco Sabit Veri iş akışını çalıştır.');
        el.productName.textContent = 'Ürün listesi yok';
        chart.setMessage('Ürün listesi gelince grafik burada görünecek.');
        setFresh({ level: 'stale', text: 'Henüz veri yok' });
        return;
      }
      let chosen = saved;
      if (!chosen || !b.ids.includes(Number(chosen.id))) {
        chosen = prefs.picks[r] = { id: b.ids.includes(1) ? 1 : b.ids[0], q: chosen?.q ?? 0 };
      }
      const p = chosen === saved && early ? early : await loadProduct(r, chosen.id, need, options);
      if (my !== token || destroyed) return;
      product = p;
      save();
      el.alert.hidden = true;
      renderAll(transition);
      if (!snap) {
        const n = Object.keys(b.live?.items || {}).length;
        showAlert(!b.live
          ? 'Canlı veri belgesi (live/r' + r + ') okunamadı ya da içi boş.'
          : `Canlı veri belgesinde bu ürün yok (belgede ${n} ürün var, ürün no ${chosen.id}).`);
      }
    } catch (e) {
      if (my !== token || destroyed) return;
      showAlert(e?.message || String(e));
      if (!product) {
        chart.setMessage('Veri alınamadı.');
        setFresh({ level: 'stale', text: 'Bağlantı yok' });
      }
    } finally {
      if (my === token && !destroyed) setBusy(false);
    }
  }

  function setBusy(busy) {
    el.plot.setAttribute('aria-busy', String(busy));
    el.reload.classList.toggle('spin', busy);
  }

  function showAlert(text) {
    el.alertText.textContent = text;
    el.alert.hidden = false;
  }

  // ---- Çizim ----

  function renderAll(transition) {
    const now = Date.now();
    const { id, q } = pick();
    snap = snapshotOf(basics, product, id);
    todaySum = summarizeDay(product.byDay.get(utcDay(now)) || []);
    shown = buildSeries(product, range(), q, now);
    chart.setData(shown.xs.length ? shown : null, transition);
    chart.setMessage(shown.xs.length ? null : emptyMessage());
    chart.setLabel(chartLabel());
    renderProduct();
    renderQualities();
    renderRanges();
    renderHero(now);
    renderLegend();
    renderWhen();
    renderFoot(now);
    renderTable();
    document.title = `${nameOf(id)} Q${q} | DentSimco`;
  }

  function emptyMessage() {
    return range().kind === 'daily'
      ? 'Bu aralık için günlük özet henüz yok. Bot her gece bir önceki günü ekler.'
      : 'Bu aralıkta ölçüm yok. Bot yaklaşık 23 dakikada bir ölçer.';
  }

  function chartLabel() {
    const { id, q } = pick();
    const last = shown?.xs.length ? shown.values.anlik[shown.xs.length - 1] : null;
    const label = seriesLabel('anlik', { q, daily: shown?.daily }).toLocaleLowerCase('tr');
    return `${nameOf(id)} Q${q}, ${range().name} grafiği. Son ${label}: ${fmtPrice(last)}. Ok tuşlarıyla noktalar arasında gezinebilirsin.`;
  }

  function renderProduct() {
    const { id } = pick();
    el.productName.textContent = id == null ? 'Ürün seç' : nameOf(id);
    el.productId.textContent = id == null ? '' : `#${id}`;
  }

  function renderQualities() {
    const { q } = pick();
    for (const btn of el.quals.children) {
      const bq = Number(btn.dataset.q);
      const has = snap?.qs?.[bq]?.[0] != null || todaySum[bq]?.[5] > 0;
      btn.setAttribute('aria-checked', String(bq === q));
      btn.tabIndex = bq === q ? 0 : -1;
      btn.classList.toggle('empty', !has);
    }
  }

  function renderRanges() {
    for (const btn of el.ranges.children) {
      const on = btn.dataset.range === prefs.range;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
  }

  function setFresh(f) {
    el.fresh.dataset.level = f.level;
    el.freshText.textContent = f.text;
  }

  function renderHero(now) {
    const { id, q } = pick();
    el.heroName.textContent = nameOf(id);
    el.heroQ.textContent = `Q${q}`;
    const cur = snap?.qs?.[q];
    const p = cur?.[0] ?? null;
    el.price.textContent = p != null ? fmtPrice(p) : snap ? 'İlan yok' : '—';
    el.price.classList.toggle('none', p == null);
    const ch = change24h(product, q, snap);
    el.chg.textContent = ch == null ? '' : `${fmtPct(ch)} 24 saatte`;
    el.chg.className = `chg${ch > 0 ? ' up' : ch < 0 ? ' down' : ''}`;

    const d = todaySum[q];
    const lo = d?.[2] ?? null;
    const hi = d?.[1] ?? null;
    el.lo.textContent = fmtPrice(lo);
    el.hi.textContent = fmtPrice(hi);
    const pos = lo != null && hi != null && p != null ? (hi > lo ? (p - lo) / (hi - lo) : 0.5) : null;
    el.mark.hidden = pos == null;
    if (pos != null) el.mark.style.left = `${Math.max(0, Math.min(1, pos)) * 100}%`;

    const sold = d?.[5] ?? null;
    figs.vwap.textContent = fmtPrice(sold > 0 ? d[6] / sold : null);
    figs.hacim.textContent = fmtNum(sold);
    figs.toplam.textContent = fmtNum(d?.[6] ?? null); // seçili kalitenin bugünkü satış tutarı ($)
    figs.arz.textContent = snap ? fmtNum(cur?.[1] ?? 0) : '—';
    setFresh(freshness(snap?.t, now));
  }

  function renderLegend() {
    const ctx = { q: pick().q, daily: shown?.daily };
    for (const btn of el.legend.children) {
      btn.querySelector('.lg-label').textContent = seriesLabel(btn.dataset.key, ctx);
      btn.setAttribute('aria-pressed', String(chart.isVisible(btn.dataset.key)));
    }
    renderLegendValues();
  }

  function renderLegendValues() {
    const i = hoverIndex ?? (shown?.xs.length ? shown.xs.length - 1 : null);
    for (const btn of el.legend.children) {
      const key = btn.dataset.key;
      const v = i == null ? null : shown.values[key]?.[i];
      btn.querySelector('.lg-val').textContent = SERIES_BY_KEY[key].kind === 'bar' ? fmtNum(v) : fmtPrice(v);
    }
  }

  function renderWhen() {
    if (!shown?.xs.length) { el.when.textContent = ''; return; }
    const i = hoverIndex ?? shown.xs.length - 1;
    const t = shown.xs[i];
    let label = formatPoint(t, shown.daily);
    if (shown.daily && utcDay(t) === utcDay(Date.now())) label += ', bugün (sürüyor)';
    el.when.textContent = hoverIndex == null ? `Son nokta: ${label}` : `Seçili nokta: ${label}`;
  }

  function renderFoot(now) {
    const rg = range();
    const bars = rg.kind === 'daily' ? 'Her sütun bir günün satışı.'
      : rg.bucket ? 'Her sütun 2 saatlik satış.' : 'Her sütun iki ölçüm arası (yaklaşık 15 dk) satış.';
    const few = rg.kind === 'daily' && shown.xs.length <= 3 ? ' Günlük geçmiş, bot her gece bir gün ekledikçe uzar.' : '';
    el.foot.textContent = `${bars} Lot, işlem hacmi ve VWAP, ilanlardaki azalmadan tahmin edilir. Gün sınırı UTC gece yarısı (senin saatinle ${fmtTime(dayStart(utcDay(now)))}).${few}`;
  }

  function renderTable() {
    const { q: sel } = pick();
    const liveQs = snap?.qs || {};
    let totS = 0, totV = 0, totA = 0, tracked = false;
    const rows = QUALITIES.map((q) => {
      const p = liveQs[q]?.[0] ?? null;
      const a = liveQs[q]?.[1] ?? null;
      const s = todaySum[q]?.[5] ?? null;
      const v = todaySum[q]?.[6] ?? null;
      if (s != null) { tracked = true; totS += s; totV += v || 0; }
      if (a != null) totA += a;
      return { q, p, a, s, v };
    });
    const maxS = Math.max(0, ...rows.map((x) => x.s || 0));
    el.rows.innerHTML = rows.map(({ q, p, a, s, v }) => {
      const share = tracked && totS > 0 && s != null ? s / totS : null;
      const bar = share == null || !(maxS > 0) ? '' // çubuk en büyük paya göre ölçeklenir
        : `<span class="sbar" aria-hidden="true"><i style="width:${((s / maxS) * 100).toFixed(1)}%"></i></span>`;
      const none = p == null && !(a > 0) && !(s > 0);
      return `<tr data-q="${q}" class="${q === sel ? 'sel' : ''}${none ? ' none' : ''}">`
        + `<th scope="row"><button type="button" data-q="${q}" aria-pressed="${q === sel}">Q${q}</button></th>`
        + `<td>${fmtPrice(p)}</td><td>${fmtNum(a)}</td><td>${fmtNum(s)}</td><td>${fmtPrice(s > 0 ? v / s : null)}</td>`
        + `<td class="share">${bar}${fmtShare(share)}</td></tr>`;
    }).join('');
    el.total.innerHTML = `<tr><th scope="row">Tümü</th><td></td><td>${snap ? fmtNum(totA) : '—'}</td>`
      + `<td>${tracked ? fmtNum(totS) : '—'}</td><td>${fmtPrice(totS > 0 ? totV / totS : null)}</td>`
      + `<td>${tracked && totS > 0 ? fmtShare(1) : '—'}</td></tr>`;
  }

  // ---- Ürün seçici ----

  function openPicker() {
    if (!basics?.ids.length) return;
    el.picker.hidden = false;
    el.productBtn.setAttribute('aria-expanded', 'true');
    el.search.value = '';
    renderPicker();
    if (!window.matchMedia?.('(pointer: coarse)').matches) el.search.focus();
    document.addEventListener('pointerdown', outsidePicker, true);
  }

  function closePicker(focusBack) {
    if (el.picker.hidden) return;
    el.picker.hidden = true;
    el.productBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outsidePicker, true);
    if (focusBack) el.productBtn.focus();
  }

  function outsidePicker(e) {
    if (!el.pick.contains(e.target)) closePicker(false);
  }

  function renderPicker() {
    const raw = el.search.value.trim();
    const query = norm(raw);
    const current = pick().id;
    const all = basics.ids.map((id) => ({ id, name: nameOf(id) }));
    const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
    const group = (title, items) => (title ? `<p class="picker-group" role="presentation">${title}</p>` : '')
      + items.map((x) => `<button type="button" role="option" data-id="${x.id}" aria-selected="${x.id === current}">`
        + `<span>${esc(x.name)}</span><span class="pid">#${x.id}</span></button>`).join('');
    let html;
    if (!query) {
      const recent = (prefs.recent[r] || []).filter((id) => basics.ids.includes(id)).map((id) => ({ id, name: nameOf(id) }));
      html = (recent.length ? group('Son bakılanlar', recent) : '') + group('Tüm ürünler', all.sort(byName));
    } else {
      const hits = all.filter((x) => norm(x.name).includes(query) || String(x.id) === query).sort(byName);
      html = hits.length ? group(null, hits) : `<p class="picker-empty">"${esc(raw)}" ile eşleşen ürün yok.</p>`;
    }
    el.list.innerHTML = html;
  }

  function selectProduct(id) {
    closePicker(true);
    const cur = pick();
    if (cur.id === id) return;
    prefs.picks[r] = { id, q: cur.q ?? 0 };
    prefs.recent[r] = [id, ...(prefs.recent[r] || []).filter((x) => x !== id)].slice(0, RECENT_MAX);
    save();
    hoverIndex = null;
    renderProduct();
    refresh({ transition: 'sweep' });
  }

  function selectQuality(q) {
    const cur = pick();
    if (cur.q === q || cur.id == null) return;
    prefs.picks[r] = { ...cur, q };
    save();
    if (product) renderAll('morph');
  }

  function selectRange(key) {
    if (prefs.range === key) return;
    prefs.range = key;
    save();
    hoverIndex = null;
    renderRanges();
    refresh({ transition: 'sweep' });
  }

  function toggleSeries(key) {
    const on = !chart.isVisible(key);
    chart.setVisible(key, on);
    prefs.visible[key] = on;
    save();
    renderLegend();
  }

  // ---- Olaylar ----

  function radioKeys(container, choose) {
    container.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const items = [...container.querySelectorAll('[role=radio]')];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
        : (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      items[j].focus();
      choose(items[j]);
    });
  }

  el.productBtn.addEventListener('click', () => (el.picker.hidden ? openPicker() : closePicker(true)));
  el.search.addEventListener('input', renderPicker);
  el.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.list.querySelector('[data-id]')?.click(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); el.list.querySelector('[data-id]')?.focus(); }
  });
  el.picker.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePicker(true); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...el.list.querySelectorAll('[data-id]')];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) el.search.focus();
    else items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  });
  el.list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-id]');
    if (btn) selectProduct(Number(btn.dataset.id));
  });
  el.quals.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-q]');
    if (btn) selectQuality(Number(btn.dataset.q));
  });
  radioKeys(el.quals, (btn) => selectQuality(Number(btn.dataset.q)));
  el.ranges.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (btn) selectRange(btn.dataset.range);
  });
  radioKeys(el.ranges, (btn) => selectRange(btn.dataset.range));
  el.legend.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (btn) toggleSeries(btn.dataset.key);
  });
  el.rows.addEventListener('click', (e) => {
    const row = e.target.closest('[data-q]');
    if (row) selectQuality(Number(row.dataset.q));
  });
  el.reload.addEventListener('click', () => refresh({ transition: 'update', fresh: true }));
  el.retry.addEventListener('click', () => refresh({ transition: product ? 'update' : 'sweep', fresh: true }));

  // Bot 15 dakikada bir yazar. Veri 25 dakikadan eskiyse 3 dakikada bir yeniden bakılır.
  function tick() {
    if (destroyed || document.visibilityState !== 'visible' || !basics) return;
    const now = Date.now();
    if (snap) setFresh(freshness(snap.t, now));
    if (now - (basics.live?.t || 0) < 25 * MIN || now - lastAuto < 3 * MIN) return;
    lastAuto = now;
    refresh({ transition: 'update', fresh: true });
  }
  const clock = setInterval(tick, MIN);
  const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
  document.addEventListener('visibilitychange', onVisible);

  renderRanges();
  renderLegend();
  refresh({ transition: 'sweep' });

  return {
    setRealm(next) {
      if (next === r) return;
      r = next;
      closePicker(false);
      basics = null;
      product = null;
      snap = null;
      hoverIndex = null;
      el.productName.textContent = 'Yükleniyor';
      el.productId.textContent = '';
      refresh({ transition: 'sweep' });
    },
    destroy() {
      destroyed = true;
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('pointerdown', outsidePicker, true);
      chart.destroy();
      root.replaceChildren();
    },
  };
}
