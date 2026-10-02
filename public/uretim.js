// DentSimco — Üretim hesaplayıcı (arayüz)
// Hesapların hepsi hesap.js'te; burada yalnız ekranlar, veri yükleme ve tarayıcıda kayıt var.
// Kurulum, Binalar, Alım-Satım ve Özet (ön muhasebe). Fiyatlar botun 15 dakikada bir yazdığı live/r{realm} belgesinden.
// Yöneticiler, nakit, bono ve banka seviyesi şirket kaydında (Yönetim sekmesi); buradaki hesaplar onu okur.

import { readDocs, PATHS, dataField } from './veri.js';
import * as H from './hesap.js';
import * as Y from './yonetici.js';
import { guideCard } from './rehber.js';

const STORE_KEY = (r) => `dentsimco.uretim.r${r}`;
const TAB_KEY = 'dentsimco.uretim.tab';
const PARK_KEY = 'dentsimco.uretim.parked';
const PERIOD_KEY = 'dentsimco.uretim.period';
const PERIODS = [['hour', 'Saatlik', 1 / 24], ['day', 'Günlük', 1], ['week', 'Haftalık', 7], ['month', 'Aylık', 30]];
const TABS = [['kurulum', 'Kurulum'], ['binalar', 'Binalar'], ['alimsatim', 'Alım-Satım'], ['ozet', 'Özet']];

// Bina adları veride yok; oyunun Türkçe arayüzüne göre
const BUILDING_NAMES = {
  E: 'Enerji santrali', W: 'Su deposu', P: 'Tarla', F: 'Çiftlik', O: 'Petrol kuyusu', R: 'Rafineri', S: 'Nakliye deposu',
  M: 'Maden', Q: 'Taş ocağı', Y: 'Fabrika', L: 'Elektronik fabrikası', T: 'Moda fabrikası', D: 'İtici fabrikası',
  1: 'Araba fabrikası', 6: 'İçecek fabrikası', 7: 'Havacılık fabrikası', 8: 'Havacılık elektroniği', 9: 'Dikey entegrasyon tesisi',
  0: 'Hangar', k: 'Gıda işleme tesisi', e: 'Mezbaha', i: 'Değirmen', j: 'Fırın', m: 'Catering', o: 'Beton santrali',
  x: 'İnşaat fabrikası', g: 'Genel müteahhit', v: 'Orman fidanlığı',
  p: 'Bitki araştırma merkezi', h: 'Fizik laboratuvarı', b: 'Islah laboratuvarı', c: 'Kimya laboratuvarı', s: 'Yazılım Ar-Ge',
  a: 'Otomotiv Ar-Ge', f: 'Moda ve tasarım', l: 'Fırlatma rampası', q: 'Mutfak', y: 'Akademi',
};
const REC = [['park', 'Park'], ['temple', 'Tapınak'], ['lake', 'Göl']];

// ---- biçimlendirme ----
const NF = [0, 1, 2, 3, 4].map((d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fin = (x) => x != null && Number.isFinite(x);
const num = (x, d = 0) => (fin(x) ? NF[d].format(x) : '—');
const smart = (x) => (!fin(x) ? '—' : Math.abs(x) >= 100 ? NF[0].format(x) : Math.abs(x) >= 1 ? NF[2].format(x) : NF[3].format(x));
const perHour = (x) => (!fin(x) ? '—' : Math.abs(x) > 0 && Math.abs(x) < 0.01 ? NF[3].format(x) : NF[2].format(x)); // oyun gibi iki ondalık
const money = (x, d = 0, sign = false) => {
  if (!fin(x)) return '—';
  const s = `$${NF[d].format(Math.abs(x))}`;
  return x < 0 ? `−${s}` : sign && x > 0 ? `+${s}` : s;
};
const pctText = (fraction, d = 2) => (fin(fraction) ? `${fraction < 0 ? '−' : ''}%${NF[d].format(Math.abs(fraction * 100))}` : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const whenFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Türkçe ya da İngilizce yazılmış sayıyı okur: "1.921.272", "0,3582", "72.65", "%62"
export function parseNum(input) {
  let t = String(input ?? '').trim().replace(/[\s$%₺]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function defaultSetup() {
  return {
    v: 1, buildings: [], recreation: { park: 0, temple: 0, lake: 0 }, extraBonusPct: 0, economyPhase: 0,
    academyLevel: 0, events: {},
    substitution: true, buyPolicy: 'cheapest',
    prices: {}, contractPrices: {}, keep: {}, buyQuality: {}, transportPrice: null,
  };
}
function sanitizeSetup(raw) {
  const base = defaultSetup();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  s.recreation = { ...base.recreation, ...(raw.recreation || {}) };
  // Yönetici, nakit, bono, banka ve yönetim gideri girişi artık şirket kaydında; eski kayıtlardaki alanlar atılır
  for (const k of ['admin', 'finance', 'executives', 'otherLevels', 'otherWagesDay']) delete s[k];
  s.academyLevel = Math.max(0, Math.floor(Number(raw.academyLevel) || 0));
  s.events = { ...(raw.events || {}) };
  for (const k of ['prices', 'contractPrices', 'keep', 'buyQuality']) s[k] = raw[k] && typeof raw[k] === 'object' ? { ...raw[k] } : {};
  s.transportPrice = Number.isFinite(Number(raw.transportPrice)) && raw.transportPrice !== null && raw.transportPrice !== '' ? Number(raw.transportPrice) : null;
  if (!['cheapest', 'exact'].includes(s.buyPolicy)) s.buyPolicy = 'cheapest';
  s.buildings = (Array.isArray(raw.buildings) ? raw.buildings : []).filter((b) => b && typeof b === 'object')
    .map((b) => ({ id: b.id || uid('b'), type: b.type, product: b.product != null ? Number(b.product) : null, level: Math.max(1, Math.floor(Number(b.level) || 1)),
      quality: H.clampQuality(b.quality), robots: !!b.robots, efficiency: Number.isFinite(Number(b.efficiency)) ? Number(b.efficiency) : 100 }));
  if (![0, 1, 2].includes(Number(s.economyPhase))) s.economyPhase = 0;
  s.economyPhase = Number(s.economyPhase);
  s.extraBonusPct = Math.min(99, Math.max(0, Number(raw.extraBonusPct) || 0));
  return s;
}
function loadSetup(r) {
  try { return sanitizeSetup(JSON.parse(localStorage.getItem(STORE_KEY(r)) || 'null')); } catch { return defaultSetup(); }
}
function saveSetup(r, setup) {
  try { localStorage.setItem(STORE_KEY(r), JSON.stringify(setup)); return true; } catch { return false; }
}

async function loadLive(r, options) {
  const docs = await readDocs([PATHS.live(r)], options);
  return dataField(docs.get(PATHS.live(r))) || null;
}
async function loadData(r) {
  const P = { products: PATHS.meta(`products_r${r}`), buildings: PATHS.meta('buildings'), core: PATHS.meta('core'), modifiers: PATHS.meta(`modifiers_r${r}`) };
  const docs = await readDocs(Object.values(P));
  const get = (k) => dataField(docs.get(P[k]));
  const products = get('products');
  if (!products || !Object.keys(products).length) throw new Error('Ürün verisi (meta/products) okunamadı.');
  return H.normalizeData({ products, buildings: get('buildings') || {}, core: get('core') || {}, modifiers: get('modifiers') || {}, realm: r });
}

// ---------------------------------------------------------------------------------------------------------------
// Stiller (sitenin renk değişkenleriyle)
// ---------------------------------------------------------------------------------------------------------------
export const CSS = `
.ur { max-width: 760px; margin: 0 auto; padding: 8px 14px 40px; display: flex; flex-direction: column; gap: 12px; }
.ur-tabs { display: flex; border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; background: var(--bg); margin: 0 -14px; padding: 0 14px; }
.ur-tabs a { flex: 1 1 0; display: flex; align-items: center; justify-content: center; min-height: 48px; color: var(--muted); font: 600 16px var(--font-c); text-decoration: none; border-bottom: 3px solid transparent; white-space: nowrap; }
.ur-tabs a[aria-current="page"] { color: var(--accent); border-bottom-color: var(--accent); }
.ur h1 { font: 600 22px/1.2 var(--font-c); margin: 0; }
.ur h2 { font: 600 20px/1.2 var(--font-c); margin: 0; }
.ur-sub { color: var(--muted); font-size: 14px; line-height: 1.4; margin: 0; }
.ur-note { color: var(--muted); font-size: 13px; line-height: 1.4; margin: 0; }
.ur-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
.ur-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.ur-box { background: var(--raise); border: 1px solid var(--line-2); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 2px; }
.ur-row { display: flex; align-items: center; gap: 8px; }
.ur-row > .grow { flex: 1 1 auto; min-width: 0; }
.ur-hr { height: 1px; background: var(--line); margin: 2px 0; }
.ur-kv { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; }
.ur-kv > span:first-child { color: var(--muted); font-size: 15px; }
.ur-kv > span:last-child { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
.ur-kv.strong > span:last-child { font-size: 17px; }
.ur-kv.strong > span:first-child { color: var(--text); font-weight: 600; }
.c-price { color: var(--price); } .c-up { color: var(--up); } .c-down { color: var(--down); } .c-muted { color: var(--muted); }
.ur-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; min-width: 44px; padding: 0 14px; border-radius: 12px;
  background: var(--raise); color: var(--text); border: 1px solid var(--line-2); font: 600 16px var(--font); white-space: nowrap; }
.ur-btn.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); min-height: 50px; }
.ur-btn.tint { background: #0d2a44; color: var(--accent); border-color: #1f4a73; }
.ur-btn.danger { background: transparent; color: var(--down); }
.ur-btn.grow { flex: 1 1 0; white-space: normal; text-align: center; line-height: 1.2; padding: 6px 12px; }
.ur-btn:disabled { opacity: 0.45; cursor: default; }
.ur-btn svg { width: 20px; height: 20px; flex: none; }
.ur-seg { display: flex; gap: 6px; }
.ur-seg button { flex: 1 1 0; min-height: 44px; min-width: 44px; padding: 0 4px; border-radius: 10px; background: var(--raise); color: var(--muted); border: 1px solid var(--line-2); font: 600 15px var(--font); white-space: nowrap; }
.ur-seg button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.ur-field { display: flex; flex-direction: column; gap: 6px; }
.ur-field > span { color: var(--muted); font-size: 14px; font-weight: 600; }
.ur-input { display: flex; align-items: center; gap: 8px; }
.ur-input input, .ur select, .ur textarea { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box; height: 48px; padding: 0 12px; border-radius: 10px;
  background: var(--bg); color: var(--text); border: 1px solid var(--line-2); font: 600 17px var(--font); }
.ur select { appearance: none; background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 20px) 21px, calc(100% - 14px) 21px; background-size: 6px 6px; background-repeat: no-repeat; padding-right: 36px; }
.ur textarea { height: 160px; padding: 10px 12px; font: 500 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
.ur-input > i { font-style: normal; color: var(--muted); font-weight: 600; min-width: 14px; }
.ur input:focus-visible, .ur select:focus-visible, .ur textarea:focus-visible, .ur button:focus-visible, .ur a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ur-chip { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 13px; font-size: 13px; font-weight: 600; white-space: nowrap;
  background: #0d2a44; color: var(--accent); border: 1px solid #1f4a73; }
.ur-chip.muted { background: var(--raise); color: var(--muted); border-color: var(--line-2); }
.ur-chip.up { background: #062a1c; color: var(--up); border-color: #0f5a3c; }
.ur-chip.down { background: #2d0f1a; color: var(--down); border-color: #5e2032; }
.ur-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ur-switch { width: 52px; height: 32px; border-radius: 16px; background: var(--raise); border: 1px solid var(--line-2); display: flex; align-items: center; padding: 0 3px; flex: none; }
.ur-switch::before { content: ""; width: 22px; height: 22px; border-radius: 11px; background: var(--muted); }
.ur-switch[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); justify-content: flex-end; }
.ur-switch[aria-pressed="true"]::before { background: var(--bg); }
.ur-line { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.ur-line:last-child { border-bottom: 0; }
.ur-line > .grow { flex: 1 1 auto; min-width: 0; }
.ur-line .title { font-size: 16px; font-weight: 600; }
.ur-grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.ur-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ur-stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ur-stat > span:first-child { font-size: 13px; color: var(--muted); font-weight: 600; }
.ur-stat > span:last-child { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ur-stats { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1fr) minmax(0, 1.5fr); gap: 8px; }
.ur-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ur-stats > div { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
.ur-bgrid { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 740px) { .ur-bgrid { grid-template-columns: 1fr 1fr; } }
.ur-badge { width: 44px; height: 44px; border-radius: 12px; background: #0d2a44; border: 1px solid #1f4a73; color: var(--accent); display: flex; align-items: center;
  justify-content: center; font: 600 18px var(--font-c); flex: none; }
.ur-level { text-align: right; } .ur-level b { display: block; font: 600 24px/1 var(--font-c); } .ur-level small { color: var(--muted); font-size: 13px; font-weight: 600; }
.ur-empty { text-align: center; padding: 22px 12px; }
.ur-q { display: flex; flex-wrap: wrap; gap: 6px; }
.ur-q button { width: 44px; height: 44px; border-radius: 10px; background: var(--raise); color: var(--muted); border: 1px solid var(--line-2); font: 600 15px var(--font); }
.ur-q button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.ur-pos { display: flex; flex-wrap: wrap; gap: 6px; }
.ur-pos button { min-height: 44px; padding: 0 12px; border-radius: 10px; background: var(--raise); color: var(--muted); border: 1px solid var(--line-2); font: 600 15px var(--font); }
.ur-pos button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.ur-stepper { display: flex; gap: 8px; }
.ur-stepper button { width: 56px; height: 50px; border-radius: 12px; background: var(--raise); border: 1px solid var(--line-2); color: var(--text); display: flex; align-items: center; justify-content: center; flex: none; }
.ur input[type="text"] { min-width: 0; width: 100%; box-sizing: border-box; height: 48px; padding: 0 12px; border-radius: 10px; background: var(--bg);
  color: var(--text); border: 1px solid var(--line-2); font: 600 17px var(--font); }
.ur .ur-stepper input { flex: 1 1 auto; text-align: center; font-size: 22px; height: 50px; }
.ur-stepper svg { width: 22px; height: 22px; }
.ur-msg { border-radius: 12px; padding: 12px; font-size: 14px; line-height: 1.4; background: var(--raise); border: 1px solid var(--line-2); }
.ur-msg.err { background: #2d0f1a; border-color: #5e2032; color: #ffc2cf; }
.ur-tri { display: grid; grid-template-columns: minmax(0, 1fr) minmax(84px, auto) minmax(84px, auto); gap: 8px; align-items: center; min-height: 30px; padding: 2px 0; }
.ur-tri > span { font-size: 15px; } .ur-tri > span:not(:first-child) { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ur-tri.head { min-height: 22px; border-bottom: 1px solid var(--line-2); padding-bottom: 4px; } .ur-tri.head > span { color: var(--accent); font-size: 13px; font-weight: 600; }
.ur-tri.indent > span:first-child { padding-left: 12px; } .ur-tri.muted > span { color: var(--muted); } .ur-tri.strong > span { font-weight: 600; font-size: 16px; }
.ur-tri.line { border-top: 1px solid var(--line-2); margin-top: 2px; padding-top: 6px; }
@media (max-width: 480px) { .ur-tri { gap: 6px; } .ur-tri > span { font-size: 14px; } .ur-tri.strong > span { font-size: 15px; } }
.ur-grp { color: var(--accent); font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; padding-top: 8px; }
.ur-bar { display: flex; height: 16px; border-radius: 8px; overflow: hidden; background: var(--raise); } .ur-bar > span { height: 100%; }
.ur-dot { display: inline-block; width: 11px; height: 11px; border-radius: 3px; margin-right: 8px; vertical-align: -1px; }
.ur-check { display: flex; align-items: center; gap: 10px; min-height: 48px; border-bottom: 1px solid var(--line); }
.ur-check input { width: 24px; height: 24px; accent-color: var(--accent); flex: none; }
.ur-toast { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 60; background: var(--raise-2);
  border: 1px solid var(--line-2); border-radius: 12px; padding: 12px 16px; font-size: 15px; max-width: calc(100vw - 32px); box-shadow: 0 8px 30px rgba(0,0,0,.5); }
.ur-sheet { position: fixed; inset: 0; z-index: 50; background: rgba(1, 3, 8, 0.72); display: flex; align-items: flex-end; justify-content: center; }
.ur-panel { background: var(--surface); border: 1px solid var(--line-2); border-bottom: 0; border-radius: 20px 20px 0 0; width: 100%; max-width: 640px;
  max-height: calc(100dvh - 24px); overflow: auto; overscroll-behavior: contain; padding: 16px 16px calc(20px + env(safe-area-inset-bottom, 0px));
  display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; }
@media (min-width: 740px) { .ur-sheet { align-items: center; } .ur-panel { border-radius: 20px; border-bottom: 1px solid var(--line-2); max-height: calc(100dvh - 48px); } }
.ur-panel-head { display: flex; align-items: center; gap: 10px; }
.ur-panel-foot { display: flex; gap: 8px; position: sticky; bottom: calc(-20px - env(safe-area-inset-bottom, 0px)); background: var(--surface); padding: 8px 0 0; margin-top: 2px; }
`;

const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const kv = (label, value, cls = '', strong = false) => `<div class="ur-kv${strong ? ' strong' : ''}"><span>${label}</span><span class="${cls}">${value}</span></div>`;
const seg = (act, options, value, label) => `<div class="ur-seg" role="group" aria-label="${esc(label)}">${options.map(([v, t]) =>
  `<button type="button" data-act="${act}" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(t)}</button>`).join('')}</div>`;
const sw = (act, on, label, extra = '') => `<button type="button" class="ur-switch" data-act="${act}" ${extra} aria-pressed="${on}" aria-label="${esc(label)}"></button>`;
const chip = (text, kind = '') => `<span class="ur-chip ${kind}">${esc(text)}</span>`;
function field(label, name, value, { unit = '', hint = '', mode = 'decimal', attr = 'data-f' } = {}) {
  return `<label class="ur-field"><span>${esc(label)}</span><div class="ur-input">${unit === '$' ? '<i>$</i>' : ''}<input type="text" inputmode="${mode}" autocomplete="off" ${attr}="${name}" value="${esc(value)}">${unit && unit !== '$' ? `<i>${esc(unit)}</i>` : ''}</div>${hint ? `<p class="ur-note">${hint}</p>` : ''}</label>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Modül
// ---------------------------------------------------------------------------------------------------------------
export function mountUretim(root, { realm = 0 } = {}) {
  let r = realm;
  let company = Y.loadCompanyRecord(r).company; // yöneticiler, nakit, bono, banka (Yönetim sekmesinde girilir)
  let setup = loadSetup(r);
  let data = null;
  let live = null;
  let liveError = null;
  let refreshing = false;
  let period = 'day';
  try { period = PERIODS.some(([k]) => k === localStorage.getItem(PERIOD_KEY)) ? localStorage.getItem(PERIOD_KEY) : 'day'; } catch { /* gizli sekme */ }
  let loadError = null;
  let loadToken = 0;
  let destroyed = false;
  let tab = 'binalar';
  try { tab = localStorage.getItem(TAB_KEY) || 'binalar'; } catch { /* gizli sekme */ }
  const fromHash = location.hash.split('/')[1];
  if (TABS.some(([k]) => k === fromHash)) tab = fromHash;
  let sheet = null; // { kind, draft, opener, ... }
  let toastTimer = null;

  const style = document.createElement('style');
  style.dataset.module = 'uretim';
  style.textContent = CSS;
  document.head.append(style);

  root.innerHTML = '<div class="ur"></div><div data-sheet></div><div data-toast></div>';
  const view = root.querySelector('.ur');
  const sheetHost = root.querySelector('[data-sheet]');
  const toastHost = root.querySelector('[data-toast]');

  const nameOf = (id) => data?.products[id]?.name || `#${id}`;
  // Kalitesi olmayan ürünlerde (araştırma, Taşıma) kalite etiketi gösterilmez
  const qChip = (product, q, kind = '') => (H.hasQuality(data?.products[product]) ? chip(`Q${q}`, kind) : '');

  // "Olayları yönet" ile Kurulum'a giderken yarım kalan bina paneli (bu oturumda saklanır, Binalar'a dönünce yeniden açılır)
  let parkedMem = null;
  function parkSheet(state) { parkedMem = state; try { sessionStorage.setItem(PARK_KEY, JSON.stringify(state)); } catch { /* yok */ } }
  function peekParked() {
    let st = parkedMem;
    if (!st) { try { st = JSON.parse(sessionStorage.getItem(PARK_KEY) || 'null'); } catch { st = null; } }
    return st && st.realm === r && st.draft && typeof st.draft === 'object' ? st : null;
  }
  function clearParked() { parkedMem = null; try { sessionStorage.removeItem(PARK_KEY); } catch { /* yok */ } }
  function resumeParked() {
    const st = peekParked();
    if (!st || !data || tab !== 'binalar' || sheet) return;
    clearParked();
    if (st.index != null && setup.buildings[st.index]?.id !== st.draft.id) return; // bina bu arada silinmiş ya da yer değiştirmiş
    openSheet('building', st.draft, { index: st.index ?? null });
    const panel = sheetHost.querySelector('.ur-panel');
    if (panel && st.scroll) panel.scrollTop = st.scroll;
  }
  const buildingName = (letter) => BUILDING_NAMES[letter] || `Bina ${letter}`;
  const now = () => Date.now();

  // Bir kutuya yazıp hemen bir düğmeye dokununca kutudan çıkma ("change") olayı, dokunmanın ortasında gelir
  // (dokunmatikte parmak kalktıktan sonra, "click"ten önce). O anda ekran yeniden çizilirse düğme altından değişir
  // ve dokunma kaybolur. Bu yüzden çizim, dokunma tamamlanana kadar bekletilir.
  let pointerActive = false;
  let pendingRender = false;
  let settleTimer = null;
  const flush = () => { clearTimeout(settleTimer); pointerActive = false; if (pendingRender) render(); };
  const onPointerDown = () => { pointerActive = true; clearTimeout(settleTimer); };
  const onPointerUp = () => { clearTimeout(settleTimer); settleTimer = setTimeout(flush, 450); }; // "click" hiç gelmezse
  const onAnyClick = () => setTimeout(flush, 0); // dokunma işlendikten hemen sonra
  function softRender() { if (pointerActive) pendingRender = true; else render(); }
  let silentSave = false; // yazarken: yalnız kaydet, ekranı yeniden çizme (klavye ve imleç kaybolmasın)
  function commit(next, { quiet = false, soft = false } = {}) {
    setup = sanitizeSetup(next);
    if (!saveSetup(r, setup) && !quiet) toast('Tarayıcı kaydı açık değil; değişiklikler sayfa kapanınca kaybolur.');
    if (silentSave) return;
    if (soft) softRender(); else render();
  }
  function toast(text) {
    toastHost.innerHTML = `<div class="ur-toast" role="status">${esc(text)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastHost.innerHTML = ''; }, 3200);
  }

  async function load() {
    const my = ++loadToken;
    data = null;
    loadError = null;
    render();
    try {
      const [d, l] = await Promise.all([loadData(r), loadLive(r).catch((e) => { liveError = e?.message || String(e); return null; })]);
      if (destroyed || my !== loadToken) return;
      data = d;
      live = l;
    } catch (e) {
      if (destroyed || my !== loadToken) return;
      loadError = e?.message || String(e);
    }
    render();
    resumeParked();
  }

  // ---- fiyatlar ----
  const marketPrice = (id, q) => live?.items?.[id]?.[1]?.[q]?.[0] ?? null;
  const priceTime = (id) => live?.items?.[id]?.[0] ?? null;
  const ago = (t) => {
    if (!t) return '';
    const m = Math.max(0, Math.round((now() - t) / 60000));
    return m < 1 ? 'az önce' : m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`;
  };
  async function refreshPrices() {
    if (refreshing) return;
    refreshing = true;
    render();
    try { live = await loadLive(r, { refresh: true }); liveError = null; toast('Fiyatlar yenilendi.'); } catch (e) { liveError = e?.message || String(e); }
    refreshing = false;
    render();
  }

  // ---- hesap ----
  // Üretim kurulumu + şirket kaydı: yönetim gideri her zaman ekipten gelir
  const withTeam = (s) => ({ ...s, executives: company.executives, finance: company.finance, admin: { mode: 'executives' } });
  const evaluate = (s = setup) => H.evaluatePlan(withTeam(s), data, marketPrice, { now: now() });

  // ---- ekran ----
  function render() {
    if (destroyed) return;
    pendingRender = false;
    const tabs = `<nav class="ur-tabs" aria-label="Üretim bölümleri">${TABS.map(([k, t]) =>
      `<a href="#uretim/${k}" ${k === tab ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
    let body;
    if (loadError) {
      body = `<div class="ur-msg err" role="alert">Veriler okunamadı: ${esc(loadError)}</div><button type="button" class="ur-btn" data-act="retry">Tekrar dene</button>`;
    } else if (!data) {
      body = '<p class="ur-sub" aria-busy="true">Ürün ve bina verileri yükleniyor…</p>';
    } else {
      try {
        const plan = evaluate();
        body = tab === 'kurulum' ? viewKurulum(plan) : tab === 'binalar' ? viewBinalar(plan) : tab === 'alimsatim' ? viewAlimSatim(plan) : viewOzet(plan);
      } catch (e) {
        console.error(e);
        body = `<div class="ur-msg err" role="alert">Bu ekran gösterilemedi: ${esc(e?.message || e)}. Kurulum'u Kopyala ile yedekleyip sayfayı yenileyin; sürerse bize bildirin.</div>`;
      }
    }
    const scroll = window.scrollY;
    view.innerHTML = tabs + body;
    window.scrollTo(0, scroll);
    if (sheet) renderSheet();
  }

  // ---- ALIM-SATIM ----
  const priceSourceChip = (source, id) => (source === 'manual' ? chip('Elle girildi', 'muted') : source === 'market' ? chip(`Borsa · ${ago(priceTime(id))}`) : chip('Fiyat yok', 'down'));
  function viewAlimSatim(plan) {
    const tp = plan.transportPrice;
    const tManual = setup.transportPrice != null;
    const liveInfo = live ? `Fiyatlar ${ago(live.t)} güncellendi.` : liveError ? 'Borsa fiyatları okunamadı.' : 'Borsa fiyatı yok.';
    const buys = plan.purchases.slice().sort((a, b) => b.costDay - a.costDay || nameOf(a.product).localeCompare(nameOf(b.product), 'tr'));
    const sells = plan.sales.slice().sort((a, b) => (b.revenueExchangeDay || 0) - (a.revenueExchangeDay || 0));
    const buyCards = buys.map((p) => {
      const forced = setup.buyQuality?.[p.product];
      const opts = H.allowedQualities(p.minQuality).map((q) => {
        const mp = marketPrice(p.product, q);
        return `<option value="${q}" ${forced != null && Number(forced) === q ? 'selected' : ''}>Q${q} · ${mp != null ? money(mp, mp < 10 ? 3 : 2) : 'fiyat yok'}</option>`;
      }).join('');
      const moved = p.quality !== p.minQuality;
      return `<div class="ur-card" style="padding:12px">
        <div class="ur-row" style="align-items:flex-start;gap:12px"><div class="grow"><div class="ur-row" style="gap:6px;flex-wrap:wrap"><span style="font-size:18px;font-weight:600">${esc(nameOf(p.product))}</span>${chip(moved ? `Q${p.minQuality}+ → Q${p.quality}` : `Q${p.minQuality}+`)}</div>
          <span class="ur-note">${smart(p.qtyDay)} adet/gün</span></div>
          <div style="text-align:right"><div class="c-down" style="font-size:18px;font-weight:600;font-variant-numeric:tabular-nums">${p.price == null ? '—' : money(-p.costDay)}</div><span class="ur-note">günlük</span></div></div>
        <div class="ur-grid2">
          <label class="ur-field"><span>Kalite</span><select data-bq="${p.product}"><option value="" ${forced == null ? 'selected' : ''}>${setup.buyPolicy === 'exact' ? 'Tam alt kalite' : 'Otomatik (en ucuz)'}</option>${opts}</select></label>
          <label class="ur-field"><span>Birim fiyat (Q${p.quality})</span><div class="ur-input"><i>$</i><input type="text" inputmode="decimal" data-p="price:${p.product}:${p.quality}" value="${p.price == null ? '' : esc(num(p.price, p.price < 10 ? 3 : 2))}" placeholder="fiyat girin"></div></label></div>
        <div class="ur-row" style="flex-wrap:wrap">${priceSourceChip(p.priceSource, p.product)}${p.priceSource === 'manual' ? `<button type="button" class="ur-btn" data-act="priceReset" data-v="${p.product}:${p.quality}" style="min-height:36px">Borsa fiyatına dön</button>` : ''}</div>
      </div>`;
    }).join('');
    const sellCards = sells.map((x) => {
      const cManual = setup.contractPrices?.[x.key] != null;
      const ux = x.exchangeUnit == null ? null : x.exchangeUnit - x.unitCost;
      const uc = x.contractUnit == null ? null : x.contractUnit - x.unitCost;
      const col = (v) => (v == null ? '' : v >= 0 ? 'c-up' : 'c-down');
      return `<div class="ur-card" style="padding:12px">
        <div class="ur-row" style="align-items:flex-start;gap:12px"><div class="grow"><div class="ur-row" style="gap:6px"><span style="font-size:18px;font-weight:600">${esc(nameOf(x.product))}</span>${qChip(x.product, x.quality)}</div>
          <span class="ur-note">fazla üretim, satılır</span></div>
          <div style="text-align:right"><div style="font-size:18px;font-weight:600;font-variant-numeric:tabular-nums">${smart(x.surplusDay)}</div><span class="ur-note">adet/gün</span></div></div>
        <div class="ur-grid2">
          <div class="ur-box" style="gap:6px"><span style="color:var(--accent);font-weight:600;font-size:14px">Borsa</span>
            <div class="ur-input"><i>$</i><input type="text" inputmode="decimal" data-p="price:${x.product}:${x.quality}" value="${x.price == null ? '' : esc(num(x.price, x.price < 10 ? 3 : 2))}" placeholder="fiyat" aria-label="Borsa satış fiyatı"></div>
            ${priceSourceChip(x.priceSource, x.product)}
            <span class="ur-note">Net birim</span><span style="font-weight:600;font-variant-numeric:tabular-nums">${money(x.exchangeUnit, 2)}</span></div>
          <div class="ur-box" style="gap:6px"><span style="color:var(--accent);font-weight:600;font-size:14px">Kontrat</span>
            <div class="ur-input"><i>$</i><input type="text" inputmode="decimal" data-p="contract:${x.product}:${x.quality}" value="${x.contractPrice == null ? '' : esc(num(x.contractPrice, x.contractPrice < 10 ? 3 : 2))}" placeholder="fiyat" aria-label="Kontrat fiyatı"></div>
            ${cManual ? chip('Elle girildi', 'muted') : chip('Borsa fiyatıyla aynı')}
            <span class="ur-note">Net birim</span><span style="font-weight:600;font-variant-numeric:tabular-nums">${money(x.contractUnit, 2)}</span></div></div>
        ${kv('Birim maliyet', money(x.unitCost, 2))}
        <div class="ur-kv"><span>Birim kâr · Borsa / Kontrat</span><span><b class="${col(ux)}">${money(ux, 2, true)}</b> <span class="c-muted">/</span> <b class="${col(uc)}">${money(uc, 2, true)}</b></span></div>
        ${cManual ? `<button type="button" class="ur-btn" data-act="contractReset" data-v="${x.key}" style="min-height:36px;align-self:flex-start">Kontratı borsa fiyatına eşitle</button>` : ''}
        <div class="ur-hr"></div>
        <div class="ur-row"><div class="grow"><div style="font-weight:600">Bu ürünü satma</div><p class="ur-note">Stokta tut, gelire yazma.</p></div>${sw('keep', false, `${nameOf(x.product)} satılmasın`, `data-v="${x.key}"`)}</div>
      </div>`;
    }).join('');
    const kept = plan.kept.map((k) => `<div class="ur-line"><div class="grow"><span class="title">${esc(nameOf(k.product))}</span> ${qChip(k.product, k.quality, 'muted')}<p class="ur-note">${smart(k.surplusDay)} adet/gün stokta kalır</p></div>
      ${sw('keep', true, `${nameOf(k.product)} satılmasın`, `data-v="${k.key}"`)}</div>`).join('');
    const grossX = plan.sales.reduce((t, x) => t + (x.price == null ? 0 : x.surplusDay * x.price), 0);
    const grossC = plan.sales.reduce((t, x) => t + (x.contractPrice == null ? 0 : x.surplusDay * x.contractPrice), 0);
    return `
      <div class="ur-head"><div><h1>Alım ve satış</h1><p class="ur-sub">${liveInfo} Her fiyatı elle değiştirebilirsiniz.</p></div>
        <button type="button" class="ur-btn" data-act="refreshPrices" ${refreshing ? 'disabled' : ''}>${refreshing ? 'Yenileniyor…' : 'Fiyatları yenile'}</button></div>
      <section class="ur-card" aria-labelledby="h-tr"><h2 id="h-tr">Taşıma</h2>
        <p class="ur-sub">Borsada satarken satıcı öder; kontratta yarısı. Borsadaki Taşıma ürününün fiyatı.</p>
        <div class="ur-row"><div class="grow"><div class="ur-input"><i>$</i><input type="text" inputmode="decimal" data-p="transport" value="${tp == null ? '' : esc(num(tp, 4))}" placeholder="fiyat girin" aria-label="Taşıma fiyatı"></div></div>
          ${tManual ? '<button type="button" class="ur-btn" data-act="transportReset">Borsa fiyatına dön</button>' : ''}</div>
        <div>${tManual ? chip('Elle girildi', 'muted') : tp != null ? chip(`Borsa · ${ago(priceTime(H.TRANSPORT_ID))}`) : chip('Fiyat yok', 'down')}</div></section>
      <section style="display:flex;flex-direction:column;gap:10px" aria-labelledby="h-buy">
        <div class="ur-head"><h2 id="h-buy">Alışlar</h2>${chip(`${money(plan.totals.purchasesDay)}/gün`, 'muted')}</div>
        <p class="ur-sub">Kendi üretiminizin karşılamadığı girdiler borsadan alınır.</p>
        <div class="ur-field"><span>Kalite seçimi</span>${seg('buyPolicy', [['cheapest', 'İzinli kalitelerin en ucuzu'], ['exact', 'Tam alt kalite']], setup.buyPolicy, 'Eksik girdinin kalitesi')}</div>
        ${buys.length ? buyCards : '<div class="ur-card"><p class="ur-note">Alınacak girdi yok; plan kendi girdisini üretiyor.</p></div>'}</section>
      <section style="display:flex;flex-direction:column;gap:10px" aria-labelledby="h-sell">
        <div class="ur-head"><h2 id="h-sell">Satışlar</h2>${chip(`${money(grossX)}/gün`, 'muted')}</div>
        <p class="ur-sub">Kendi ihtiyacınızdan fazla üretim satılır. Borsa ve kontrat fiyatı ayrı girilir; kontratta komisyon yok, taşıma yarı.</p>
        ${sells.length ? sellCards : '<div class="ur-card"><p class="ur-note">Satılacak fazla üretim yok.</p></div>'}
        ${plan.kept.length ? `<section class="ur-card"><h2>Satılmayanlar</h2>${kept}</section>` : ''}
        ${sells.length ? `<div class="ur-box">${kv('Toplam brüt satış · Borsa', money(grossX))}${kv('Toplam brüt satış · Kontrat', money(grossC))}</div>` : ''}</section>
      <a class="ur-btn primary" href="#uretim/ozet" style="text-decoration:none">Özet'e git</a>`;
  }

  // ---- ÖZET (ön muhasebe) ----
  function accounts(plan) {
    const t = plan.totals;
    const S = plan.sales;
    const tp = plan.transportPrice || 0;
    const grossX = S.reduce((a, x) => a + (x.price == null ? 0 : x.surplusDay * x.price), 0);
    const grossC = S.reduce((a, x) => a + (x.contractPrice == null ? 0 : x.surplusDay * x.contractPrice), 0);
    const fee = S.reduce((a, x) => a + (x.price == null ? 0 : x.surplusDay * x.price * H.MARKET_FEE), 0);
    const trX = S.reduce((a, x) => a + (x.price == null ? 0 : x.surplusDay * x.transportUnits * tp), 0);
    const trC = S.reduce((a, x) => a + (x.contractPrice == null ? 0 : x.surplusDay * x.transportUnits * tp * H.CONTRACT_TRANSPORT_SHARE), 0);
    return { grossX, grossC, fee, trX, trC, netX: t.revenueExchangeDay, netC: t.revenueContractDay, buy: t.purchasesDay, direct: t.wageBaseDay,
      admin: t.wagesDayNet - t.wageBaseDay, cost: t.costDay, profitX: t.profitExchangeDay, profitC: t.profitContractDay, exec: t.executiveSalariesDay,
      cashX: t.netCashExchangeDay, cashC: t.netCashContractDay, saved: t.executiveSavingsDay };
  }
  function viewOzet(plan) {
    const k = PERIODS.find(([key]) => key === period)[2];
    const A = accounts(plan);
    const m = (v, sign = false) => money(v * k, 0, sign);
    const cls = (v) => (v > 0 ? 'c-up' : v < 0 ? 'c-down' : '');
    const tri = (label, a, b, o = {}) => `<div class="ur-tri${o.strong ? ' strong' : ''}${o.line ? ' line' : ''}${o.indent ? ' indent' : ''}${o.muted ? ' muted' : ''}"><span>${label}</span><span class="${o.ca || ''}">${a}</span><span class="${o.cb || ''}">${b}</span></div>`;
    const grp = (t) => `<div class="ur-grp">${t}</div>`;
    const periodName = PERIODS.find(([key]) => key === period)[1].toLocaleLowerCase('tr');
    if (!plan.rows.length) return `<div class="ur-card ur-empty"><h2>Özet için bina ekleyin</h2><p class="ur-sub">Binalar sekmesinde planınızı kurduğunuzda gelir tablosu burada oluşur.</p><a class="ur-btn primary" href="#uretim/binalar" style="text-decoration:none;margin-top:10px">Binalar'a git</a></div>`;
    const income = `<section class="ur-card" aria-labelledby="h-inc"><h2 id="h-inc">Gelir tablosu (${periodName})</h2>
      <p class="ur-sub">Kontratta komisyon yoktur, taşıma borsanın yarısıdır.</p>
      <div class="ur-tri head"><span></span><span>Borsa</span><span>Kontrat</span></div>
      ${grp('Gelir')}${tri('Brüt satış', m(A.grossX), m(A.grossC))}
      ${tri('Komisyon (%4)', m(-A.fee), '—', { indent: true, muted: true })}${tri('Taşıma', m(-A.trX), m(-A.trC), { indent: true, muted: true })}
      ${tri('Net satış', m(A.netX), m(A.netC), { strong: true, line: true })}
      ${grp('Maliyet')}${tri('Girdi alımları', m(-A.buy), m(-A.buy), { indent: true })}${tri('Bina maaşları', m(-A.direct), m(-A.direct), { indent: true })}
      ${tri('Yönetim gideri', m(-A.admin), m(-A.admin), { indent: true })}${tri('Toplam maliyet', m(-A.cost), m(-A.cost), { strong: true, line: true })}
      ${tri('Brüt kâr', m(A.profitX, true), m(A.profitC, true), { strong: true, line: true, ca: cls(A.profitX), cb: cls(A.profitC) })}
      ${grp('İşletme gideri')}${tri('Yönetici maaşları', m(-A.exec), m(-A.exec), { indent: true })}
      ${tri('Net nakit', m(A.cashX, true), m(A.cashC, true), { strong: true, line: true, ca: cls(A.cashX), cb: cls(A.cashC) })}
      <div class="ur-hr"></div>
      ${tri('Brüt kâr marjı', A.netX ? pctText(A.profitX / A.netX, 1) : '—', A.netC ? pctText(A.profitC / A.netC, 1) : '—', { muted: true })}
      ${tri('Yönetici tasarrufu', m(A.saved, true), m(A.saved, true), { muted: true, ca: 'c-up', cb: 'c-up' })}
      <p class="ur-note">Brüt kâr: net satıştan girdi, bina maaşı ve yönetim gideri düşülmüş hâli. Net nakit: yönetici maaşları da düşülünce günün sonunda kasaya giren. Yönetici tasarrufu bilgi satırıdır, toplama girmez.</p></section>`;
    const parts = [['Girdi alımları', A.buy, 'var(--accent)'], ['Bina maaşları', A.direct, '#3e78b2'], ['Yönetim gideri', A.admin, 'var(--price)'], ['Yönetici maaşları', A.exec, '#6f86a3']].filter((x) => x[1] > 0);
    const total = parts.reduce((a, x) => a + x[1], 0);
    const costs = total > 0 ? `<section class="ur-card" aria-labelledby="h-cost"><h2 id="h-cost">Maliyet dağılımı (${periodName})</h2>
      <div class="ur-bar" role="img" aria-label="${parts.map(([n, v]) => `${n} ${pctText(v / total, 0)}`).join(', ')}">${parts.map(([, v, c]) => `<span style="width:${(v / total * 100).toFixed(2)}%;background:${c}"></span>`).join('')}</div>
      ${parts.map(([n, v, c]) => `<div class="ur-kv"><span><i class="ur-dot" style="background:${c}"></i>${n}</span><span>${m(v)} <small class="c-muted">${pctText(v / total, 1)}</small></span></div>`).join('')}
      <div class="ur-hr"></div>${kv('Toplam gider', m(total), '', true)}</section>` : '';
    const products = plan.sales.map((x) => {
      const ux = x.exchangeUnit == null ? null : x.exchangeUnit - x.unitCost;
      const uc = x.contractUnit == null ? null : x.contractUnit - x.unitCost;
      return `<div class="ur-card" style="padding:12px"><div class="ur-row" style="gap:6px;flex-wrap:wrap"><span style="font-size:18px;font-weight:600">${esc(nameOf(x.product))}</span>${qChip(x.product, x.quality)}<span class="ur-note" style="margin-left:auto">${smart(x.surplusDay)} adet/gün</span></div>
        <div class="ur-tri head"><span></span><span>Borsa</span><span>Kontrat</span></div>
        ${tri('Birim maliyet', money(x.unitCost, 2), money(x.unitCost, 2))}${tri('Net birim gelir', money(x.exchangeUnit, 2), money(x.contractUnit, 2))}
        ${tri('Birim kâr', money(ux, 2, true), money(uc, 2, true), { strong: true, line: true, ca: cls(ux), cb: cls(uc) })}
        ${tri(`Kâr (${periodName})`, x.profitExchangeDay == null ? '—' : m(x.profitExchangeDay, true), x.profitContractDay == null ? '—' : m(x.profitContractDay, true), { ca: cls(x.profitExchangeDay), cb: cls(x.profitContractDay) })}
        ${tri('Saat başı, seviye başı kâr', money(x.pphplExchange, 0, true), money(x.pphplContract, 0, true), { muted: true })}</div>`;
    }).join('');
    const T = plan.admin;
    const ex = H.executiveAnalysis(withTeam(setup), data, plan);
    const grossPct = T.gross * 100;
    const savedPts = grossPct * T.savings;
    const hasTeam = company.executives.length > 0;
    const execs = `<section class="ur-card" aria-labelledby="h-ex2"><h2 id="h-ex2">Yönetim ve vergi (${periodName})</h2>
        <p class="ur-sub">Ekip Yönetim sekmesinde girilir; bu plandaki binalar için hesaplanır.${hasTeam ? '' : ' Henüz yönetici yok.'}</p>
        <div class="ur-box">${kv('Brüt yönetim gideri', `%${NF[2].format(grossPct)} − ${NF[2].format(savedPts)}`)}
          ${kv('Net yönetim gideri', `%${NF[2].format(grossPct - savedPts)}`, 'c-price', true)}
          ${kv('Yönetim tasarrufu', `%${NF[T.savings * 100 % 1 ? 2 : 0].format(T.savings * 100)}`, T.savings > 0 ? 'c-up' : '', true)}</div>
        <div class="ur-box">${kv('Yönetimin kazandırdığı', m(ex.teamCooValueDay), ex.teamCooValueDay > 0 ? 'c-up' : '')}
          ${kv('Günlük vergi', m(ex.taxDay), 'c-price')}${kv('Yöneticisiz olsaydı', m(ex.taxWithoutDay))}
          ${kv('Muhasebenin kazandırdığı', m(ex.teamCfoValueDay), ex.teamCfoValueDay > 0 ? 'c-up' : '')}
          <div class="ur-hr"></div>
          ${kv('Yöneticilerin kazandırdığı', m(ex.teamValueDay), '', true)}${kv('Yönetici maaşları', m(ex.salariesDay))}
          ${kv('Net getiri', m(ex.teamNetDay, true), cls(ex.teamNetDay), true)}</div>
        ${hasTeam ? `<p class="ur-note">Bilim: araştırma hızı +%${NF[0].format(ex.team.researchSpeedPct)} (araştırma binalarına uygulandı). İletişim: satış hızı +%${NF[0].format(ex.team.salesSpeedPct)} (Perakende bölümünde).</p>` : ''}
        ${!ex.assets ? '<p class="ur-note">Muhasebenin vergi değeri için Yönetim › Muhasebe altında nakit ve bonoyu girin.</p>' : ''}
        <a class="ur-btn" href="#yonetim/ekip" style="text-decoration:none">Yönetim'de düzenle</a></section>`;
    const manualCount = Object.keys(setup.prices || {}).length + Object.keys(setup.contractPrices || {}).length + (setup.transportPrice != null ? 1 : 0);
    const evs = activeEvents().filter((e) => setup.events?.[e.product] !== false && setup.buildings.some((b) => b.product === e.product));
    const notes = [
      live ? `Borsa fiyatları ${ago(live.t)} güncellendi.` : 'Borsa fiyatları okunamadı; fiyatları elle girin.',
      manualCount ? `${manualCount} fiyat elle girildi.` : 'Bütün fiyatlar borsadan.',
      `Ekonomi fazı: ${H.ECONOMY_PHASES[setup.economyPhase]}.${evs.length ? ` Etkin olay: ${evs.map((e) => `${nameOf(e.product)} ${e.pct > 0 ? '+' : '−'}%${Math.abs(e.pct)}`).join(', ')}.` : ''}`,
      'Vergi (muhasebe ücreti) kâra dahil değil; nakde bağlıdır. Günlük vergi ve muhasebecinin değeri bu sayfadaki Yönetim ve vergi kartında.',
      ...plan.warnings.map((w) => w.text),
    ];
    return `
      <div class="ur-head"><div><h1>Ön muhasebe</h1><p class="ur-sub">Planınızın gelir, gider ve kâr tablosu.</p></div></div>
      ${seg('period', PERIODS.map(([key, t]) => [key, t]), period, 'Dönem')}
      <div class="ur-grid2">
        <div class="ur-card" style="padding:12px;gap:2px"><span class="ur-note" style="font-weight:600">Brüt kâr · Borsa</span><span class="${cls(A.profitX)}" style="font:600 22px var(--font-c)">${m(A.profitX, true)}</span><span class="ur-note">Net nakit ${m(A.cashX, true)}</span></div>
        <div class="ur-card" style="padding:12px;gap:2px"><span class="ur-note" style="font-weight:600">Brüt kâr · Kontrat</span><span class="${cls(A.profitC)}" style="font:600 22px var(--font-c)">${m(A.profitC, true)}</span><span class="ur-note">Net nakit ${m(A.cashC, true)}</span></div></div>
      ${income}${costs}
      ${plan.sales.length ? `<section style="display:flex;flex-direction:column;gap:10px"><h2>Ürün bazında kârlılık</h2><p class="ur-sub">Her ürünün maliyeti kendi zincirindeki girdi ve işçilikle hesaplanır.</p>${products}</section>` : ''}
      ${execs}
      <section class="ur-card" aria-labelledby="h-notes"><h2 id="h-notes">Hesap notları</h2>${notes.map((n) => `<p class="ur-note">• ${esc(n)}</p>`).join('')}</section>
      <div class="ur-row"><button type="button" class="ur-btn grow" data-act="copySummary">${icon('copy')}Özeti kopyala</button><a class="ur-btn grow" href="#uretim/alimsatim" style="text-decoration:none">Alım-Satım'a dön</a></div>`;
  }
  function summaryText(plan) {
    const k = PERIODS.find(([key]) => key === period)[2];
    const A = accounts(plan);
    const m = (v) => money(v * k);
    const L = [`DentSimco üretim özeti · Realm ${r + 1} · ${PERIODS.find(([key]) => key === period)[1]} · ${H.ECONOMY_PHASES[setup.economyPhase]}`,
      `Binalar: ${setup.buildings.map((b) => `${nameOf(b.product)}${H.hasQuality(data.products[b.product]) ? ` Q${b.quality}` : ''} (${buildingName(b.type)} ${b.level})`).join(', ')}`, '',
      `                      Borsa        Kontrat`,
      ...[['Brüt satış', A.grossX, A.grossC], ['Komisyon', -A.fee, 0], ['Taşıma', -A.trX, -A.trC], ['Net satış', A.netX, A.netC], ['Girdi alımları', -A.buy, -A.buy],
        ['Bina maaşları', -A.direct, -A.direct], ['Yönetim gideri', -A.admin, -A.admin], ['Brüt kâr', A.profitX, A.profitC], ['Yönetici maaşları', -A.exec, -A.exec],
        ['Net nakit', A.cashX, A.cashC]].map(([n, a, b]) => `${n.padEnd(20)}${m(a).padStart(12)} ${m(b).padStart(13)}`)];
    return L.join('\n');
  }

  // ---- KURULUM ----
  function viewKurulum(plan) {
    const a = plan.admin;
    const planLevels = (setup.buildings || []).reduce((t, b) => t + (b.level || 0), 0);
    const recBonus = H.recreationBonus(setup.recreation);
    const manualBonus = (Number(setup.extraBonusPct) || 0) / 100;
    const totalBonus = recBonus + manualBonus;
    const bonusPct = (x) => pctText(x, Math.abs(x * 100 - Math.round(x * 100)) > 1e-6 ? 2 : 0);
    return `
      <div class="ur-head"><div><h1>Realm ${r + 1} kurulumu</h1><p class="ur-sub">Bu tarayıcıda saklanır.</p></div>
        <div class="ur-row"><button type="button" class="ur-btn" data-act="export">${icon('copy')}Kopyala</button><button type="button" class="ur-btn" data-act="import">Yapıştır</button></div></div>

      <section class="ur-card" aria-labelledby="h-faz"><h2 id="h-faz">Ekonomi fazı</h2>
        <p class="ur-sub">Oyundaki güncel fazı seçin. Faz binaların saatlik üretimini değiştirir, maaşı değiştirmez. Durgunlukta üretim en yüksek, Büyümede en düşüktür.</p>
        ${seg('phase', H.ECONOMY_PHASES.map((t, i) => [i, t]), setup.economyPhase, 'Ekonomi fazı')}</section>

      <section class="ur-card" aria-labelledby="h-rec"><h2 id="h-rec">Rekreasyon binaları</h2>
        <p class="ur-sub">Seviye başına %1 üretim hızı (üretim ve araştırma binaları). Her zaman hesaba katılır, yönetim giderine girmez.</p>
        ${REC.map(([k, t]) => `<div class="ur-row"><span style="min-width:78px;font-weight:600">${t}</span><div class="grow">${seg(`rec.${k}`, [[0, '0'], [1, '1'], [2, '2'], [3, '3']], setup.recreation[k] || 0, `${t} seviyesi`)}</div></div>`).join('')}
        <div class="ur-hr"></div>${kv('Rekreasyon bonusu', pctText(recBonus, 0))}</section>

      <section class="ur-card" aria-labelledby="h-hiz"><h2 id="h-hiz">Üretim hızı</h2>
        ${field('Üretim hızı (elle)', 'extraBonusPct', num(setup.extraBonusPct, setup.extraBonusPct % 1 ? 2 : 0), { unit: '%', hint: 'Rekreasyon dışındaki üretim hızı bonusunuz. Rekreasyon bonusu buna her zaman eklenir.' })}
        <div class="ur-hr"></div>${kv('Toplam üretim hızı', bonusPct(totalBonus), 'c-price', true)}
        <p class="ur-note">Elle girdiğiniz değer ile rekreasyon bonusunun toplamıdır; buradan değiştirilemez.</p></section>

      <section class="ur-card" aria-labelledby="h-diger"><h2 id="h-diger">Diğer binalar</h2>
        <p class="ur-sub">Plana girmediğiniz binalar. Akademi yönetim giderine girer. Banka girmez, yalnız vergilendirme başlangıcını yükseltir.</p>
        ${field('Akademi seviyesi', 'academyLevel', num(setup.academyLevel), { mode: 'numeric' })}
        ${field('Banka seviyesi', 'finance.bankLevel', num(company.finance.bankLevel), { mode: 'numeric', hint: 'Bankanız yoksa 0. Seviye başı, muhasebe puanı başı +$50k vergi eşiği (en çok 40).' })}
        <div class="ur-hr"></div>
        ${kv('Plandaki binalar', num(planLevels))}${kv('Akademi', num(setup.academyLevel))}
        ${kv('Toplam bina seviyesi', num(a.totalLevels), '', true)}
        <p class="ur-note">Yönetim gideri bu toplamdan ve Yönetim sekmesindeki ekipten hesaplanır. Perakende binaları Perakende bölümü gelince eklenecek.</p></section>

      ${cardEvents()}

      <section class="ur-card" aria-labelledby="h-gen"><h2 id="h-gen">Genel</h2>
        <div class="ur-row"><div class="grow"><div style="font-size:17px;font-weight:600">Kalite ikamesi</div><p class="ur-sub">Yüksek kalite fazlası, aynı ürünün düşük kalite ihtiyacını karşılar.</p></div>
          ${sw('substitution', setup.substitution !== false, 'Kalite ikamesi')}</div>
        <div class="ur-hr"></div>
        <button type="button" class="ur-btn danger" data-act="reset">${icon('trash')}Bu kurulumu sıfırla</button>
        <p class="ur-note">Realm ${r + 1} kurulumunu bu tarayıcıdan siler. Önce Kopyala ile yedek alabilirsiniz.</p></section>`;
  }

  function activeEvents() {
    const t = now();
    const seen = new Map();
    for (const e of data.events) if (e.since <= t && t < e.until && data.products[e.product]) seen.set(e.product, e);
    return [...seen.values()].sort((a, b) => nameOf(a.product).localeCompare(nameOf(b.product), 'tr'));
  }
  function cardEvents() {
    const list = activeEvents();
    const inPlan = new Set((setup.buildings || []).map((b) => b.product));
    const rows = list.map((e) => {
      const on = setup.events?.[e.product] !== false;
      const sign = e.pct > 0 ? '+' : '−';
      return `<div class="ur-line"><div class="grow"><div class="ur-row" style="flex-wrap:wrap"><span class="title">${esc(nameOf(e.product))}</span>${chip(`${sign}%${Math.abs(e.pct)}`, e.pct > 0 ? '' : 'down')}</div>
        <div class="ur-row" style="margin-top:2px"><span class="ur-note">${Number.isFinite(e.until) ? `${whenFmt.format(e.until)}'e kadar` : 'süresiz'}</span>${inPlan.has(e.product) ? chip('Planda', 'up') : ''}</div></div>
        ${sw('event', on, `${nameOf(e.product)} olayı`, `data-v="${e.product}"`)}</div>`;
    }).join('');
    return `<section class="ur-card" aria-labelledby="h-ev"><h2 id="h-ev">Oyun olayları</h2>
      <p class="ur-sub">Bir olayı kapatırsanız o ürünü üreten bütün binalarda hesaba katılmaz. Olaylar oyundan otomatik gelir.</p>
      ${(() => {
        const st = peekParked();
        if (!st) return '';
        const what = st.draft.product ? nameOf(st.draft.product) : st.draft.type ? buildingName(st.draft.type) : 'Bina';
        return `<div class="ur-box"><div class="ur-row"><div class="grow"><div style="font-weight:600">Yarım kalan bina ayarı</div><p class="ur-note">${esc(what)} düzenlemesi kaldığınız yerden devam eder.</p></div><button type="button" class="ur-btn primary" data-act="resumeSheet">Binaya dön</button></div></div>`;
      })()}
      ${list.length ? `<div>${rows}</div>` : '<p class="ur-note">Şu an etkin oyun olayı yok.</p>'}</section>`;
  }

  // ---- BİNALAR ----
  function viewBinalar(plan) {
    const rows = plan.rows;
    const levels = rows.reduce((t, x) => t + (x.level || 0), 0);
    const cards = (setup.buildings || []).map((b, i) => buildingCard(b, rows[i], i)).join('');
    const empty = `<div class="ur-card ur-empty"><h2>Henüz bina yok</h2><p class="ur-sub">Bina ekleyin: tür, ürün, kalite ve seviye seçin. Eksik girdiler aşağıda listelenir ve tek dokunuşla eklenir.</p></div>`;
    // Rehber kartı: toplam üretim hızı (rekreasyon + elle girilen) ve ekiple net yönetim gideri; Perakende ile aynı kart
    const speed = H.recreationBonus(setup.recreation) + (Number(setup.extraBonusPct) || 0) / 100;
    const frac = (x) => (Math.abs(x * 100 - Math.round(x * 100)) > 1e-6 ? 1 : 0);
    return `
      ${guideCard({ title: 'Üretim', lead: 'Binalarınızın ne kadar ürettiğini ve ne kadar maaş ödediğini hesaplar.',
        chips: [[`Toplam üretim bonusu ${pctText(speed, frac(speed))}`, speed > 0 ? '' : 'muted'], [`Yönetim gideri ${pctText(plan.admin.net, frac(plan.admin.net))}`, 'muted']] })}
      <div class="ur-stats">
        <div class="ur-stat"><span>Bina</span><span>${num(rows.length)}</span></div>
        <div class="ur-stat"><span>Plan seviyesi</span><span>${num(levels)}</span></div>
        <div class="ur-stat"><span>Maaş/gün</span><span>${money(plan.totals.wagesDayNet)}</span></div></div>
      <div class="ur-row" style="flex-wrap:wrap"><button type="button" class="ur-btn primary grow" data-act="bNew" style="flex-basis:100%">${icon('plus')}Bina ekle</button>
        ${rows.length > 1 ? '<button type="button" class="ur-btn grow" data-act="bulk">Toplu düzenle</button><button type="button" class="ur-btn grow" data-act="autoQuality">Otomatik kalite</button>' : ''}</div>
      ${rows.length ? `<div class="ur-bgrid">${cards}</div>` : empty}
      ${rows.length ? summaryCard(plan) : ''}
      ${missingCard(plan)}`;
  }

  function buildingCard(b, row, i) {
    const p = data.products[b.product];
    const chips = [];
    if (row?.eventPct) chips.push(chip(`Olay ${row.eventPct > 0 ? '+' : '−'}%${Math.abs(row.eventPct)}`, row.eventPct > 0 ? '' : 'down'));
    if (row?.bonus > 0) chips.push(chip(`Rekreasyon ${pctText(row.bonus, 0)}`, 'muted'));
    if (row?.category === 'production') chips.push(chip(b.robots ? 'Robot var' : 'Robot yok', 'muted'));
    if (H.ABUNDANCE_BUILDINGS.has(b.type)) chips.push(chip(`Bolluk %${num(b.efficiency, b.efficiency % 1 ? 1 : 0)}`, 'muted'));
    for (const e of row?.errors || []) chips.push(chip(e, 'down'));
    const title = p ? esc(p.name) : 'Ürün seçilmedi';
    return `<article class="ur-card" aria-label="${title}, ${esc(buildingName(b.type))}, seviye ${b.level}">
      <div class="ur-row" style="gap:12px">
        <div class="grow"><div class="ur-row" style="flex-wrap:wrap;gap:6px"><span style="font:600 19px var(--font-c)">${title}</span>${qChip(b.product, b.quality)}</div>
          <span class="ur-note">${esc(buildingName(b.type))}</span></div>
        <div class="ur-level"><small>Seviye</small><b>${num(b.level)}</b></div></div>
      <div class="ur-hr"></div>
      <div class="ur-metrics">
        <div class="ur-stat"><span>Saatlik</span><span class="c-price">${perHour(row?.hourly)}</span></div>
        <div class="ur-stat"><span>Günlük</span><span>${smart(row?.daily)}</span></div>
        <div class="ur-stat"><span>Maaş/gün</span><span>${money(row?.wageDayNet)}</span></div></div>
      ${chips.length ? `<div class="ur-chips">${chips.join('')}</div>` : ''}
      <div class="ur-row"><button type="button" class="ur-btn tint grow" data-act="bEdit" data-v="${i}">${icon('edit')}Düzenle</button>
        <button type="button" class="ur-btn" data-act="bCopy" data-v="${i}" aria-label="Aynı özelliklerle kopyala">${icon('copy')}</button>
        <button type="button" class="ur-btn danger" data-act="bDel" data-v="${i}" aria-label="Sil">${icon('trash')}</button></div>
    </article>`;
  }

  function summaryCard(plan) {
    const lines = plan.pools.slice().sort((a, b) => nameOf(a.product).localeCompare(nameOf(b.product), 'tr') || a.quality - b.quality).map((pool) => {
      const surplus = pool.producedDay - pool.usedDay;
      const used = pool.usedDay > 0;
      const tag = surplus > 1e-6 * pool.producedDay
        ? chip(`Fazla ${smart(surplus)} satılır`, 'up')
        : chip('Tamamı kullanılır', 'muted');
      return `<div class="ur-line" style="flex-wrap:wrap"><div class="grow"><div class="ur-row" style="gap:6px"><span class="title">${esc(nameOf(pool.product))}</span>${qChip(pool.product, pool.quality)}</div>
        <span class="ur-note">Günlük ${smart(pool.producedDay)} üretilir${used ? `, ${smart(pool.usedDay)} planda kullanılır` : ''}</span></div>${tag}</div>`;
    }).join('');
    return `<section class="ur-card" aria-labelledby="h-sum"><h2 id="h-sum">Üretim özeti</h2>${lines}</section>`;
  }

  function missingCard(plan) {
    if (!plan.purchases.length) return '';
    const byRow = new Map(plan.rows.map((x, i) => [i, x]));
    const consumers = (product, minQ) => {
      const set = new Set();
      for (const d of plan.demands) if (d.product === product && d.minQuality === minQ && d.buyQty > 0) {
        const x = byRow.get(d.row);
        if (x) set.add(`${nameOf(x.product)} Q${x.quality}`);
      }
      return [...set];
    };
    const list = plan.purchases.slice().sort((a, b) => nameOf(a.product).localeCompare(nameOf(b.product), 'tr') || a.minQuality - b.minQuality);
    const items = list.map((p) => {
      const s = p.suggestion;
      const who = consumers(p.product, p.minQuality);
      return `<div class="ur-card" style="padding:12px">
        <div class="ur-row" style="align-items:flex-start;gap:12px"><div class="grow"><div class="ur-row" style="gap:6px;flex-wrap:wrap"><span style="font-size:18px;font-weight:600">${esc(nameOf(p.product))}</span>${chip(`Q${p.minQuality}+`)}</div>
          <span class="ur-note">${who.length ? `${esc(who.join(', '))} için` : ''}</span></div>
          <div style="text-align:right"><div class="c-down" style="font-size:18px;font-weight:600;font-variant-numeric:tabular-nums">${smart(p.qtyDay)}</div><span class="ur-note">adet/gün eksik</span></div></div>
        ${s ? `<button type="button" class="ur-btn tint" data-act="quickAdd" data-v="${p.product}" data-q="${p.minQuality}" data-l="${s.levels}">${icon('plus')}+${num(s.levels)} ${esc(buildingName(s.type))}</button>`
    : '<p class="ur-note">Bu ürün bir binada üretilmiyor; borsadan alınır.</p>'}</div>`;
    }).join('');
    return `<section aria-labelledby="h-miss" style="display:flex;flex-direction:column;gap:10px">
      <div class="ur-head"><h2 id="h-miss">Eksik girdiler</h2>${chip(`${list.length} kalem`, 'muted')}</div>
      <p class="ur-sub">Kendi üretiminizin karşılamadığı girdiler borsadan alınır. Düğmeye basınca bina, ürün ve kalite otomatik eklenir; sayı, eksiği karşılayan seviyedir.</p>
      ${items}</section>`;
  }

  // ---- PANELLER ----
  function openSheet(kind, draft, extra = {}) {
    sheet = { kind, draft, opener: document.activeElement, ...extra };
    renderSheet(true);
  }
  function closeSheet() {
    const opener = sheet?.opener;
    sheet = null;
    sheetHost.innerHTML = '';
    document.body.style.overflow = '';
    if (opener && document.contains(opener)) opener.focus?.();
  }
  function renderSheet(first = false) {
    if (!sheet || !data) { sheetHost.innerHTML = ''; return; }
    // Panel yeniden çizilirken (+/− , kalite, robot...) kaydırma konumu ve odaklı düğme korunur; yoksa panel başa atlar
    const oldPanel = first ? null : sheetHost.querySelector('.ur-panel');
    const keepScroll = oldPanel ? oldPanel.scrollTop : 0;
    const active = document.activeElement?.closest?.('.ur-panel') ? document.activeElement : null;
    const focusSel = (() => {
      if (!active) return null;
      const dd = active.getAttribute('data-d');
      const aa = active.getAttribute('data-act');
      const vv = active.getAttribute('data-v');
      const safe = (x) => String(x).replace(/["\\]/g, '');
      if (dd) return `[data-d="${safe(dd)}"]`;
      if (aa) return vv != null ? `[data-act="${safe(aa)}"][data-v="${safe(vv)}"]` : `[data-act="${safe(aa)}"]`;
      return null;
    })();
    const html = sheet.kind === 'building' ? sheetBuilding()
      : sheet.kind === 'export' ? sheetExport() : sheet.kind === 'import' ? sheetImport() : sheet.kind === 'reset' ? sheetReset()
        : sheet.kind === 'bulk' ? sheetBulk() : '';
    sheetHost.innerHTML = `<div class="ur-sheet ur" style="padding:0;max-width:none;margin:0" data-act="sheetBackdrop"><div class="ur-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${html}</div></div>`;
    document.body.style.overflow = 'hidden';
    if (first) sheetHost.querySelector('.ur-panel select, .ur-panel input, .ur-panel textarea, .ur-panel button')?.focus();
    else {
      if (focusSel) sheetHost.querySelector(focusSel)?.focus({ preventScroll: true });
      const panel = sheetHost.querySelector('.ur-panel');
      if (panel && keepScroll) panel.scrollTop = keepScroll;
    }
  }
  const panelHead = (title, sub = '') => `<div class="ur-panel-head"><div class="grow" style="flex:1"><h2 id="sheet-title">${esc(title)}</h2>${sub ? `<p class="ur-sub">${esc(sub)}</p>` : ''}</div>
    <button type="button" class="ur-btn" data-act="sheetClose" aria-label="Kapat">${icon('close')}</button></div>`;

  // Bina paneli
  const typeOptions = () => {
    const productsBy = new Map();
    for (const p of Object.values(data.products)) if (p.building && p.perHour > 0) productsBy.set(p.building, (productsBy.get(p.building) || 0) + 1);
    const groups = { production: [], research: [] };
    for (const letter of productsBy.keys()) {
      const cat = H.buildingCategory(data, letter);
      if (groups[cat]) groups[cat].push(letter);
    }
    const opt = (list) => list.sort((a, b) => buildingName(a).localeCompare(buildingName(b), 'tr'))
      .map((l) => `<option value="${esc(l)}" ${sheet.draft.type === l ? 'selected' : ''}>${esc(buildingName(l))}</option>`).join('');
    return `<option value="" ${sheet.draft.type ? '' : 'selected'} disabled>Bina türü seçin</option><optgroup label="Üretim">${opt(groups.production)}</optgroup><optgroup label="Araştırma">${opt(groups.research)}</optgroup>`;
  };
  const productOptions = () => {
    const list = Object.values(data.products).filter((p) => p.building === sheet.draft.type && p.perHour > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return `<option value="" ${sheet.draft.product ? '' : 'selected'} disabled>Ürün seçin</option>${list.map((p) => `<option value="${p.id}" ${sheet.draft.product === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  };
  function draftSetup() {
    const b = { ...sheet.draft };
    const list = [...setup.buildings];
    if (sheet.index != null) list[sheet.index] = b; else list.push(b);
    return withTeam({ ...setup, buildings: list });
  }
  function buildingResult() {
    const d = sheet.draft;
    const p = data.products[d.product];
    if (!p) return '<p class="ur-note">Sonucu görmek için ürün seçin.</p>';
    const ds = draftSetup();
    const admin = H.adminInfo(ds, data);
    const row = H.buildingRate(d, ds, data, admin, now());
    if (!row.ok) return `<div class="ur-msg err">${esc(row.errors.join('. '))}</div>`;
    const minQ = H.minInputQuality(H.hasQuality(p) ? d.quality : 0);
    return `<div class="ur-box"><span class="ur-note" style="font-weight:600">Bu bina için</span>
      ${kv('Saatlik üretim', perHour(row.hourly), 'c-price', true)}${kv('Günlük üretim', smart(row.daily))}
      ${kv('Maaş/saat (yönetim dahil)', money(row.wageHour * (1 + admin.net)))}
      ${kv('İşçi birim maliyeti', money(row.unitWorker, 2))}${kv('Yönetici birim maliyeti', money(row.unitAdmin, 2))}
      ${p.inputs.length ? `<div class="ur-hr"></div>${p.inputs.map(([id, amount]) => kv(`Günlük girdi: ${esc(nameOf(id))} Q${minQ}+`, smart(amount * row.daily))).join('')}` : ''}
      ${row.notes.map((n) => `<p class="ur-note">${esc(n)}</p>`).join('')}</div>`;
  }
  function sheetBuilding() {
    const d = sheet.draft;
    const p = data.products[d.product];
    const cat = d.type ? H.buildingCategory(data, d.type) : null;
    const eventPct = p && setup.events?.[p.id] !== false ? H.activeEventPct(data, p.id, now()) : 0;
    const ev = p ? data.events.find((e) => e.product === p.id && e.since <= now() && now() < e.until) : null;
    return `${panelHead(sheet.index != null ? 'Bina düzenle' : 'Bina ekle', d.type ? buildingName(d.type) : '')}
      <label class="ur-field"><span>Bina türü</span><select data-d="type">${typeOptions()}</select></label>
      ${d.type ? `<label class="ur-field"><span>Ürün</span><select data-d="product">${productOptions()}</select></label>` : ''}
      ${p ? `${H.hasQuality(p) ? `<div class="ur-field"><span>Ürün kalitesi</span><div class="ur-q" role="group" aria-label="Ürün kalitesi">${H.allowedQualities(0).map((q) => `<button type="button" data-act="dq" data-v="${q}" aria-pressed="${d.quality === q}">Q${q}</button>`).join('')}</div></div>` : ''}
        <div class="ur-field"><span>Bina seviyesi</span><div class="ur-stepper"><button type="button" data-act="dLevel" data-v="-1" aria-label="Seviyeyi azalt">${icon('minus')}</button>
          <input type="text" inputmode="numeric" data-d="level" value="${d.level}" aria-label="Bina seviyesi"><button type="button" data-act="dLevel" data-v="1" aria-label="Seviyeyi artır">${icon('plus')}</button></div></div>
        ${cat === 'production' ? `<div class="ur-field"><span>Robot</span>${seg('dRobot', [['0', 'Yok'], ['1', 'Var']], d.robots ? '1' : '0', 'Robot')}<p class="ur-note">Robot taban maaşı %3 düşürür, üretimi değiştirmez.</p></div>` : ''}
        ${H.ABUNDANCE_BUILDINGS.has(d.type) ? `<label class="ur-field"><span>Bolluk</span><div class="ur-input"><input type="text" inputmode="decimal" data-d="efficiency" value="${esc(num(d.efficiency, d.efficiency % 1 ? 2 : 0))}" aria-label="Bolluk"><i>%</i></div>
          <p class="ur-note">Petrol kuyusu, maden ve taş ocağında üretim bolluğa göre azalır. Oyundaki bina sayfasından bakın.</p></label>` : ''}
        ${ev ? `<div class="ur-box"><div class="ur-kv"><span>Oyun olayı</span><span>${chip(`${ev.pct > 0 ? '+' : '−'}%${Math.abs(ev.pct)}`, ev.pct > 0 ? '' : 'down')}</span></div>
          <p class="ur-note">${eventPct ? `${whenFmt.format(ev.until)}'e kadar. Bu ürünü üreten bütün binalarda hesaba katılır.` : 'Kurulum\'da kapatıldı; hesaba katılmıyor.'}</p>
          <button type="button" class="ur-btn" data-act="gotoEvents" style="margin-top:6px">Olayları yönet</button></div>` : ''}
        <div data-result>${buildingResult()}</div>` : ''}
      <div class="ur-panel-foot">${sheet.index != null ? `<button type="button" class="ur-btn danger" data-act="bDelSheet" aria-label="Binayı sil">${icon('trash')}</button>` : ''}
        <button type="button" class="ur-btn grow" data-act="sheetClose">Vazgeç</button>
        <button type="button" class="ur-btn primary grow" data-act="bSave" ${p ? '' : 'disabled'}>${sheet.index != null ? 'Kaydet' : 'Ekle'}</button></div>`;
  }

  function sheetExport() {
    return `${panelHead('Kurulumu kopyala', `Realm ${r + 1}`)}
      <p class="ur-sub">Bu metni başka bir cihazda Kurulum › Yapıştır ile yükleyin.</p>
      <textarea readonly data-d="exportText" aria-label="Kurulum metni">${esc(JSON.stringify(setup))}</textarea>
      <div class="ur-panel-foot"><button type="button" class="ur-btn grow" data-act="sheetClose">Kapat</button><button type="button" class="ur-btn primary grow" data-act="copyExport">${icon('copy')}Panoya kopyala</button></div>`;
  }
  function sheetImport() {
    return `${panelHead('Kurulumu yapıştır', `Realm ${r + 1}`)}
      <p class="ur-sub">Başka bir cihazda Kopyala ile aldığınız metni yapıştırın. Bu realm'in mevcut kurulumunun yerine geçer.</p>
      <textarea data-d="importText" spellcheck="false" autocapitalize="off" aria-label="Kurulum metni">${esc(sheet.text || '')}</textarea>
      ${sheet.error ? `<div class="ur-msg err" role="alert">${esc(sheet.error)}</div>` : ''}
      <div class="ur-panel-foot"><button type="button" class="ur-btn grow" data-act="sheetClose">Vazgeç</button><button type="button" class="ur-btn primary grow" data-act="importApply">Yükle</button></div>`;
  }
  function sheetBulk() {
    const sel = sheet.sel;
    const list = setup.buildings.map((b, i) => `<label class="ur-check"><input type="checkbox" data-bsel="${i}" ${sel.has(i) ? 'checked' : ''}>
      <span class="grow" style="flex:1;min-width:0"><span style="font-weight:600">${esc(nameOf(b.product))}</span> <span class="ur-note">${H.hasQuality(data.products[b.product]) ? `Q${b.quality} · ` : ''}${esc(buildingName(b.type))}</span></span>
      <span style="font:600 18px var(--font-c)">${num(b.level)}</span></label>`).join('');
    const n = sel.size;
    const dis = n ? '' : 'disabled';
    return `${panelHead('Toplu düzenle', `${num(setup.buildings.length)} bina`)}
      <div class="ur-row"><span class="grow ur-note" style="font-weight:600">${num(n)} bina seçili</span><button type="button" class="ur-btn" data-act="bulkAll">${n === setup.buildings.length ? 'Seçimi kaldır' : 'Hepsini seç'}</button></div>
      <div>${list}</div>
      <div class="ur-field"><span>Seviye</span><div class="ur-row"><button type="button" class="ur-btn" data-act="bulkLevel" data-v="-1" ${dis}>−1</button><button type="button" class="ur-btn" data-act="bulkLevel" data-v="1" ${dis}>+1</button>
        <div class="grow"><input type="text" inputmode="numeric" data-d="bulkLevel" placeholder="Seviye" aria-label="Seçilenlerin seviyesi"></div><button type="button" class="ur-btn tint" data-act="bulkSetLevel" ${dis}>Ayarla</button></div></div>
      <div class="ur-field"><span>Robot (üretim binaları)</span><div class="ur-row"><button type="button" class="ur-btn grow" data-act="bulkRobot" data-v="1" ${dis}>Robot var</button><button type="button" class="ur-btn grow" data-act="bulkRobot" data-v="0" ${dis}>Robot yok</button></div></div>
      <div class="ur-field"><span>Ürün kalitesi</span><div class="ur-row"><div class="grow"><select data-d="bulkQ" aria-label="Seçilenlerin kalitesi">${H.allowedQualities(0).map((q) => `<option value="${q}">Q${q}</option>`).join('')}</select></div>
        <button type="button" class="ur-btn tint" data-act="bulkQuality" ${dis}>Ayarla</button></div></div>
      <button type="button" class="ur-btn danger" data-act="bulkDel" ${dis}>${icon('trash')}Seçilenleri sil</button>
      <div class="ur-panel-foot"><button type="button" class="ur-btn primary grow" data-act="sheetClose">Bitti</button></div>`;
  }
  function sheetReset() {
    return `${panelHead('Kurulum sıfırlansın mı?', `Realm ${r + 1}`)}
      <p class="ur-sub">${num(setup.buildings.length)} bina ve tüm ayarlar bu tarayıcıdan silinir. Yönetim sekmesindeki ekip ve nakit silinmez. Geri alınamaz.</p>
      <div class="ur-panel-foot"><button type="button" class="ur-btn grow" data-act="sheetClose">Vazgeç</button><button type="button" class="ur-btn primary grow" data-act="resetApply" style="background:var(--down);border-color:var(--down)">Sıfırla</button></div>`;
  }

  // ---- olaylar ----
  function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || !root.contains(btn)) return;
    const act = btn.dataset.act;
    const v = btn.dataset.v;
    if (act === 'sheetBackdrop') { if (ev.target === btn) closeSheet(); return; }
    if (act === 'retry') return load();
    if (!data) return;
    const set = (patch) => commit({ ...setup, ...patch });
    if (act === 'phase') return set({ economyPhase: Number(v) });
    if (act === 'refreshPrices') return refreshPrices();
    if (act === 'period') { period = v; try { localStorage.setItem(PERIOD_KEY, v); } catch { /* yok */ } return render(); }
    if (act === 'buyPolicy') return set({ buyPolicy: v });
    if (act === 'priceReset') { const prices = { ...setup.prices }; delete prices[v]; return set({ prices }); }
    if (act === 'contractReset') { const contractPrices = { ...setup.contractPrices }; delete contractPrices[v]; return set({ contractPrices }); }
    if (act === 'transportReset') return set({ transportPrice: null });
    if (act === 'keep') { const keep = { ...setup.keep }; if (keep[v]) delete keep[v]; else keep[v] = true; return set({ keep }); }
    if (act === 'copySummary') {
      const text = summaryText(evaluate());
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('Özet panoya kopyalandı.'), () => toast('Kopyalanamadı.'));
      else toast('Bu tarayıcı panoya kopyalamayı desteklemiyor.');
      return;
    }
    if (act === 'bulk') return openSheet('bulk', null, { sel: new Set(setup.buildings.map((_, i) => i)) });
    if (act.startsWith('rec.')) return set({ recreation: { ...setup.recreation, [act.slice(4)]: Number(v) } });
    if (act === 'substitution') return set({ substitution: setup.substitution === false });
    if (act === 'event') {
      const id = Number(v);
      const events = { ...setup.events };
      if (events[id] === false) delete events[id]; else events[id] = false;
      return set({ events });
    }
    if (act === 'export') return openSheet('export', null);
    if (act === 'import') return openSheet('import', null, { text: '' });
    if (act === 'reset') return openSheet('reset', null);
    if (act === 'resumeSheet') { location.hash = '#uretim/binalar'; return; }
    if (act === 'bNew') {
      clearParked();
      const last = setup.buildings[setup.buildings.length - 1];
      return openSheet('building', { id: uid('b'), type: last?.type || '', product: null, quality: 0, level: 1, robots: false, efficiency: 100 });
    }
    if (act === 'bEdit') { clearParked(); const i = Number(v); return openSheet('building', { ...setup.buildings[i] }, { index: i }); }
    if (act === 'bCopy') {
      const i = Number(v);
      const list = [...setup.buildings];
      list.splice(i + 1, 0, { ...setup.buildings[i], id: uid('b') });
      commit({ ...setup, buildings: list });
      return toast('Bina kopyalandı.');
    }
    if (act === 'bDel') {
      const i = Number(v);
      const gone = setup.buildings[i];
      commit({ ...setup, buildings: setup.buildings.filter((_, j) => j !== i) });
      return toast(`${nameOf(gone.product)} binası silindi.`);
    }
    if (act === 'quickAdd') {
      const product = Number(v);
      const p = data.products[product];
      commit({ ...setup, buildings: [...setup.buildings, { id: uid('b'), type: p.building, product, quality: Number(btn.dataset.q), level: Number(btn.dataset.l), robots: false, efficiency: 100 }] });
      return toast(`${nameOf(product)} için ${btn.dataset.l} seviye ${buildingName(p.building)} eklendi.`);
    }
    if (act === 'autoQuality') {
      const next = H.autoQuality(setup, data);
      const changed = next.buildings.filter((b, i) => b.quality !== setup.buildings[i].quality).length;
      commit(next);
      return toast(changed ? `${changed} binanın kalitesi girdisini kullanan binaya göre ayarlandı.` : 'Kaliteler zaten uygun.');
    }
    // panel içi
    if (act === 'sheetClose') return closeSheet();
    if (!sheet) return;
    if (sheet.kind === 'bulk') {
      const sel = sheet.sel;
      const apply = (fn) => commit({ ...setup, buildings: setup.buildings.map((b, i) => (sel.has(i) ? fn(b) : b)) });
      if (act === 'bulkAll') { sheet.sel = sel.size === setup.buildings.length ? new Set() : new Set(setup.buildings.map((_, i) => i)); return renderSheet(); }
      if (act === 'bulkLevel') return apply((b) => ({ ...b, level: Math.max(1, b.level + Number(v)) }));
      if (act === 'bulkSetLevel') {
        const n = parseNum(sheetHost.querySelector('[data-d="bulkLevel"]')?.value);
        if (!(n >= 1)) return toast('Seviye için 1 ya da üstü bir sayı girin.');
        return apply((b) => ({ ...b, level: Math.floor(n) }));
      }
      if (act === 'bulkRobot') return apply((b) => (H.buildingCategory(data, b.type) === 'production' ? { ...b, robots: v === '1' } : b));
      if (act === 'bulkQuality') { const q = Number(sheetHost.querySelector('[data-d="bulkQ"]')?.value || 0); return apply((b) => (H.hasQuality(data.products[b.product]) ? { ...b, quality: q } : b)); }
      if (act === 'bulkDel') {
        const count = sel.size;
        sheet.sel = new Set();
        commit({ ...setup, buildings: setup.buildings.filter((_, i) => !sel.has(i)) });
        if (!setup.buildings.length) closeSheet();
        return toast(`${count} bina silindi.`);
      }
      return;
    }
    const d = sheet.draft;
    if (act === 'dq') { d.quality = Number(v); return renderSheet(); }
    if (act === 'dLevel') { d.level = Math.max(1, (Number(d.level) || 1) + Number(v)); return renderSheet(); }
    if (act === 'dRobot') { d.robots = v === '1'; return renderSheet(); }
    if (act === 'gotoEvents') {
      parkSheet({ realm: r, draft: structuredClone(sheet.draft), index: sheet.index ?? null, scroll: sheetHost.querySelector('.ur-panel')?.scrollTop || 0 });
      closeSheet(); location.hash = '#uretim/kurulum'; setTimeout(() => document.getElementById('h-ev')?.scrollIntoView({ block: 'start' }), 50); return;
    }
    if (act === 'bSave') {
      if (!data.products[d.product]) return;
      if (!H.hasQuality(data.products[d.product])) d.quality = 0;
      const list = [...setup.buildings];
      if (sheet.index != null) list[sheet.index] = d; else list.push(d);
      const isNew = sheet.index == null;
      closeSheet();
      commit({ ...setup, buildings: list });
      return toast(isNew ? `${nameOf(d.product)} eklendi.` : 'Bina güncellendi.');
    }
    if (act === 'bDelSheet') { const i = sheet.index; closeSheet(); commit({ ...setup, buildings: setup.buildings.filter((_, j) => j !== i) }); return toast('Bina silindi.'); }
    if (act === 'copyExport') {
      const ta = sheetHost.querySelector('[data-d="exportText"]');
      const text = ta?.value || '';
      const done = () => toast('Kurulum panoya kopyalandı.');
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => { ta.select(); toast('Metni seçip kopyalayın.'); });
      else { ta.select(); toast('Metni seçip kopyalayın.'); }
      return;
    }
    if (act === 'importApply') {
      sheet.text = sheetHost.querySelector('[data-d="importText"]')?.value || '';
      try {
        const obj = JSON.parse(sheet.text);
        if (!obj || typeof obj !== 'object' || !Array.isArray(obj.buildings)) throw new Error('Bu bir DentSimco kurulum metni değil.');
        closeSheet();
        clearParked();
        commit(obj);
        return toast('Kurulum yüklendi.');
      } catch (e) {
        sheet.error = e instanceof SyntaxError ? 'Metin okunamadı. Kopyala ile aldığınız metnin tamamını yapıştırın.' : e.message;
        return renderSheet();
      }
    }
    if (act === 'resetApply') { closeSheet(); clearParked(); try { localStorage.removeItem(STORE_KEY(r)); } catch { /* yok */ } setup = defaultSetup(); render(); return toast('Kurulum sıfırlandı.'); }
  }

  function onChange(ev) {
    const t = ev.target;
    if (!data) return;
    if (t === typeTarget) { clearTimeout(typeTimer); typeTimer = null; typeTarget = null; }
    if (t.dataset?.bsel != null && sheet?.kind === 'bulk') {
      const i = Number(t.dataset.bsel);
      if (t.checked) sheet.sel.add(i); else sheet.sel.delete(i);
      return renderSheet();
    }
    if (t.dataset?.p) {
      const [kind, id, q] = t.dataset.p.split(':');
      const n = parseNum(t.value);
      const value = n == null || n < 0 ? null : n;
      if (kind === 'transport') return commit({ ...setup, transportPrice: value }, { soft: true });
      const key = `${id}:${q}`;
      const map = { ...(kind === 'contract' ? setup.contractPrices : setup.prices) };
      if (value == null) delete map[key]; else map[key] = value;
      return commit({ ...setup, [kind === 'contract' ? 'contractPrices' : 'prices']: map }, { soft: true });
    }
    if (t.dataset?.bq) {
      const buyQuality = { ...setup.buyQuality };
      if (t.value === '') delete buyQuality[t.dataset.bq]; else buyQuality[t.dataset.bq] = Number(t.value);
      return commit({ ...setup, buyQuality });
    }
    const f = t.dataset?.f;
    if (f) {
      const n = parseNum(t.value);
      const value = n == null ? 0 : Math.max(0, n);
      const soft = { soft: true };
      if (f === 'academyLevel') return commit({ ...setup, academyLevel: Math.floor(value) }, soft);
      if (f === 'extraBonusPct') return commit({ ...setup, extraBonusPct: Math.min(99, value) }, soft);
      if (f === 'finance.bankLevel') { // şirket kaydında durur; vergi eşiği için Yönetim de aynı değeri okur
        company = { ...company, finance: { ...company.finance, bankLevel: H.clampBankLevel(value) } };
        if (!Y.saveCompanyRecord(r, company)) toast('Tarayıcı kaydı açık değil; değişiklikler sayfa kapanınca kaybolur.');
        if (!silentSave) softRender();
        return;
      }
      return;
    }
    if (!sheet || !t.dataset?.d) return;
    const d = sheet.draft;
    const key = t.dataset.d;
    if (key === 'type') { d.type = t.value; d.product = null; d.robots = false; d.efficiency = 100; return renderSheet(); }
    if (key === 'product') { d.product = Number(t.value); if (!H.hasQuality(data.products[d.product])) d.quality = 0; return renderSheet(); }
    if (key === 'apiText' || key === 'importText') { sheet.text = t.value; return; }
    // Yazı kutuları: taslak ve sonuç kutusu güncellenir, panel yeniden çizilmez (dokunulan düğme kaybolmasın)
    if (updateDraftInput(t)) refreshResult();
  }
  function refreshResult() {
    const box = sheetHost.querySelector('[data-result]');
    if (box) if (sheet.kind === 'building') box.innerHTML = buildingResult();
  }
  function updateDraftInput(t) {
    const d = sheet.draft;
    const key = t.dataset.d;
    const n = parseNum(t.value);
    if (key === 'level') d.level = Math.max(1, Math.floor(n || 1));
    else if (key === 'efficiency') d.efficiency = Math.min(100, Math.max(0, n ?? 100));
    else if (key === 'name') d.name = t.value;
    else if (key === 'salary') d.salary = Math.max(0, n || 0);
    else if (key.startsWith('skill.')) d.skills = { ...d.skills, [key.slice(6)]: Math.max(0, Math.floor(n || 0)) };
    else return false;
    return true;
  }
  // Yazarken kaydet: sayı ya da fiyat yazılınca kısa gecikmeyle kaydedilir; kutudan çıkmak ya da sekme değiştirmek gerekmez.
  let typeTimer = null;
  let typeTarget = null;
  function flushTyping() {
    clearTimeout(typeTimer);
    typeTimer = null;
    const t = typeTarget;
    typeTarget = null;
    if (!t || !t.isConnected) return;
    silentSave = true;
    try { onChange({ target: t }); } finally { silentSave = false; }
  }
  // Yazarken yalnız sonuç kutusu yenilenir (klavye kapanmasın)
  function onInput(ev) {
    const t = ev.target;
    if ((t.dataset?.f || t.dataset?.p) && t.tagName === 'INPUT') {
      typeTarget = t;
      clearTimeout(typeTimer);
      typeTimer = setTimeout(flushTyping, 350);
      return;
    }
    if (sheet && (t.dataset?.d === 'apiText' || t.dataset?.d === 'importText')) { sheet.text = t.value; return; }
    if (!sheet || !t.dataset?.d || !['level', 'efficiency', 'salary', 'name'].includes(t.dataset.d) && !t.dataset.d.startsWith('skill.')) return;
    if (updateDraftInput(t)) refreshResult();
  }
  function onKey(ev) {
    if (ev.key === 'Escape' && sheet) { ev.preventDefault(); closeSheet(); }
    if (ev.key === 'Enter' && ev.target.matches?.('.ur input[data-f], .ur input[data-p], .ur-panel input[data-d]')) ev.target.blur();
  }
  function onHash() {
    const [key, sub] = location.hash.slice(1).split('/');
    if (key !== 'uretim') return;
    flushTyping();
    const next = TABS.some(([k]) => k === sub) ? sub : tab;
    if (next === tab) return;
    tab = next;
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* gizli sekme */ }
    closeSheet();
    render();
    window.scrollTo(0, 0);
    if (tab === 'binalar') resumeParked();
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  document.addEventListener('click', onAnyClick, true);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onHash);
  if (location.hash.split('/')[1] !== tab) history.replaceState(null, '', `#uretim/${tab}`);
  load();

  return {
    setRealm(next) {
      if (next === r) return;
      clearParked();
      closeSheet();
      r = next;
      company = Y.loadCompanyRecord(r).company;
      setup = loadSetup(r);
      load();
    },
    destroy() {
      flushTyping();
      destroyed = true;
      clearTimeout(toastTimer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      document.removeEventListener('click', onAnyClick, true);
      clearTimeout(settleTimer);
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onInput);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
      document.body.style.overflow = '';
      style.remove();
      root.replaceChildren();
    },
  };
}
