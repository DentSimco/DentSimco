// DentSimco — Perakende (arayüz)
// Hesapların hepsi hesap-perakende.js'te; burada yalnız ekranlar, veri yükleme ve tarayıcıda kayıt var.
// Üç sütun: 1) binalar ve seviyeler, 2) her binanın en kârlı 10 ürünü, 3) ürün tabloları (kalite, maliyet, fiyat, PPHPL).
// Satış bonusu, yönetim gideri ve ekip Yönetim sekmesindeki şirket kaydından, doygunluk botun yazdığı meta/retail_r{realm} belgesinden gelir.
// Tarayıcı kaydı: dentsimco.perakende.r{realm}

import { readDocs, PATHS, dataField, loadProduct, summarizeDay, utcDay, addDays, START_YEAR } from './veri.js';
import * as H from './hesap.js';
import * as Y from './yonetici.js';
import { CSS, parseNum } from './uretim.js';
import * as R from './hesap-perakende.js';
import { SALES } from './perakende-veri.js';

const STORE_KEY = (r) => `dentsimco.perakende.r${r}`;
const PHASES = [['0', 'Durgunluk'], ['1', 'Normal'], ['2', 'Büyüme']];
const HISTORY_DAYS = 30;

// Bina adları veride yok; oyunun Türkçe arayüzüne göre. Emin olmadığımız harflerde "Mağaza X" yazar.
const RETAIL_NAMES = { G: 'Bakkal', A: 'Benzin istasyonu', C: 'Giyim mağazası', 2: 'Araba galerisi', H: 'Elektronik mağazası', d: 'Yapı market', r: 'Restoran' };
const buildingName = (letter) => RETAIL_NAMES[letter] || `Mağaza ${letter}`;

// Talep (d = 2 − doygunluk, 0–2) → isim ve renk. Aşırı yüksekten çok düşüğe: yeşil → sarı → kırmızı
const DEMAND = [
  { min: 1.5, label: 'Aşırı yüksek', k: 'd5' },
  { min: 1, label: 'Yüksek', k: 'd4' },
  { min: 0.5, label: 'Orta', k: 'd3' },
  { min: 1e-9, label: 'Düşük', k: 'd2' },
  { min: -1, label: 'Çok düşük', k: 'd1' },
];
const demandOf = (d) => DEMAND.find((x) => d >= x.min);

// ---- biçimlendirme ----
const NF = [0, 1, 2, 3].map((d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fin = (x) => x != null && Number.isFinite(x);
const num = (x, d = 0) => (fin(x) ? NF[d].format(x) : '—');
const money = (x, d = 0) => {
  if (!fin(x)) return '—';
  const s = `$${NF[d].format(Math.abs(x))}`;
  return Math.round(x * 10 ** d) < 0 ? `−${s}` : s;
};
const price = (x) => (!fin(x) ? '—' : money(x, Math.abs(x) < 1000 ? 2 : 0));
const cls = (x) => (x > 0.004 ? 'c-up' : x < -0.004 ? 'c-down' : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const posNum = (x) => { const n = Number(x); return x != null && x !== '' && Number.isFinite(n) && n > 0 ? n : null; };
const toInt = (x) => Math.max(0, Math.floor(Number(x) || 0));
const seg = (act, options, value, label) => `<div class="ur-seg" role="group" aria-label="${esc(label)}">${options.map(([v, t]) =>
  `<button type="button" data-act="${act}" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(t)}</button>`).join('')}</div>`;
const chip = (text, kind = '') => `<span class="ur-chip ${kind}">${esc(text)}</span>`;
const star = (top) => `<span class="pk-star${top ? ' top' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="${top ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><polygon points="12 2.5 15 9 22 9.6 16.7 14.3 18.3 21.3 12 17.6 5.7 21.3 7.3 14.3 2 9.6 9 9"/></svg></span>`;
const trash = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const plus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

const EXTRA_CSS = `
.pk-cols { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 980px) { .pk-cols { grid-template-columns: minmax(250px, 310px) minmax(260px, 340px) minmax(0, 1fr); align-items: start; } }
.pk-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.pk-letters { display: flex; flex-wrap: wrap; gap: 8px; }
.pk-letter { min-height: 44px; padding: 0 14px; border-radius: 12px; background: var(--raise); color: var(--text); border: 1px solid var(--line-2); font: 600 15px var(--font); }
.pk-letter[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.pk-lvl { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
.pk-lvl .grow { flex: 1 1 auto; min-width: 0; }
.pk-lvl input[type="text"] { width: 84px; text-align: center; }
.pk-rank { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 54px; padding: 6px 8px; border: 0; border-top: 1px solid var(--line); background: transparent; color: var(--text); text-align: left; font: inherit; }
.pk-rank[aria-pressed="true"] { background: #0d2a44; }
.pk-rank .name { flex: 1 1 auto; min-width: 0; font-weight: 600; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-rank .vals { text-align: right; font-variant-numeric: tabular-nums; }
.pk-rank .vals b { display: block; font-size: 16px; }
.pk-rank .vals small { color: var(--muted); font-size: 12px; }
.pk-star { display: inline-flex; width: 22px; justify-content: center; color: var(--muted); flex: none; }
.pk-star.top { color: var(--price); }
.pk-star svg { width: 20px; height: 20px; }
.pk-badge { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 13px; font-size: 13px; font-weight: 600; white-space: nowrap; border: 1px solid; }
.pk-badge.d5 { background: #062a1c; color: #34d399; border-color: #0f5a3c; }
.pk-badge.d4 { background: #1a2b0b; color: #a3e635; border-color: #35561a; }
.pk-badge.d3 { background: #2b2406; color: #facc15; border-color: #5c4b0c; }
.pk-badge.d2 { background: #331a09; color: #fb923c; border-color: #6b3410; }
.pk-badge.d1 { background: #2d0f1a; color: #fb7185; border-color: #5e2032; }
.pk-wrap { overflow-x: auto; margin: 0 -4px; padding: 0 4px; }
.pk-t { width: 100%; border-collapse: collapse; min-width: 330px; }
.pk-t th { color: var(--muted); font-size: 12px; font-weight: 600; text-align: right; padding: 0 4px 6px; border-bottom: 1px solid var(--line-2); white-space: nowrap; }
.pk-t td { padding: 6px 3px; border-bottom: 1px solid var(--line); text-align: right; vertical-align: middle; }
.pk-t th:first-child, .pk-t td:first-child { text-align: left; width: 38px; }
.pk-t input[type="text"], .pk-t select { height: 40px; font-size: 15px; padding: 0 6px; text-align: right; }
.pk-t select { padding-right: 22px; background-position: calc(100% - 12px) 17px, calc(100% - 6px) 17px; text-align: left; }
.pk-t .pph { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; padding-left: 6px; }
.pk-use { width: 34px; height: 34px; border-radius: 17px; border: 2px solid var(--line-2); background: transparent; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.pk-use[aria-pressed="true"] { border-color: var(--accent); }
.pk-use[aria-pressed="true"]::after { content: ""; width: 16px; height: 16px; border-radius: 8px; background: var(--accent); }
.pk-del { min-width: 34px; height: 34px; padding: 0; border: 0; background: transparent; color: var(--muted); }
.pk-del svg { width: 18px; height: 18px; }
.pk-hist { border-top: 1px solid var(--line); margin-top: 10px; padding-top: 8px; }
.pk-hist summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 600; color: var(--accent); }
.pk-svg { width: 100%; height: auto; display: block; }
.pk-svg text { fill: var(--muted); font-size: 11px; font-family: var(--font); }
`;

// ---------------------------------------------------------------------------------------------------------------
// Kayıt
// ---------------------------------------------------------------------------------------------------------------
// { economyPhase: null (otomatik) | 0 | 1 | 2,
//   buildings: [{ id, letter, level, products: [{ id, product, levels: null (eşit paylaş) | sayı, use: satırId,
//                 rows: [{ id, quality, cost: null (modeldeki), price: null (en kârlı) }] }] }] }
const defaultSetup = () => ({ economyPhase: null, buildings: [] });
const newRow = (quality = 0) => ({ id: uid('r'), quality: R.clampQuality(quality), cost: null, price: null });
const newProduct = (product) => { const row = newRow(); return { id: uid('p'), product, levels: null, use: row.id, rows: [row] }; };

function cleanProduct(raw, letter, seen) {
  const id = Number(raw?.product);
  if (!SALES[letter].includes(id) || seen.has(id)) return null;
  seen.add(id);
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).filter((x) => x && typeof x === 'object')
    .map((x) => ({ id: x.id || uid('r'), quality: R.clampQuality(x.quality), cost: posNum(x.cost), price: posNum(x.price) }));
  if (!rows.length) rows.push(newRow());
  return {
    id: raw.id || uid('p'), product: id, levels: raw.levels == null || raw.levels === '' ? null : toInt(raw.levels),
    use: rows.some((x) => x.id === raw.use) ? raw.use : rows[0].id, rows,
  };
}
function sanitize(raw) {
  const s = defaultSetup();
  if (!raw || typeof raw !== 'object') return s;
  s.economyPhase = raw.economyPhase != null && [0, 1, 2].includes(Number(raw.economyPhase)) ? Number(raw.economyPhase) : null;
  const letters = new Set();
  for (const b of Array.isArray(raw.buildings) ? raw.buildings : []) {
    if (!b || !SALES[b.letter] || letters.has(b.letter)) continue;
    letters.add(b.letter);
    const seen = new Set();
    s.buildings.push({
      id: b.id || uid('b'), letter: b.letter, level: toInt(b.level),
      products: (Array.isArray(b.products) ? b.products : []).map((p) => cleanProduct(p || {}, b.letter, seen)).filter(Boolean),
    });
  }
  return s;
}
function loadSetup(r) {
  try { return sanitize(JSON.parse(localStorage.getItem(STORE_KEY(r)) || 'null')); } catch { return defaultSetup(); }
}
function saveSetup(r, setup) {
  try { localStorage.setItem(STORE_KEY(r), JSON.stringify(setup)); return true; } catch { return false; }
}
function loadUretim(r) {
  try { return JSON.parse(localStorage.getItem(`dentsimco.uretim.r${r}`) || 'null') || {}; } catch { return {}; }
}

// Bir binanın ürünlerine düşen seviye: elle yazılanlar kadar, kalanı eşit paylaşılır
function levelsOf(b) {
  const out = {};
  const explicit = b.products.filter((p) => p.levels != null);
  const auto = b.products.filter((p) => p.levels == null);
  for (const p of explicit) out[p.id] = p.levels;
  const left = Math.max(0, b.level - explicit.reduce((t, p) => t + p.levels, 0));
  auto.forEach((p, i) => { out[p.id] = Math.floor(left / auto.length) + (i < left % auto.length ? 1 : 0); });
  return out;
}
const usedRow = (p) => p.rows.find((x) => x.id === p.use) || p.rows[0];

// ---------------------------------------------------------------------------------------------------------------
// Veri
// ---------------------------------------------------------------------------------------------------------------
async function loadData(r) {
  const P = { products: PATHS.meta(`products_r${r}`), buildings: PATHS.meta('buildings'), core: PATHS.meta('core'), retail: PATHS.meta(`retail_r${r}`) };
  const docs = await readDocs(Object.values(P));
  const get = (k) => dataField(docs.get(P[k]));
  const products = get('products');
  if (!products || !Object.keys(products).length) throw new Error('Ürün verisi okunamadı.');
  const core = get('core') || {};
  const saturation = {};
  for (const [id, p] of Object.entries(products)) if (p && fin(Number(p.marketSaturation)) && p.marketSaturation !== null) saturation[id] = Number(p.marketSaturation);
  Object.assign(saturation, R.parseSaturation(get('retail')));
  return {
    norm: H.normalizeData({ products, buildings: get('buildings') || {}, core, realm: r }),
    names: Object.fromEntries(Object.entries(products).map(([id, p]) => [id, p?.name || `#${id}`])),
    saturation,
    qualityWeight: fin(Number(core.RETAIL_MODELING_QUALITY_WEIGHT)) && core.RETAIL_MODELING_QUALITY_WEIGHT != null ? Number(core.RETAIL_MODELING_QUALITY_WEIGHT) : undefined,
    hasRetailInfo: !!get('retail'),
  };
}

// Son 30 günün borsa ortalama fiyatı (VWAP = satış tutarı ÷ satış adedi), kalite başına
async function loadHistory(r, id) {
  const today = utcDay(Date.now());
  const first = addDays(today, -(HISTORY_DAYS - 1));
  const years = [...new Set([first.slice(0, 4), today.slice(0, 4)].map(Number))].filter((y) => y >= START_YEAR);
  const { byDay, daily } = await loadProduct(r, id, { days: [addDays(today, -1), today], years });
  const rows = new Map(daily);
  for (const [day, points] of byDay) if (points.length && (day === today || !rows.has(day))) rows.set(day, summarizeDay(points));
  return { rows, today };
}
function vwapSeries(h, quality) {
  const out = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const day = addDays(h.today, -i);
    const e = h.rows.get(day)?.[quality];
    out.push({ day, v: e && e[5] > 0 && e[6] != null ? e[6] / e[5] : null });
  }
  return out;
}
function chartSvg(series) {
  const W = 320, Ht = 120, L = 50, Rt = 8, T = 10, B = 20;
  const vals = series.filter((x) => x.v != null);
  if (vals.length < 2) return '<p class="ur-note">Bu kalite için yeterli geçmiş fiyat verisi yok.</p>';
  let lo = Math.min(...vals.map((x) => x.v));
  let hi = Math.max(...vals.map((x) => x.v));
  if (hi - lo < 1e-9) { lo *= 0.98; hi *= 1.02; }
  const X = (i) => L + (i * (W - L - Rt)) / (series.length - 1);
  const Yv = (v) => T + (1 - (v - lo) / (hi - lo)) * (Ht - T - B);
  let d = '';
  let pen = false;
  series.forEach((x, i) => {
    if (x.v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Yv(x.v).toFixed(1)}`;
    pen = true;
  });
  const date = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
  const avg = vals.reduce((t, x) => t + x.v, 0) / vals.length;
  return `<svg class="pk-svg" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Son 30 günün borsa ortalama fiyatı, ortalama ${price(avg)}">
    <line x1="${L}" y1="${T}" x2="${W - Rt}" y2="${T}" stroke="var(--line)"/><line x1="${L}" y1="${Ht - B}" x2="${W - Rt}" y2="${Ht - B}" stroke="var(--line)"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="${L - 6}" y="${T + 4}" text-anchor="end">${esc(price(hi))}</text><text x="${L - 6}" y="${Ht - B + 4}" text-anchor="end">${esc(price(lo))}</text>
    <text x="${L}" y="${Ht - 4}">${date(series[0].day)}</text><text x="${W - Rt}" y="${Ht - 4}" text-anchor="end">${date(series[series.length - 1].day)}</text></svg>
    <p class="ur-note">Borsa ortalama fiyatı (VWAP). ${num(vals.length)} günün ortalaması ${price(avg)}.</p>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Modül
// ---------------------------------------------------------------------------------------------------------------
export function mountPerakende(root, { realm = 0 } = {}) {
  let r = realm;
  let company = Y.loadCompanyRecord(r).company;
  let setup = loadSetup(r);
  let data = null;
  let loadError = null;
  let loadToken = 0;
  let destroyed = false;
  let toastTimer = null;
  const history = new Map(); // ürün → { state, h }
  const openCharts = new Set();

  const style = document.createElement('style');
  style.dataset.module = 'perakende';
  style.textContent = CSS + EXTRA_CSS;
  document.head.append(style);
  root.innerHTML = '<div class="ur"></div><div data-toast></div>';
  const view = root.querySelector('.ur');
  const toastHost = root.querySelector('[data-toast]');

  // Kutuya yazıp hemen bir düğmeye dokununca "change" dokunmanın ortasında gelir; o anda çizim yapılırsa dokunma kaybolur.
  let pointerActive = false;
  let pendingRender = false;
  let settleTimer = null;
  const flush = () => { clearTimeout(settleTimer); pointerActive = false; if (pendingRender) render(); };
  const onPointerDown = () => { pointerActive = true; clearTimeout(settleTimer); };
  const onPointerUp = () => { clearTimeout(settleTimer); settleTimer = setTimeout(flush, 450); };
  const onAnyClick = () => setTimeout(flush, 0);
  const softRender = () => { if (pointerActive) pendingRender = true; else render(); };

  function toast(text) {
    toastHost.innerHTML = `<div class="ur-toast" role="status">${esc(text)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastHost.innerHTML = ''; }, 3200);
  }
  function commit(next) {
    setup = sanitize(next);
    if (!saveSetup(r, setup)) toast('Tarayıcı kaydı açık değil; değişiklikler sayfa kapanınca kaybolur.');
    softRender();
  }
  const clone = () => JSON.parse(JSON.stringify(setup));

  async function load() {
    const my = ++loadToken;
    data = null;
    loadError = null;
    history.clear();
    render();
    try {
      const d = await loadData(r);
      if (destroyed || my !== loadToken) return;
      data = d;
    } catch (e) {
      if (destroyed || my !== loadToken) return;
      loadError = e?.message || String(e);
    }
    render();
    for (const key of openCharts) ensureHistory(Number(key.split(':')[1]));
  }
  async function ensureHistory(id) {
    if (!Number.isFinite(id) || history.has(id)) return;
    history.set(id, { state: 'loading' });
    const my = loadToken;
    try {
      const h = await loadHistory(r, id);
      if (destroyed || my !== loadToken) return;
      history.set(id, { state: 'ok', h });
    } catch {
      if (destroyed || my !== loadToken) return;
      history.set(id, { state: 'err' });
    }
    softRender();
  }

  // ---- hesap ----
  function compute() {
    const phase = Number.isInteger(data.norm.economy?.currentPhase) ? data.norm.economy.currentPhase : 0;
    const econ = setup.economyPhase ?? phase;
    const team = H.teamEffects(company.executives, { bankLevel: company.finance?.bankLevel });
    const bonusPct = R.retailBonusPct({ otherSpeedPct: company.retail?.otherSpeedPct, teamSalesSpeedPct: team.salesSpeedPct });
    // Yönetim gideri toplam bina seviyesine bağlı: Üretim kurulumundaki binalar + perakende seviyeleri
    const uretim = loadUretim(r);
    const retailLevels = setup.buildings.reduce((t, b) => t + b.level, 0);
    let adminNet = 0;
    try {
      adminNet = H.adminInfo({ ...uretim, executives: company.executives, finance: company.finance, admin: { mode: 'executives' },
        otherLevels: toInt(uretim.otherLevels) + retailLevels }, data.norm).net;
    } catch { adminNet = 0; }
    const ctx = { saturation: data.saturation, weather: R.noWeather, bonusPct, adminNet, qualityWeight: data.qualityWeight,
      buildings: data.norm.buildings, averageSalary: data.norm.averageSalary };
    const engineSetup = {
      economyPhase: econ,
      buildings: setup.buildings.map((b) => {
        const lv = levelsOf(b);
        return { id: b.id, letter: b.letter, level: b.level, lines: b.products.map((p) => {
          const row = usedRow(p);
          return { id: p.id, product: p.product, quality: row.quality, levels: lv[p.id], cost: row.cost, price: row.price };
        }) };
      }),
    };
    return { econ, ctx, bonusPct, ev: R.evaluateRetail(engineSetup, ctx), levels: Object.fromEntries(setup.buildings.map((b) => [b.id, levelsOf(b)])) };
  }
  function rowCalc(b, p, row, c) {
    const model = R.getModel(c.econ, p.product, row.quality);
    const wage = R.storeWage({ modelW: model?.W, salaryModifier: c.ctx.buildings?.[b.letter]?.salaryModifier, averageSalary: c.ctx.averageSalary, adminNet: c.ctx.adminNet });
    return R.calcProduct({ economy: c.econ, productId: p.product, quality: row.quality, saturation: c.ctx.saturation[p.product], cAct: row.cost, price: row.price,
      bonusPct: c.ctx.bonusPct, weather: 1, qualityWeight: c.ctx.qualityWeight, wage });
  }

  // ---- ekran ----
  function render() {
    if (destroyed) return;
    pendingRender = false;
    let body;
    if (loadError) {
      body = `<div class="ur-msg err" role="alert">Veriler okunamadı: ${esc(loadError)}</div><button type="button" class="ur-btn" data-act="retry">Tekrar dene</button>`;
    } else if (!data) {
      body = '<p class="ur-sub" aria-busy="true">Ürün ve bina verileri yükleniyor…</p>';
    } else {
      try { body = viewAll(compute()); } catch (e) {
        console.error(e);
        body = `<div class="ur-msg err" role="alert">Bu ekran gösterilemedi: ${esc(e?.message || e)}. Sayfayı yenileyin; sürerse bize bildirin.</div>`;
      }
    }
    const scroll = window.scrollY;
    view.innerHTML = body;
    window.scrollTo(0, scroll);
  }

  function viewAll(c) {
    const t = c.ev.totals;
    const head = `<section class="ur-card" aria-labelledby="h-pk"><h2 id="h-pk">Perakende</h2>
      <p class="ur-sub">Mağazalarınızın hangi ürünle ne kadar kazandıracağını hesaplar. PPHPL, bir bina seviyesinin saatlik kârıdır (maaş düşülmüş).</p>
      ${seg('phase', PHASES, c.econ, 'Ekonomi fazı')}
      <div class="ur-chips">${chip(`Satış bonusu %${num(c.bonusPct, c.bonusPct % 1 ? 1 : 0)}`, c.bonusPct > 0 ? '' : 'muted')}${chip(`Yönetim gideri %${num(c.ctx.adminNet * 100, 1)}`, 'muted')}
        ${data.hasRetailInfo ? '' : chip('Doygunluk botta yok', 'down')}</div>
      <p class="ur-note">Satış bonusu ve ekip <a href="#yonetim/satis" style="color:var(--accent)">Yönetim › Satış</a> sekmesinden gelir.</p></section>`;
    const summary = setup.buildings.length ? `<section class="ur-card" aria-label="Toplam"><div class="ur-metrics">
      <div class="ur-stat"><span>Günlük kâr</span><span class="${cls(t.profitDay)}">${money(t.profitDay)}</span></div>
      <div class="ur-stat"><span>Günlük satış</span><span>${num(t.unitsDay)} adet</span></div>
      <div class="ur-stat"><span>Kullanılan seviye</span><span>${num(t.levels)}</span></div></div></section>` : '';
    return `${head}${summary}<div class="pk-cols">${colBuildings(c)}${colRanks(c)}${colTables(c)}</div>`;
  }

  // 1. sütun
  function colBuildings(c) {
    const letters = R.retailLetters().filter((l) => R.buildingProducts(l, c.econ).length);
    const picks = letters.map((l) => `<button type="button" class="pk-letter" data-act="bToggle" data-v="${esc(l)}" aria-pressed="${setup.buildings.some((b) => b.letter === l)}">${esc(buildingName(l))}</button>`).join('');
    const rows = setup.buildings.map((b, i) => `<div class="pk-lvl"><div class="grow"><div style="font-weight:600">${esc(buildingName(b.letter))}</div>
        <span class="ur-note">Günlük kâr <span class="${cls(c.ev.buildings[i]?.profitDay)}">${money(c.ev.buildings[i]?.profitDay)}</span></span></div>
        <label class="ur-note" for="lvl-${esc(b.id)}">Seviye</label>
        <input id="lvl-${esc(b.id)}" type="text" inputmode="numeric" autocomplete="off" data-f="lvl" data-b="${esc(b.id)}" value="${b.level || ''}" aria-label="${esc(buildingName(b.letter))} toplam seviye"></div>`).join('');
    return `<div class="pk-col"><section class="ur-card" aria-labelledby="h-b"><h2 id="h-b">Binalar ve seviyeler</h2>
      <p class="ur-sub">Aynı türden birden çok binanız varsa seviyelerini toplayıp yazın.</p>
      <div class="pk-letters">${picks}</div>${rows}</section></div>`;
  }

  // 2. sütun
  function colRanks(c) {
    if (!setup.buildings.length) return '<div class="pk-col"><section class="ur-card"><h2>En kârlı 10 ürün</h2><p class="ur-note">Soldan bir bina seçin; en kârlı ürünleri burada görünür.</p></section></div>';
    const blocks = setup.buildings.map((b) => {
      const list = R.rankBuilding({ letter: b.letter, economy: c.econ, ctx: c.ctx, quality: 0, costFor: () => null, top: 10 });
      const items = list.map((x) => {
        const on = b.products.some((p) => p.product === x.productId);
        return `<button type="button" class="pk-rank" data-act="pToggle" data-b="${esc(b.id)}" data-v="${x.productId}" aria-pressed="${on}">
          ${star(x.best)}<span class="name">${esc(data.names[x.productId] || `#${x.productId}`)}</span>
          <span class="vals"><b class="${cls(x.pphplMax)}">${money(x.pphplMax, 2)}</b><small>${money(x.pphplMax * b.level * 24)}/gün</small></span></button>`;
      }).join('');
      return `<section class="ur-card" aria-label="${esc(buildingName(b.letter))} en kârlı ürünler"><div class="ur-head"><h2>${esc(buildingName(b.letter))}</h2>${chip('PPHPL', 'muted')}</div>
        ${list.length ? `<p class="ur-note">Q0, modeldeki maliyet ve en kârlı fiyatla. Ürüne dokununca tablosu açılır.</p>${items}` : '<p class="ur-note">Bu bina için doygunluk verisi yok.</p>'}</section>`;
    }).join('');
    return `<div class="pk-col">${blocks}</div>`;
  }

  // 3. sütun
  function colTables(c) {
    const cards = [];
    setup.buildings.forEach((b, bi) => b.products.forEach((p, pi) => cards.push(productCard(b, p, c, c.ev.buildings[bi]?.lines[pi]))));
    if (!cards.length) return '<div class="pk-col"><section class="ur-card"><h2>Ürün tabloları</h2><p class="ur-note">Ortadaki listeden ürün seçince her ürünün tablosu burada açılır.</p></section></div>';
    return `<div class="pk-col">${cards.join('')}</div>`;
  }

  function productCard(b, p, c, line) {
    const sat = c.ctx.saturation[p.product];
    const d = R.demand(sat);
    const dem = fin(sat) ? demandOf(d) : null;
    const used = usedRow(p);
    const key = `${b.id}:${p.product}`;
    const multi = b.products.length > 1;
    const levelField = multi ? `<label class="pk-lvl" style="border:0;padding:0 0 8px"><span class="grow ur-note">Bu ürüne ayrılan seviye</span>
      <input type="text" inputmode="numeric" autocomplete="off" data-f="plv" data-b="${esc(b.id)}" data-p="${esc(p.id)}" value="${p.levels ?? ''}" placeholder="${num(c.levels[b.id]?.[p.id] ?? 0)}" aria-label="Ayrılan seviye"></label>` : '';
    const rows = p.rows.map((row) => {
      const x = rowCalc(b, p, row, c);
      const model = R.getModel(c.econ, p.product, row.quality);
      const opts = Array.from({ length: R.MAX_QUALITY + 1 }, (_, q) => `<option value="${q}" ${q === row.quality ? 'selected' : ''}>Q${q}</option>`).join('');
      const ph = (v) => (fin(v) ? NF[v < 10 ? 3 : 2].format(v) : '');
      const attrs = `data-b="${esc(b.id)}" data-p="${esc(p.id)}" data-r="${esc(row.id)}"`;
      return `<tr><td><button type="button" class="pk-use" data-act="rUse" ${attrs} aria-pressed="${row.id === used.id}" aria-label="Q${row.quality} satışta kullanılıyor"></button></td>
        <td><select data-f="q" ${attrs} aria-label="Kalite">${opts}</select></td>
        <td><input type="text" inputmode="decimal" autocomplete="off" data-f="cost" ${attrs} value="${row.cost ?? ''}" placeholder="${ph(model?.c)}" aria-label="Maliyet"></td>
        <td><input type="text" inputmode="decimal" autocomplete="off" data-f="price" ${attrs} value="${row.price ?? ''}" placeholder="${x.ok ? ph(x.rMax) : ''}" aria-label="Fiyat"></td>
        <td class="pph ${x.ok ? cls(x.pphpl) : ''}">${x.ok ? money(x.pphpl, 2) : '—'}</td>
        <td>${p.rows.length > 1 ? `<button type="button" class="pk-del" data-act="rDel" ${attrs} aria-label="Q${row.quality} satırını sil">${trash}</button>` : ''}</td></tr>`;
    }).join('');
    const err = !fin(sat) ? '<div class="ur-msg err" role="alert">Bu ürünün doygunluk verisi yok; hesaplanamadı.</div>'
      : (p.rows.map((row) => rowCalc(b, p, row, c)).find((x) => !x.ok)?.reason ? `<div class="ur-msg err" role="alert">${esc(p.rows.map((row) => rowCalc(b, p, row, c)).find((x) => !x.ok).reason)}</div>` : '');
    const isOpen = openCharts.has(key);
    const h = history.get(p.product);
    const chart = !isOpen ? '' : !h || h.state === 'loading' ? '<p class="ur-note" aria-busy="true">Geçmiş fiyatlar yükleniyor…</p>'
      : h.state === 'err' ? '<p class="ur-note">Geçmiş fiyatlar okunamadı.</p>' : chartSvg(vwapSeries(h.h, used.quality));
    return `<article class="ur-card" aria-label="${esc(data.names[p.product] || '')} tablosu">
      <div class="ur-row" style="gap:8px;flex-wrap:wrap"><div class="grow" style="min-width:0"><span style="font:600 19px var(--font-c)">${esc(data.names[p.product] || `#${p.product}`)}</span>
        <div class="ur-note">${esc(buildingName(b.letter))}${line?.ok ? ` · günlük kâr <span class="${cls(line.profitDay)}">${money(line.profitDay)}</span>` : ''}</div></div>
        <button type="button" class="ur-btn danger" data-act="pRemove" data-b="${esc(b.id)}" data-p="${esc(p.id)}" aria-label="Ürünü kaldır">${trash}</button></div>
      <div class="ur-chips">${dem ? `<span class="pk-badge ${dem.k}">${dem.label}</span>` : ''}${fin(sat) ? chip(`Doygunluk ${num(sat, 2)}`, 'muted') : ''}</div>
      ${err}${levelField}
      <div class="pk-wrap"><table class="pk-t"><thead><tr><th scope="col">Satış</th><th scope="col">Kalite</th><th scope="col">Maliyet</th><th scope="col">Fiyat</th><th scope="col">PPHPL</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="ur-row"><button type="button" class="ur-btn tint grow" data-act="rAdd" data-b="${esc(b.id)}" data-p="${esc(p.id)}">${plus}Kalite ekle</button></div>
      <p class="ur-note">Boş maliyet modeldeki maliyeti, boş fiyat en kârlı fiyatı kullanır (kutuda silik görünür). Seçili satır toplama girer.</p>
      <details class="pk-hist" data-chart="${esc(key)}" ${isOpen ? 'open' : ''}><summary>Fiyat geçmişi, 30 gün</summary>${chart}</details></article>`;
  }

  // ---- olaylar ----
  function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || !root.contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'retry') return load();
    if (!data) return;
    const next = clone();
    const b = next.buildings.find((x) => x.id === btn.dataset.b);
    const p = b?.products.find((x) => x.id === btn.dataset.p);
    if (act === 'phase') { next.economyPhase = Number(btn.dataset.v); return commit(next); }
    if (act === 'bToggle') {
      const i = next.buildings.findIndex((x) => x.letter === btn.dataset.v);
      if (i >= 0) next.buildings.splice(i, 1); else next.buildings.push({ id: uid('b'), letter: btn.dataset.v, level: 1, products: [] });
      return commit(next);
    }
    if (!b) return;
    if (act === 'pToggle') {
      const id = Number(btn.dataset.v);
      const i = b.products.findIndex((x) => x.product === id);
      if (i >= 0) b.products.splice(i, 1); else b.products.push(newProduct(id));
      return commit(next);
    }
    if (!p) return;
    if (act === 'pRemove') { b.products = b.products.filter((x) => x.id !== p.id); return commit(next); }
    if (act === 'rUse') { p.use = btn.dataset.r; return commit(next); }
    if (act === 'rAdd') {
      const taken = new Set(p.rows.map((x) => x.quality));
      let q = 0;
      while (taken.has(q) && q < R.MAX_QUALITY) q++;
      const row = newRow(q);
      p.rows.push(row);
      return commit(next);
    }
    if (act === 'rDel') {
      if (p.rows.length > 1) p.rows = p.rows.filter((x) => x.id !== btn.dataset.r);
      return commit(next);
    }
  }
  function onChange(ev) {
    const t = ev.target;
    const f = t?.dataset?.f;
    if (!f || !data) return;
    const next = clone();
    const b = next.buildings.find((x) => x.id === t.dataset.b);
    const p = b?.products.find((x) => x.id === t.dataset.p);
    const row = p?.rows.find((x) => x.id === t.dataset.r);
    const n = parseNum(t.value);
    if (f === 'lvl' && b) b.level = toInt(n);
    else if (f === 'plv' && p) p.levels = n == null ? null : toInt(n);
    else if (f === 'cost' && row) row.cost = posNum(n);
    else if (f === 'price' && row) row.price = posNum(n);
    else if (f === 'q' && row) row.quality = Number(t.value);
    else return;
    commit(next);
  }
  function onToggle(ev) {
    const el = ev.target;
    if (!el?.matches?.('details[data-chart]')) return;
    const key = el.dataset.chart;
    if (el.open) { openCharts.add(key); ensureHistory(Number(key.split(':')[1])); softRender(); } else openCharts.delete(key);
  }
  function onKey(ev) {
    if (ev.key === 'Enter' && ev.target.matches?.('.ur input[data-f]')) ev.target.blur();
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  document.addEventListener('click', onAnyClick, true);
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('toggle', onToggle, true);
  load();

  return {
    setRealm(next) {
      if (next === r) return;
      r = next;
      company = Y.loadCompanyRecord(r).company;
      setup = loadSetup(r);
      openCharts.clear();
      load();
    },
    destroy() {
      destroyed = true;
      clearTimeout(toastTimer);
      clearTimeout(settleTimer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      document.removeEventListener('click', onAnyClick, true);
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('toggle', onToggle, true);
      style.remove();
      root.replaceChildren();
    },
  };
}
