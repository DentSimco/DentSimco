// DentSimco — Üretim hesaplayıcı (arayüz)
// Hesapların hepsi hesap.js'te; burada yalnız ekranlar, veri yükleme ve tarayıcıda kayıt var.
// Aşama 2: Kurulum ve Binalar çalışıyor. Alım-Satım ve Özet Aşama 4'te gelecek.

import { readDocs, PATHS, dataField } from './veri.js';
import * as H from './hesap.js';

const STORE_KEY = (r) => `dentsimco.uretim.r${r}`;
const TAB_KEY = 'dentsimco.uretim.tab';
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
const POSITIONS = [['o', 'COO'], ['f', 'CFO'], ['m', 'CMO'], ['t', 'CTO'], ['v', 'COO stajyeri'], ['x', 'CFO stajyeri'],
  ['y', 'CMO stajyeri'], ['z', 'CTO stajyeri'], ['1', 'Personel']];
const positionName = (p) => (/^\d+$/.test(String(p)) ? 'Personel' : POSITIONS.find(([k]) => k === p)?.[1] || String(p || '?'));
const SKILL_LABELS = [['coo', 'Yönetim'], ['cfo', 'Muhasebe'], ['cmo', 'İletişim'], ['cto', 'Bilim']];
const REC = [['park', 'Park'], ['temple', 'Tapınak'], ['lake', 'Göl']];

// ---- biçimlendirme ----
const NF = [0, 1, 2, 3].map((d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fin = (x) => x != null && Number.isFinite(x);
const num = (x, d = 0) => (fin(x) ? NF[d].format(x) : '—');
const smart = (x) => (!fin(x) ? '—' : Math.abs(x) >= 100 ? NF[0].format(x) : Math.abs(x) >= 1 ? NF[2].format(x) : NF[3].format(x));
const perHour = (x) => (!fin(x) ? '—' : Math.abs(x) > 0 && Math.abs(x) < 0.01 ? NF[3].format(x) : NF[2].format(x)); // oyun gibi iki ondalık
const money = (x, d = 0, sign = false) => {
  if (!fin(x)) return '—';
  const s = `$${NF[d].format(Math.abs(x))}`;
  return x < 0 ? `−${s}` : sign && x > 0 ? `+${s}` : s;
};
const pctText = (fraction, d = 2) => (fin(fraction) ? `%${NF[d].format(fraction * 100)}` : '—');
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
    v: 1, buildings: [], recreation: { park: 0, temple: 0, lake: 0 }, economyPhase: 0,
    academyLevel: 0, otherLevels: 0, otherWagesDay: 0,
    admin: { mode: 'savings', savingsPct: 0, netPct: 0 }, executives: [], events: {},
    substitution: true, buyPolicy: 'cheapest',
  };
}
function sanitizeSetup(raw) {
  const base = defaultSetup();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  s.recreation = { ...base.recreation, ...(raw.recreation || {}) };
  s.admin = { ...base.admin, ...(raw.admin || {}) };
  s.events = { ...(raw.events || {}) };
  s.buildings = (Array.isArray(raw.buildings) ? raw.buildings : []).filter((b) => b && typeof b === 'object')
    .map((b) => ({ id: b.id || uid('b'), type: b.type, product: b.product != null ? Number(b.product) : null, level: Math.max(1, Math.floor(Number(b.level) || 1)),
      quality: H.clampQuality(b.quality), robots: !!b.robots, efficiency: Number.isFinite(Number(b.efficiency)) ? Number(b.efficiency) : 100 }));
  s.executives = (Array.isArray(raw.executives) ? raw.executives : []).filter((e) => e && typeof e === 'object')
    .map((e) => ({ id: e.id || uid('e'), name: String(e.name || ''), position: String(e.position || 'o'), salary: Number(e.salary) || 0,
      skills: Object.fromEntries(H.SKILLS.map((k) => [k, Number(e.skills?.[k]) || 0])), active: e.active !== false }));
  if (![0, 1, 2].includes(Number(s.economyPhase))) s.economyPhase = 0;
  s.economyPhase = Number(s.economyPhase);
  return s;
}
function loadSetup(r) {
  try { return sanitizeSetup(JSON.parse(localStorage.getItem(STORE_KEY(r)) || 'null')); } catch { return defaultSetup(); }
}
function saveSetup(r, setup) {
  try { localStorage.setItem(STORE_KEY(r), JSON.stringify(setup)); return true; } catch { return false; }
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
const CSS = `
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
  let setup = loadSetup(r);
  let data = null;
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
  function commit(next, { quiet = false, soft = false } = {}) {
    setup = sanitizeSetup(next);
    if (!saveSetup(r, setup) && !quiet) toast('Tarayıcı kaydı açık değil; değişiklikler sayfa kapanınca kaybolur.');
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
      const d = await loadData(r);
      if (destroyed || my !== loadToken) return;
      data = d;
    } catch (e) {
      if (destroyed || my !== loadToken) return;
      loadError = e?.message || String(e);
    }
    render();
  }

  // ---- hesap ----
  const evaluate = (s = setup) => H.evaluatePlan(s, data, null, { now: now() });

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
      const plan = evaluate();
      body = tab === 'kurulum' ? viewKurulum(plan) : tab === 'binalar' ? viewBinalar(plan) : viewSoon(tab);
    }
    const scroll = window.scrollY;
    view.innerHTML = tabs + body;
    window.scrollTo(0, scroll);
    if (sheet) renderSheet();
  }

  function viewSoon(which) {
    const text = which === 'alimsatim'
      ? 'Alışlar, satışlar, taşıma ve fiyatlar burada olacak. Fiyatlar borsadan gelecek, her biri elle değiştirilebilecek.'
      : 'Günlük gelir tablosu, borsa ve kontrat kârı, maliyet dağılımı ve yöneticilerin getirisi burada olacak.';
    return `<div class="ur-card ur-empty"><h2>${which === 'alimsatim' ? 'Alım-Satım' : 'Özet'} yakında</h2><p class="ur-sub">${text}</p>
      <p class="ur-note">Şimdilik Kurulum ve Binalar çalışıyor.</p></div>`;
  }

  // ---- KURULUM ----
  function viewKurulum(plan) {
    const a = plan.admin;
    const planLevels = (setup.buildings || []).reduce((t, b) => t + (b.level || 0), 0);
    const recBonus = H.recreationBonus(setup.recreation);
    const mode = setup.admin.mode;
    const modeField = mode === 'net'
      ? field('Net yönetim gideri', 'admin.netPct', num(setup.admin.netPct, 2), { unit: '%', hint: 'Oyunun üretim hesaplayıcısında yazan yüzde.' })
      : mode === 'executives'
        ? `<div class="ur-box">${kv('Ekip puanından tasarruf', `≈ %${H.managementSavingsPct(H.teamScores(setup.executives).coo)}`, 'c-price', true)}<p class="ur-note">Yöneticiler kartındaki aktif yöneticilerden hesaplanır. Yaklaşıktır (±1 puan).</p></div>`
        : field('Yönetici tasarrufu', 'admin.savingsPct', num(setup.admin.savingsPct, fin(setup.admin.savingsPct) && setup.admin.savingsPct % 1 ? 2 : 0), { unit: '%', hint: 'Oyunun yönetim sayfasında: tasarruf ÷ yönetim gideri (örneğin 118,53 ÷ 191,18 = %62).' });
    return `
      <div class="ur-head"><div><h1>Realm ${r} kurulumu</h1><p class="ur-sub">Bu tarayıcıda saklanır.</p></div>
        <div class="ur-row"><button type="button" class="ur-btn" data-act="export">${icon('copy')}Kopyala</button><button type="button" class="ur-btn" data-act="import">Yapıştır</button></div></div>

      <section class="ur-card" aria-labelledby="h-faz"><h2 id="h-faz">Ekonomi fazı</h2>
        <p class="ur-sub">Oyundaki güncel fazı seçin. Faz binaların saatlik üretimini değiştirir, maaşı değiştirmez. Durgunlukta üretim en yüksek, Büyümede en düşüktür.</p>
        ${seg('phase', H.ECONOMY_PHASES.map((t, i) => [i, t]), setup.economyPhase, 'Ekonomi fazı')}</section>

      <section class="ur-card" aria-labelledby="h-rec"><h2 id="h-rec">Rekreasyon binaları</h2>
        <p class="ur-sub">Seviye başına %1 üretim hızı (üretim ve araştırma binaları). Yönetim giderine girmez.</p>
        ${REC.map(([k, t]) => `<div class="ur-row"><span style="min-width:78px;font-weight:600">${t}</span><div class="grow">${seg(`rec.${k}`, [[0, '0'], [1, '1'], [2, '2'], [3, '3']], setup.recreation[k] || 0, `${t} seviyesi`)}</div></div>`).join('')}
        <div class="ur-hr"></div>${kv('Üretim hızı bonusu', pctText(recBonus, 0), 'c-price', true)}</section>

      <section class="ur-card" aria-labelledby="h-admin"><h2 id="h-admin">Yönetim gideri</h2>
        ${seg('adminMode', [['savings', 'Tasarruf %'], ['net', 'Net oran %'], ['executives', 'Ekipten']], mode, 'Yönetim gideri girişi')}
        ${field('Akademi seviyesi', 'academyLevel', num(setup.academyLevel), { mode: 'numeric' })}
        ${field('Planda olmayan binaların toplam seviyesi', 'otherLevels', num(setup.otherLevels), { mode: 'numeric', hint: 'Planda göstermediğiniz üretim, satış, araştırma ve sezonluk binalar. Rekreasyon binaları sayılmaz.' })}
        ${field('Planda olmayan binaların günlük maaşı', 'otherWagesDay', num(setup.otherWagesDay), { unit: '$', mode: 'numeric', hint: 'Bu binaların oyundaki "Maaşlar ($/sa)" toplamı × 24. Yalnızca yöneticilerin tüm şirkete getirisini göstermek içindir, plandaki kârı değiştirmez.' })}
        ${modeField}
        <div class="ur-hr"></div>
        ${kv('Plandaki binalar', num(planLevels))}${kv('Akademi', num(setup.academyLevel))}${kv('Planda olmayan binalar', num(setup.otherLevels))}
        ${kv('Toplam bina seviyesi', num(a.totalLevels), '', true)}
        <div class="ur-hr"></div>
        ${kv('Brüt yönetim gideri', pctText(a.gross))}${kv('Yönetici tasarrufu', pctText(a.savings, a.savings * 100 % 1 ? 2 : 0))}
        ${kv('Net yönetim gideri', pctText(a.net), 'c-price', true)}</section>

      ${cardExecutives(plan)}
      ${cardEvents()}

      <section class="ur-card" aria-labelledby="h-gen"><h2 id="h-gen">Genel</h2>
        <div class="ur-row"><div class="grow"><div style="font-size:17px;font-weight:600">Kalite ikamesi</div><p class="ur-sub">Yüksek kalite fazlası, aynı ürünün düşük kalite ihtiyacını karşılar.</p></div>
          ${sw('substitution', setup.substitution !== false, 'Kalite ikamesi')}</div>
        <div class="ur-hr"></div>
        <button type="button" class="ur-btn danger" data-act="reset">${icon('trash')}Bu kurulumu sıfırla</button>
        <p class="ur-note">Realm ${r} kurulumunu bu tarayıcıdan siler. Önce Kopyala ile yedek alabilirsiniz.</p></section>`;
  }

  function cardExecutives(plan) {
    const ex = setup.executives || [];
    const scores = H.teamScores(ex);
    const rows = ex.map((e, i) => `
      <div class="ur-line" style="flex-wrap:wrap">
        <div class="grow" style="min-width:150px"><div class="title ${e.active ? '' : 'c-muted'}">${esc(e.name || positionName(e.position))}</div>
          <div class="ur-chips" style="margin-top:4px">${chip(positionName(e.position), e.active ? '' : 'muted')}<span class="ur-note" style="align-self:center">${money(e.salary)}/gün</span></div></div>
        <div class="ur-row" style="flex:1 1 200px">${`<div class="grow">${seg(`execActive.${i}`, [['1', 'Aktif'], ['0', 'Eğitimde']], e.active ? '1' : '0', `${e.name || positionName(e.position)} durumu`)}</div>`}
          <button type="button" class="ur-btn" data-act="execEdit" data-v="${i}" aria-label="${esc(e.name || positionName(e.position))} düzenle">${icon('edit')}</button></div>
      </div>`).join('');
    let summary = '';
    if (ex.length) {
      const inPlan = H.executiveAnalysis(setup, data, plan);
      const company = H.executiveAnalysis(setup, data, plan, { scope: 'company' });
      const pending = inPlan.members.filter((m) => !m.active && m.ifActiveValueDay > 0);
      summary = `<div class="ur-box">
        <span class="ur-note" style="font-weight:600">Bu plandaki binalar için, günlük</span>
        ${kv('Yöneticilerin kazandırdığı', money(inPlan.teamValueDay))}${kv('Yönetici maaşları', money(inPlan.salariesDay))}
        ${kv('Net getiri', money(inPlan.teamNetDay, 0, true), inPlan.teamNetDay >= 0 ? 'c-up' : 'c-down', true)}
        ${setup.otherWagesDay > 0 ? `<div class="ur-hr"></div><span class="ur-note" style="font-weight:600">Tüm şirket için, günlük</span>
          ${kv('Yöneticilerin kazandırdığı', money(company.teamValueDay))}${kv('Net getiri', money(company.teamNetDay, 0, true), company.teamNetDay >= 0 ? 'c-up' : 'c-down', true)}` : ''}
        ${pending.length ? `<p class="ur-note" style="margin-top:6px">Eğitimdekiler göreve başlayınca yaklaşık ${pending.map((m) => `${esc(m.name || positionName(m.position))} +${money(m.ifActiveValueDay)}`).join(', ')} /gün daha.</p>` : ''}
        ${!setup.otherWagesDay ? '<p class="ur-note" style="margin-top:6px">Tüm şirket için Yönetim gideri kartına planda olmayan binaların günlük maaşını girin.</p>' : ''}
      </div>`;
    }
    const scoreBox = ex.length ? `<div class="ur-box"><span class="ur-note" style="font-weight:600">Ekip puanı (yalnızca aktif olanlar)</span>
      <div class="ur-grid4" style="margin-top:6px">${SKILL_LABELS.map(([k, t]) => `<div class="ur-stat"><span>${t}</span><span>${num(scores[k], scores[k] % 1 ? 2 : 0)}</span></div>`).join('')}</div>
      <div class="ur-hr" style="margin:8px 0 4px"></div>${kv('Yönetim puanından tasarruf', `≈ %${H.managementSavingsPct(scores.coo)}`, 'c-price', true)}</div>` : '';
    return `<section class="ur-card" aria-labelledby="h-exec"><h2 id="h-exec">Yöneticiler</h2>
      <p class="ur-sub">Her yöneticinin becerisi ve günlük maaşı ayrı girilir. Eğitimde, yerleşmekte ya da grevde olanlar etki etmez, maaşları yine ödenir.</p>
      <div class="ur-row"><button type="button" class="ur-btn tint grow" data-act="execApi">${icon('plus')}API'den yapıştır</button><button type="button" class="ur-btn grow" data-act="execNew">${icon('plus')}Elle ekle</button></div>
      ${ex.length ? `<div>${rows}</div>` : '<p class="ur-note">Henüz yönetici yok.</p>'}
      ${scoreBox}${summary}</section>`;
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
      ${list.length ? `<div>${rows}</div>` : '<p class="ur-note">Şu an etkin oyun olayı yok.</p>'}</section>`;
  }

  // ---- BİNALAR ----
  function viewBinalar(plan) {
    const rows = plan.rows;
    const levels = rows.reduce((t, x) => t + (x.level || 0), 0);
    const cards = (setup.buildings || []).map((b, i) => buildingCard(b, rows[i], i)).join('');
    const empty = `<div class="ur-card ur-empty"><h2>Henüz bina yok</h2><p class="ur-sub">Bina ekleyin: tür, ürün, kalite ve seviye seçin. Eksik girdiler aşağıda listelenir ve tek dokunuşla eklenir.</p></div>`;
    return `
      <div class="ur-stats">
        <div class="ur-stat"><span>Bina</span><span>${num(rows.length)}</span></div>
        <div class="ur-stat"><span>Plan seviyesi</span><span>${num(levels)}</span></div>
        <div class="ur-stat"><span>Maaş/gün</span><span>${money(plan.totals.wagesDayNet)}</span></div></div>
      <div class="ur-row" style="flex-wrap:wrap"><button type="button" class="ur-btn primary grow" data-act="bNew" style="flex-basis:100%">${icon('plus')}Bina ekle</button>
        ${rows.length > 1 ? '<button type="button" class="ur-btn grow" data-act="autoQuality">Otomatik kalite</button>' : ''}</div>
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
        <div class="grow"><div class="ur-row" style="flex-wrap:wrap;gap:6px"><span style="font:600 19px var(--font-c)">${title}</span>${chip(`Q${b.quality}`)}</div>
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
      return `<div class="ur-line" style="flex-wrap:wrap"><div class="grow"><div class="ur-row" style="gap:6px"><span class="title">${esc(nameOf(pool.product))}</span>${chip(`Q${pool.quality}`)}</div>
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
    const focusKey = document.activeElement?.closest?.('.ur-panel') ? document.activeElement.getAttribute('data-d') || document.activeElement.getAttribute('data-act') : null;
    const html = sheet.kind === 'building' ? sheetBuilding() : sheet.kind === 'exec' ? sheetExec() : sheet.kind === 'api' ? sheetApi()
      : sheet.kind === 'export' ? sheetExport() : sheet.kind === 'import' ? sheetImport() : sheet.kind === 'reset' ? sheetReset() : '';
    sheetHost.innerHTML = `<div class="ur-sheet ur" style="padding:0;max-width:none;margin:0" data-act="sheetBackdrop"><div class="ur-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${html}</div></div>`;
    document.body.style.overflow = 'hidden';
    if (first) sheetHost.querySelector('.ur-panel select, .ur-panel input, .ur-panel textarea, .ur-panel button')?.focus();
    else if (focusKey) sheetHost.querySelector(`[data-d="${focusKey}"], [data-act="${focusKey}"]`)?.focus();
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
    return { ...setup, buildings: list };
  }
  function buildingResult() {
    const d = sheet.draft;
    const p = data.products[d.product];
    if (!p) return '<p class="ur-note">Sonucu görmek için ürün seçin.</p>';
    const ds = draftSetup();
    const admin = H.adminInfo(ds, data);
    const row = H.buildingRate(d, ds, data, admin, now());
    if (!row.ok) return `<div class="ur-msg err">${esc(row.errors.join('. '))}</div>`;
    const minQ = H.minInputQuality(d.quality);
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
      ${p ? `<div class="ur-field"><span>Ürün kalitesi</span><div class="ur-q" role="group" aria-label="Ürün kalitesi">${H.allowedQualities(0).map((q) => `<button type="button" data-act="dq" data-v="${q}" aria-pressed="${d.quality === q}">Q${q}</button>`).join('')}</div></div>
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

  // Yönetici paneli
  function execResult() {
    const d = sheet.draft;
    const list = [...setup.executives];
    const idx = sheet.index != null ? sheet.index : list.length;
    list[idx] = d;
    const s = { ...setup, executives: list };
    const plan = evaluate(s);
    const a = H.executiveAnalysis(s, data, plan);
    const m = a.members[idx];
    const w = (k) => H.skillWeight(d.position, k) * (Number(d.skills?.[k]) || 0);
    const contrib = SKILL_LABELS.map(([k, t]) => kv(`${t} puanına katkı`, `+${num(w(k), w(k) % 1 ? 2 : 0)}`)).join('');
    const value = d.active ? m.valueDay : m.ifActiveValueDay;
    return `<div class="ur-box"><span class="ur-note" style="font-weight:600">${d.active ? 'Bu yönetici için (bu plandaki binalar)' : 'Göreve başlarsa (bu plandaki binalar)'}</span>
      ${contrib}<div class="ur-hr"></div>
      ${kv('Maaşlarda günlük tasarruf', money(value || 0))}${kv('Günlük maaşı', money(d.salary))}
      ${kv('Net', money((value || 0) - d.salary, 0, true), (value || 0) - d.salary >= 0 ? 'c-up' : 'c-down', true)}
      <p class="ur-note">Yalnız yönetimin maaşa etkisi paraya çevrilir; muhasebe, iletişim ve bilim etkileri dahil değil. Yaklaşıktır.</p></div>`;
  }
  function sheetExec() {
    const d = sheet.draft;
    return `${panelHead(sheet.index != null ? 'Yönetici düzenle' : 'Yönetici ekle', 'Elle giriş')}
      <div class="ur-field"><span>Pozisyon</span><div class="ur-pos" role="group" aria-label="Pozisyon">${POSITIONS.map(([k, t]) => `<button type="button" data-act="dPos" data-v="${k}" aria-pressed="${(k === '1' ? /^\d+$/.test(d.position) : d.position === k)}">${t}</button>`).join('')}</div></div>
      <label class="ur-field"><span>İsim (isteğe bağlı)</span><input type="text" data-d="name" value="${esc(d.name)}" placeholder="İsim yazmadan da ekleyebilirsiniz" autocomplete="off"></label>
      <div class="ur-field"><span>Beceriler</span><div class="ur-grid2">${SKILL_LABELS.map(([k, t]) => `<label class="ur-field"><span style="font-size:13px">${t}</span><input type="text" inputmode="numeric" data-d="skill.${k}" value="${esc(num(d.skills[k]))}"></label>`).join('')}</div></div>
      <label class="ur-field"><span>Günlük maaş</span><div class="ur-input"><i>$</i><input type="text" inputmode="numeric" data-d="salary" value="${esc(num(d.salary))}"></div></label>
      <div class="ur-field"><span>Durum</span>${seg('dActive', [['1', 'Aktif'], ['0', 'Eğitimde']], d.active ? '1' : '0', 'Durum')}<p class="ur-note">Eğitimde, yerleşmekte ya da grevde olan yönetici etki etmez, maaşı yine ödenir.</p></div>
      <div data-result>${execResult()}</div>
      <div class="ur-panel-foot">${sheet.index != null ? `<button type="button" class="ur-btn danger" data-act="execDel" aria-label="Yöneticiyi sil">${icon('trash')}</button>` : ''}
        <button type="button" class="ur-btn grow" data-act="sheetClose">Vazgeç</button><button type="button" class="ur-btn primary grow" data-act="execSave">${sheet.index != null ? 'Kaydet' : 'Ekle'}</button></div>`;
  }
  function sheetApi() {
    const parsed = sheet.parsed;
    return `${panelHead('Yöneticileri yapıştır', 'Oyunun yönetici listesi')}
      <p class="ur-sub">Oyuna girişliyken <b>simcompanies.com/api/v3/companies/ŞİRKET_NO/executives/</b> adresini açın, sayfadaki metnin tamamını kopyalayıp buraya yapıştırın. Beceri ve maaş yalnız kendi şirketinizin çıktısında bulunur.</p>
      <label class="ur-field"><span>API çıktısı</span><textarea data-d="apiText" spellcheck="false" autocapitalize="off">${esc(sheet.text || '')}</textarea></label>
      ${sheet.error ? `<div class="ur-msg err" role="alert">${esc(sheet.error)}</div>` : ''}
      ${parsed ? `<div class="ur-box">${kv('Bulunan yönetici', num(parsed.length))}${kv('Becerisi olan', num(parsed.filter((e) => e.skillsKnown).length))}${kv('Eğitimde ya da grevde', num(parsed.filter((e) => !e.active).length))}
        <p class="ur-note">Mevcut ${num(setup.executives.length)} yöneticinin yerine geçer.</p></div>` : ''}
      <div class="ur-panel-foot"><button type="button" class="ur-btn grow" data-act="sheetClose">Vazgeç</button>
        ${parsed ? '<button type="button" class="ur-btn primary grow" data-act="apiApply">Listeyi değiştir</button>' : '<button type="button" class="ur-btn primary grow" data-act="apiRead">Oku</button>'}</div>`;
  }
  function sheetExport() {
    return `${panelHead('Kurulumu kopyala', `Realm ${r}`)}
      <p class="ur-sub">Bu metni başka bir cihazda Kurulum › Yapıştır ile yükleyin.</p>
      <textarea readonly data-d="exportText" aria-label="Kurulum metni">${esc(JSON.stringify(setup))}</textarea>
      <div class="ur-panel-foot"><button type="button" class="ur-btn grow" data-act="sheetClose">Kapat</button><button type="button" class="ur-btn primary grow" data-act="copyExport">${icon('copy')}Panoya kopyala</button></div>`;
  }
  function sheetImport() {
    return `${panelHead('Kurulumu yapıştır', `Realm ${r}`)}
      <p class="ur-sub">Başka bir cihazda Kopyala ile aldığınız metni yapıştırın. Bu realm'in mevcut kurulumunun yerine geçer.</p>
      <textarea data-d="importText" spellcheck="false" autocapitalize="off" aria-label="Kurulum metni">${esc(sheet.text || '')}</textarea>
      ${sheet.error ? `<div class="ur-msg err" role="alert">${esc(sheet.error)}</div>` : ''}
      <div class="ur-panel-foot"><button type="button" class="ur-btn grow" data-act="sheetClose">Vazgeç</button><button type="button" class="ur-btn primary grow" data-act="importApply">Yükle</button></div>`;
  }
  function sheetReset() {
    return `${panelHead('Kurulum sıfırlansın mı?', `Realm ${r}`)}
      <p class="ur-sub">${num(setup.buildings.length)} bina, ${num(setup.executives.length)} yönetici ve tüm ayarlar bu tarayıcıdan silinir. Geri alınamaz.</p>
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
    if (act.startsWith('rec.')) return set({ recreation: { ...setup.recreation, [act.slice(4)]: Number(v) } });
    if (act === 'adminMode') return set({ admin: { ...setup.admin, mode: v } });
    if (act === 'substitution') return set({ substitution: setup.substitution === false });
    if (act === 'event') {
      const id = Number(v);
      const events = { ...setup.events };
      if (events[id] === false) delete events[id]; else events[id] = false;
      return set({ events });
    }
    if (act.startsWith('execActive.')) {
      const i = Number(act.split('.')[1]);
      const executives = setup.executives.map((e, j) => (j === i ? { ...e, active: v === '1' } : e));
      return set({ executives });
    }
    if (act === 'execNew') return openSheet('exec', { id: uid('e'), name: '', position: 'o', salary: 0, skills: { coo: 0, cfo: 0, cmo: 0, cto: 0 }, active: true });
    if (act === 'execEdit') { const i = Number(v); return openSheet('exec', structuredClone(setup.executives[i]), { index: i }); }
    if (act === 'execApi') return openSheet('api', null, { text: '' });
    if (act === 'export') return openSheet('export', null);
    if (act === 'import') return openSheet('import', null, { text: '' });
    if (act === 'reset') return openSheet('reset', null);
    if (act === 'bNew') {
      const last = setup.buildings[setup.buildings.length - 1];
      return openSheet('building', { id: uid('b'), type: last?.type || '', product: null, quality: 0, level: 1, robots: false, efficiency: 100 });
    }
    if (act === 'bEdit') { const i = Number(v); return openSheet('building', { ...setup.buildings[i] }, { index: i }); }
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
    const d = sheet.draft;
    if (act === 'dq') { d.quality = Number(v); return renderSheet(); }
    if (act === 'dLevel') { d.level = Math.max(1, (Number(d.level) || 1) + Number(v)); return renderSheet(); }
    if (act === 'dRobot') { d.robots = v === '1'; return renderSheet(); }
    if (act === 'gotoEvents') { closeSheet(); location.hash = '#uretim/kurulum'; setTimeout(() => document.getElementById('h-ev')?.scrollIntoView({ block: 'start' }), 50); return; }
    if (act === 'bSave') {
      if (!data.products[d.product]) return;
      const list = [...setup.buildings];
      if (sheet.index != null) list[sheet.index] = d; else list.push(d);
      const isNew = sheet.index == null;
      closeSheet();
      commit({ ...setup, buildings: list });
      return toast(isNew ? `${nameOf(d.product)} eklendi.` : 'Bina güncellendi.');
    }
    if (act === 'bDelSheet') { const i = sheet.index; closeSheet(); commit({ ...setup, buildings: setup.buildings.filter((_, j) => j !== i) }); return toast('Bina silindi.'); }
    if (act === 'dPos') { d.position = v; return renderSheet(); }
    if (act === 'dActive') { d.active = v === '1'; return renderSheet(); }
    if (act === 'execSave') {
      const list = [...setup.executives];
      if (sheet.index != null) list[sheet.index] = d; else list.push(d);
      closeSheet();
      return commit({ ...setup, executives: list });
    }
    if (act === 'execDel') { const i = sheet.index; closeSheet(); return commit({ ...setup, executives: setup.executives.filter((_, j) => j !== i) }); }
    if (act === 'apiRead') {
      sheet.text = sheetHost.querySelector('[data-d="apiText"]')?.value || '';
      try {
        const list = H.parseExecutives(sheet.text, now());
        if (!list.length) throw new Error('Listede yönetici bulunamadı.');
        sheet.parsed = list;
        sheet.error = null;
      } catch (e) {
        sheet.parsed = null;
        sheet.error = e instanceof SyntaxError ? 'Metin okunamadı. Sayfadaki metnin tamamını, başından sonuna kopyaladığınızdan emin olun.' : e.message;
      }
      return renderSheet();
    }
    if (act === 'apiApply') {
      const list = sheet.parsed.map((e) => ({ id: uid('e'), name: e.name, position: e.position, salary: e.salary, skills: e.skills, active: e.active }));
      closeSheet();
      commit({ ...setup, executives: list });
      return toast(`${list.length} yönetici yüklendi.`);
    }
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
        commit(obj);
        return toast('Kurulum yüklendi.');
      } catch (e) {
        sheet.error = e instanceof SyntaxError ? 'Metin okunamadı. Kopyala ile aldığınız metnin tamamını yapıştırın.' : e.message;
        return renderSheet();
      }
    }
    if (act === 'resetApply') { closeSheet(); try { localStorage.removeItem(STORE_KEY(r)); } catch { /* yok */ } setup = defaultSetup(); render(); return toast('Kurulum sıfırlandı.'); }
  }

  function onChange(ev) {
    const t = ev.target;
    if (!data) return;
    const f = t.dataset?.f;
    if (f) {
      const n = parseNum(t.value);
      const value = n == null ? 0 : Math.max(0, n);
      const soft = { soft: true };
      if (f === 'admin.savingsPct') return commit({ ...setup, admin: { ...setup.admin, savingsPct: Math.min(100, value) } }, soft);
      if (f === 'admin.netPct') return commit({ ...setup, admin: { ...setup.admin, netPct: value } }, soft);
      if (f === 'academyLevel' || f === 'otherLevels') return commit({ ...setup, [f]: Math.floor(value) }, soft);
      if (f === 'otherWagesDay') return commit({ ...setup, otherWagesDay: value }, soft);
      return;
    }
    if (!sheet || !t.dataset?.d) return;
    const d = sheet.draft;
    const key = t.dataset.d;
    if (key === 'type') { d.type = t.value; d.product = null; d.robots = false; d.efficiency = 100; return renderSheet(); }
    if (key === 'product') { d.product = Number(t.value); return renderSheet(); }
    if (key === 'apiText' || key === 'importText') { sheet.text = t.value; return; }
    // Yazı kutuları: taslak ve sonuç kutusu güncellenir, panel yeniden çizilmez (dokunulan düğme kaybolmasın)
    if (updateDraftInput(t)) refreshResult();
  }
  function refreshResult() {
    const box = sheetHost.querySelector('[data-result]');
    if (box) box.innerHTML = sheet.kind === 'building' ? buildingResult() : execResult();
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
  // Yazarken yalnız sonuç kutusu yenilenir (klavye kapanmasın)
  function onInput(ev) {
    const t = ev.target;
    if (sheet && (t.dataset?.d === 'apiText' || t.dataset?.d === 'importText')) { sheet.text = t.value; return; }
    if (!sheet || !t.dataset?.d || !['level', 'efficiency', 'salary', 'name'].includes(t.dataset.d) && !t.dataset.d.startsWith('skill.')) return;
    if (updateDraftInput(t)) refreshResult();
  }
  function onKey(ev) {
    if (ev.key === 'Escape' && sheet) { ev.preventDefault(); closeSheet(); }
    if (ev.key === 'Enter' && ev.target.matches?.('.ur input[data-f], .ur-panel input[data-d]')) ev.target.blur();
  }
  function onHash() {
    const [key, sub] = location.hash.slice(1).split('/');
    if (key !== 'uretim') return;
    const next = TABS.some(([k]) => k === sub) ? sub : tab;
    if (next === tab) return;
    tab = next;
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* gizli sekme */ }
    closeSheet();
    render();
    window.scrollTo(0, 0);
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
      closeSheet();
      r = next;
      setup = loadSetup(r);
      load();
    },
    destroy() {
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
