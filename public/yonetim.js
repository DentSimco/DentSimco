// DentSimco — Yönetim (yönetici simülasyonu, arayüz)
// Hesapların hepsi yonetici.js ve hesap.js'te; burada ekranlar, fiyat okuma ve tarayıcıda kayıt var.
// Bölümler: Özet (kim ne kazandırıyor), Yöneticiler (giriş), Araştırma (kalite planı ve araştırma üretimi), Şirket (girdiler).
// Şirket kaydı (dentsimco.sirket.r{realm}) ileride Üretim ve Perakende tarafından da okunacak; yöneticiler yalnız burada girilir.

import { readDocs, PATHS, dataField, loadProduct, summarizeDay, utcDay, addDays } from './veri.js';
import * as H from './hesap.js';
import * as Y from './yonetici.js';
import { CSS, parseNum } from './uretim.js';

const STORE_KEY = (r) => `dentsimco.sirket.r${r}`;
const URETIM_KEY = (r) => `dentsimco.uretim.r${r}`;
const TAB_KEY = 'dentsimco.yonetim.tab';
const TABS = [['ozet', 'Özet'], ['ekip', 'Ekip'], ['arastirma', 'Araştırma'], ['sirket', 'Şirket']];
const POSITIONS = [['o', 'COO'], ['f', 'CFO'], ['m', 'CMO'], ['t', 'CTO'], ['v', 'COO stajyeri'], ['x', 'CFO stajyeri'],
  ['y', 'CMO stajyeri'], ['z', 'CTO stajyeri'], ['1', 'Personel']];
const positionName = (p) => (/^\d+$/.test(String(p)) ? 'Personel' : POSITIONS.find(([k]) => k === p)?.[1] || String(p || '?'));
const SKILL_LABELS = [['coo', 'Yönetim'], ['cfo', 'Muhasebe'], ['cmo', 'İletişim'], ['cto', 'Bilim']];
const SECTOR_LABELS = [['coo', 'Yönetim', 'maaş tasarrufu'], ['cfo', 'Muhasebe', 'ödenmeyen vergi'], ['cmo', 'İletişim', 'perakende satış'], ['cto', 'Bilim', 'araştırma üretimi']];

const NF = [0, 1, 2, 3, 4].map((d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fin = (x) => x != null && Number.isFinite(x);
const num = (x, d = 0) => (fin(x) ? NF[d].format(x) : '—');
const dec = (x) => (!fin(x) ? '—' : Math.abs(x) >= 100 ? NF[0].format(x) : NF[x % 1 ? 2 : 0].format(x));
const money = (x, d = 0, sign = false) => {
  if (!fin(x)) return '—';
  const s = `$${NF[d].format(Math.abs(x))}`;
  return x < 0 ? `−${s}` : sign && x > 0 ? `+${s}` : s;
};
const price = (x) => (!fin(x) ? '—' : money(x, Math.abs(x) < 1000 ? 2 : 0));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (x) => (x > 0 ? 'c-up' : x < 0 ? 'c-down' : '');
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>', refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const kv = (label, value, c = '', strong = false) => `<div class="ur-kv${strong ? ' strong' : ''}"><span>${label}</span><span class="${c}">${value}</span></div>`;
const seg = (act, options, value, label) => `<div class="ur-seg" role="group" aria-label="${esc(label)}">${options.map(([v, t]) =>
  `<button type="button" data-act="${act}" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(t)}</button>`).join('')}</div>`;
const chip = (text, kind = '') => `<span class="ur-chip ${kind}">${esc(text)}</span>`;
function field(label, name, value, { unit = '', hint = '', mode = 'decimal', attr = 'data-f', placeholder = '' } = {}) {
  return `<label class="ur-field"><span>${esc(label)}</span><div class="ur-input">${unit === '$' ? '<i>$</i>' : ''}<input type="text" inputmode="${mode}" autocomplete="off" ${attr}="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}">${unit && unit !== '$' ? `<i>${esc(unit)}</i>` : ''}</div>${hint ? `<p class="ur-note">${hint}</p>` : ''}</label>`;
}
const inVal = (x) => (fin(x) && x !== 0 ? dec(x) : '');

const EXTRA_CSS = `
.yo-member { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.yo-member:last-child { border-bottom: 0; }
.yo-member .top { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.yo-member .name { font-size: 16px; font-weight: 600; }
.yo-member .net { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.yo-parts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 12px; }
.yo-parts > div { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; }
.yo-parts > div > span:first-child { color: var(--muted); }
.yo-parts > div > span:last-child { font-weight: 600; font-variant-numeric: tabular-nums; }
.yo-up { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 12px; background: var(--raise); border: 1px solid var(--line-2); }
.yo-q { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.yo-res { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.yo-res > div.wide { grid-column: 1 / -1; }
.yo-res > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.yo-res > div > span:first-child { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.yo-res > div > span:last-child { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
`;

function loadCompany(r) {
  try {
    const raw = localStorage.getItem(STORE_KEY(r));
    if (raw) return { company: Y.sanitizeCompany(JSON.parse(raw)), migrated: false };
    const moved = Y.companyFromUretim(JSON.parse(localStorage.getItem(URETIM_KEY(r)) || 'null'));
    if (moved) { localStorage.setItem(STORE_KEY(r), JSON.stringify(moved)); return { company: moved, migrated: true }; }
  } catch { /* gizli sekme ya da bozuk kayıt */ }
  return { company: Y.defaultCompany(), migrated: false };
}
function saveCompany(r, c) {
  try { localStorage.setItem(STORE_KEY(r), JSON.stringify(c)); return true; } catch { return false; }
}

async function loadProducts(r) {
  const path = PATHS.meta(`products_r${r}`);
  const docs = await readDocs([path]);
  const products = dataField(docs.get(path));
  if (!products || !Object.keys(products).length) throw new Error('Ürün listesi okunamadı.');
  return H.normalizeData({ products, realm: r }).products;
}
async function loadLive(r, options) {
  const docs = await readDocs([PATHS.live(r)], options);
  return dataField(docs.get(PATHS.live(r))) || null;
}

export function mountYonetim(root, { realm = 0 } = {}) {
  let r = realm;
  let { company, migrated } = loadCompany(r);
  let products = null;
  let productError = null;
  let live = null;
  let vwap = {}; // araştırma id → { price, source: 'vwap' | 'vwap-dün' } (bugünün ya da dünün ortalama satış fiyatı)
  let vwapLoading = new Set();
  let destroyed = false;
  let loadToken = 0;
  let tab = 'ozet';
  try { tab = localStorage.getItem(TAB_KEY) || 'ozet'; } catch { /* yok */ }
  const fromHash = location.hash.split('/')[1];
  if (TABS.some(([k]) => k === fromHash)) tab = fromHash;
  if (!TABS.some(([k]) => k === tab)) tab = 'ozet';
  let draft = null; // yönetici formu: { index, e }
  let api = null; // { text, parsed, error }
  let toastTimer = null;

  const style = document.createElement('style');
  style.dataset.module = 'yonetim';
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
  function commit(next, { soft = false } = {}) {
    company = Y.sanitizeCompany(next);
    if (!saveCompany(r, company)) toast('Tarayıcı kaydı açık değil; değişiklikler sayfa kapanınca kaybolur.');
    ensureVwap();
    if (soft) softRender(); else render();
  }

  // ---- veri ----
  async function load() {
    const my = ++loadToken;
    products = null; productError = null; live = null; vwap = {}; vwapLoading = new Set();
    render();
    const [p, l] = await Promise.all([loadProducts(r).catch((e) => { productError = e?.message || String(e); return null; }), loadLive(r).catch(() => null)]);
    if (destroyed || my !== loadToken) return;
    products = p; live = l;
    render();
    ensureVwap();
  }
  const researchList = () => Object.values(products || {}).filter((p) => p.research).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const qualityList = () => Object.values(products || {}).filter((p) => H.hasQuality(p)).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const nameOf = (id) => products?.[id]?.name || (id != null ? `#${id}` : '');
  const livePrice = (id) => live?.items?.[id]?.[1]?.[0]?.[0] ?? null;
  // Borsa fiyatı: bugünün VWAP'ı, yoksa dünün, yoksa anlık en düşük ilan
  const marketOf = (id) => {
    if (id == null) return null;
    if (vwap[id]?.price != null) return vwap[id];
    const p = livePrice(id);
    return p != null ? { price: p, source: 'anlık' } : null;
  };
  async function ensureVwap() {
    const ids = new Set([company.research.researchId, ...company.research.upgrades.map((u) => u.researchId)].filter((x) => x != null));
    const my = loadToken;
    for (const id of ids) {
      if (vwap[id] || vwapLoading.has(id)) continue;
      vwapLoading.add(id);
      const today = utcDay(Date.now());
      const yesterday = addDays(today, -1);
      loadProduct(r, id, { days: [today, yesterday] }).then(({ byDay }) => {
        if (destroyed || my !== loadToken) return;
        const pick = (day) => { const d = summarizeDay(byDay.get(day) || [])[0]; return d?.[5] > 0 ? d[6] / d[5] : null; };
        const t = pick(today);
        const y = t == null ? pick(yesterday) : null;
        vwap[id] = t != null ? { price: t, source: 'VWAP bugün' } : y != null ? { price: y, source: 'VWAP dün' } : { price: null };
        softRender();
      }).catch(() => { vwap[id] = { price: null }; }).finally(() => vwapLoading.delete(id));
    }
  }
  async function refreshPrices() {
    vwap = {};
    try { live = await loadLive(r, { refresh: true }); } catch { /* eski fiyatla devam */ }
    ensureVwap();
    render();
    toast('Fiyatlar yenilendi.');
  }

  // Elle girilmemiş fiyatları borsadan doldurup simülasyonu çalıştırır
  function resolved() {
    const c = company;
    const resPrice = c.research.price ?? marketOf(c.research.researchId)?.price ?? null;
    const upgrades = c.research.upgrades.map((u) => ({ ...u, price: u.price ?? marketOf(u.researchId)?.price ?? null }));
    return { ...c, research: { ...c.research, price: resPrice, upgrades } };
  }
  const simulate = () => Y.executiveSimulation(resolved());

  // ---- ekran ----
  function render() {
    if (destroyed) return;
    pendingRender = false;
    const tabs = `<nav class="ur-tabs" aria-label="Yönetim bölümleri">${TABS.map(([k, t]) =>
      `<a href="#yonetim/${k}" ${k === tab ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
    let body;
    try {
      const s = simulate();
      body = tab === 'ekip' ? viewEkip(s) : tab === 'arastirma' ? viewArastirma(s) : tab === 'sirket' ? viewSirket(s) : viewOzet(s);
    } catch (e) {
      console.error(e);
      body = `<div class="ur-msg err" role="alert">Bu ekran gösterilemedi: ${esc(e?.message || e)}</div>`;
    }
    const scroll = window.scrollY;
    view.innerHTML = tabs + body;
    window.scrollTo(0, scroll);
  }

  // ---- ÖZET ----
  function missingNotes(s) {
    const c = company;
    const out = [];
    if (!c.executives.length) out.push('Ekip bölümünden yöneticilerinizi girin.');
    if (!c.admin.wagesDay || !c.admin.totalLevels) out.push('Yönetim katkısı için Şirket › Yönetim giderini doldurun.');
    if (!s.tax.assets) out.push('Muhasebe katkısı için Şirket › Nakit, bono ve bankayı doldurun.');
    if (!c.retail.marginDay) out.push('İletişim katkısı için Şirket › Perakendeyi doldurun.');
    if (!c.research.outputDay) out.push('Bilim katkısı için Araştırma › Araştırma üretimini doldurun.');
    return out.length ? `<div class="ur-box">${out.map((t) => `<p class="ur-note">${esc(t)}</p>`).join('')}</div>` : '';
  }
  function effectsBox(t) {
    const cut = SKILL_LABELS.filter(([k]) => t.scores[k] >= 61).map(([k, n]) => `${n} ${num(Math.floor(t.scores[k]))} → ${num(t.shown[k], t.shown[k] % 1 ? 2 : 0)}`);
    return `<div class="ur-grid4">${SKILL_LABELS.map(([k, n]) => `<div class="ur-stat"><span>${n}</span><span>${num(t.scores[k], t.scores[k] % 1 ? 2 : 0)}</span></div>`).join('')}</div>
      <div class="ur-hr" style="margin:8px 0 4px"></div>
      ${kv('Yönetim gideri tasarrufu', `%${num(t.adminSavingsPct)}`, 'c-price')}
      ${kv('Vergilendirme başlangıcı', `$3M +$${NF[1].format(t.thresholdLift / 1e6)}M`, 'c-price')}
      ${kv('Satış hızı', `+%${num(t.salesSpeedPct)}`)}${kv('Restoran derecesi', `+${NF[3].format(t.restaurantRating)}`)}
      ${kv('Patent olasılığı', `%${NF[2].format(Y.patentChancePct(t))}`)}${kv('Araştırma üretim hızı', `+%${num(t.researchSpeedPct)}`)}
      ${cut.length ? `<p class="ur-note" style="margin-top:6px">60 üstünde azalan getiri: ${cut.join(', ')}.</p>` : ''}
      ${t.bankLevel ? `<p class="ur-note">Banka seviyesi ${num(t.bankLevel)}: muhasebe puanı başı ${money(t.thresholdPerPoint)} eşik.</p>` : ''}`;
  }
  function memberRow(m) {
    const title = esc(m.name || positionName(m.position));
    if (!m.active) {
      const a = m.ifActive;
      return `<div class="yo-member"><div class="top"><div><div class="name c-muted">${title}</div><div class="ur-chips" style="margin-top:4px">${chip(positionName(m.position), 'muted')}${chip('Eğitimde', 'muted')}</div></div>
        <div class="net c-down">${money(-m.salary)}</div></div>
        <p class="ur-note">Maaşı ödeniyor, etkisi yok. Başlayınca günde ${money(a.day)}${a.upgradeSaving > 0 ? `, kalite planında ${money(a.upgradeSaving)}` : ''} kazandırır.</p></div>`;
    }
    const parts = SECTOR_LABELS.map(([k, n]) => `<div><span>${n}</span><span>${money(m.by[k])}</span></div>`).join('');
    const e = m.effects;
    const fx = [];
    if (e.adminSavingsPct) fx.push(`tasarruf %${num(e.adminSavingsPct)}`);
    if (e.thresholdLift) fx.push(`eşik +$${NF[1].format(e.thresholdLift / 1e6)}M`);
    if (e.salesSpeedPct) fx.push(`satış +%${num(e.salesSpeedPct)}`);
    if (e.researchSpeedPct) fx.push(`araştırma +%${num(e.researchSpeedPct)}`);
    if (e.patentPct) fx.push(`patent +%${NF[2].format(e.patentPct)}`);
    return `<div class="yo-member"><div class="top"><div><div class="name">${title}</div><div class="ur-chips" style="margin-top:4px">${chip(positionName(m.position))}<span class="ur-note" style="align-self:center">maaş ${money(m.salary)}</span></div></div>
      <div style="text-align:right"><div class="net ${cls(m.netDay)}">${money(m.netDay, 0, true)}</div><div class="ur-note">net/gün${m.ratio != null ? ` · ${NF[1].format(m.ratio)} kat` : ''}</div></div></div>
      <div class="yo-parts">${parts}</div>
      ${m.upgradeSaving > 0 ? `<p class="ur-note">Kalite planında tek seferlik tasarruf: <b>${money(m.upgradeSaving)}</b></p>` : ''}
      ${fx.length ? `<p class="ur-note">Ayrılırsa: ${fx.join(' · ')}</p>` : ''}</div>`;
  }
  function viewOzet(s) {
    const ex = company.executives;
    const migratedNote = migrated ? '<div class="ur-msg">Yöneticileriniz ve nakdiniz Üretim kurulumundan buraya taşındı. Bundan sonra burada güncelleyin.</div>' : '';
    if (!ex.length) {
      return `${migratedNote}<section class="ur-card"><h1>Yönetici simülasyonu</h1>
        <p class="ur-sub">Her yöneticinin dört alanda ne kazandırdığını gösterir: yönetim (maaş tasarrufu), muhasebe (vergi), iletişim (perakende satış hızı), bilim (araştırma ve kalite yükseltme).</p>
        <a class="ur-btn primary" href="#yonetim/ekip">${icon('plus')}Yöneticileri gir</a></section>`;
    }
    const sec = SECTOR_LABELS.map(([k, n, d]) => kv(`${n} <span class="c-muted">(${d})</span>`, money(s.sectors[k]))).join('');
    const members = [...s.members].sort((a, b) => (b.active - a.active) || (b.netDay - a.netDay));
    return `${migratedNote}
      <section class="ur-card" aria-labelledby="h-sum"><h2 id="h-sum">Yöneticiler ne kazandırıyor</h2>
        <p class="ur-sub">Günlük, şu anki ekiple. Yöneticisiz bir şirkete göre.</p>
        <div class="ur-box">${sec}<div class="ur-hr"></div>
          ${kv('Toplam katkı', money(s.day), '', true)}${kv('Yönetici maaşları', money(s.salariesDay))}
          ${kv('Net getiri', money(s.netDay, 0, true), cls(s.netDay), true)}</div>
        ${s.upgradeSaving > 0 ? `<div class="ur-box">${kv('Kalite planında tek seferlik tasarruf', money(s.upgradeSaving), 'c-up', true)}<p class="ur-note">Bilim puanınız patent olasılığını yükselttiği için gereken araştırma azalır (Araştırma bölümündeki plan).</p></div>` : ''}
        ${missingNotes(s)}</section>
      <section class="ur-card" aria-labelledby="h-fx"><h2 id="h-fx">Ekibinizin etkisi</h2>
        <p class="ur-sub">Oyundaki "Ekibinizin etkisi" ekranıyla aynı; yalnız aktif yöneticiler.</p>${effectsBox(s.team)}</section>
      <section class="ur-card" aria-labelledby="h-mem"><h2 id="h-mem">Kişi başı</h2>
        <p class="ur-sub">Yönetici bugün ayrılsa kaybedilecek günlük para. Azalan getiri yüzünden kişi başı değerlerin toplamı ekip toplamına eşit olmayabilir.</p>
        <div>${members.map(memberRow).join('')}</div></section>`;
  }

  // ---- YÖNETİCİLER ----
  function formCard() {
    const d = draft.e;
    const editing = draft.index != null;
    return `<section class="ur-card" aria-labelledby="h-form"><h2 id="h-form">${editing ? 'Yönetici düzenle' : 'Yönetici ekle'}</h2>
      <div class="ur-field"><span>Pozisyon</span><div class="ur-pos" role="group" aria-label="Pozisyon">${POSITIONS.map(([k, t]) => `<button type="button" data-act="dPos" data-v="${k}" aria-pressed="${k === '1' ? /^\d+$/.test(d.position) : d.position === k}">${t}</button>`).join('')}</div></div>
      <label class="ur-field"><span>İsim (isteğe bağlı)</span><input type="text" data-d="name" value="${esc(d.name)}" autocomplete="off"></label>
      <div class="ur-field"><span>Beceriler</span><div class="ur-grid2">${SKILL_LABELS.map(([k, t]) => `<label class="ur-field"><span style="font-size:13px">${t}</span><input type="text" inputmode="numeric" data-d="skill.${k}" value="${esc(inVal(d.skills[k]))}"></label>`).join('')}</div></div>
      ${field('Günlük maaş', 'salary', inVal(d.salary), { unit: '$', mode: 'numeric', attr: 'data-d' })}
      <div class="ur-field"><span>Durum</span>${seg('dActive', [['1', 'Aktif'], ['0', 'Eğitimde']], d.active ? '1' : '0', 'Durum')}<p class="ur-note">Eğitimde, yerleşmekte ya da grevde olan yönetici etki etmez, maaşı yine ödenir.</p></div>
      <div class="ur-row">${editing ? `<button type="button" class="ur-btn danger" data-act="execDel" aria-label="Yöneticiyi sil">${icon('trash')}</button>` : ''}
        <button type="button" class="ur-btn grow" data-act="formClose">Vazgeç</button><button type="button" class="ur-btn primary grow" data-act="execSave">${editing ? 'Kaydet' : 'Ekle'}</button></div></section>`;
  }
  function apiCard() {
    const p = api.parsed;
    return `<section class="ur-card" aria-labelledby="h-api"><h2 id="h-api">Yöneticileri yapıştır</h2>
      <p class="ur-sub">Oyuna girişliyken <b>simcompanies.com/api/v3/companies/ŞİRKET_NO/executives/</b> adresini açın, metnin tamamını kopyalayıp buraya yapıştırın.</p>
      <textarea data-api spellcheck="false" autocapitalize="off" aria-label="API çıktısı">${esc(api.text || '')}</textarea>
      ${api.error ? `<div class="ur-msg err" role="alert">${esc(api.error)}</div>` : ''}
      ${p ? `<div class="ur-box">${kv('Bulunan yönetici', num(p.length))}${kv('Becerisi olan', num(p.filter((e) => e.skillsKnown).length))}${kv('Eğitimde ya da grevde', num(p.filter((e) => !e.active).length))}
        <p class="ur-note">Mevcut ${num(company.executives.length)} yöneticinin yerine geçer.</p></div>` : ''}
      <div class="ur-row"><button type="button" class="ur-btn grow" data-act="apiClose">Vazgeç</button>
        ${p ? '<button type="button" class="ur-btn primary grow" data-act="apiApply">Listeyi değiştir</button>' : '<button type="button" class="ur-btn primary grow" data-act="apiRead">Oku</button>'}</div></section>`;
  }
  function viewEkip(s) {
    if (draft) return formCard();
    if (api) return apiCard();
    const ex = company.executives;
    const rows = ex.map((e, i) => {
      const m = s.members[i];
      const t = esc(e.name || positionName(e.position));
      return `<div class="ur-line" style="flex-wrap:wrap">
        <div class="grow" style="min-width:150px"><div class="title ${e.active ? '' : 'c-muted'}">${t}</div>
          <div class="ur-chips" style="margin-top:4px">${chip(positionName(e.position), e.active ? '' : 'muted')}<span class="ur-note" style="align-self:center">${money(e.salary)}/gün · net ${money(m.netDay, 0, true)}</span></div>
          <div class="ur-note" style="margin-top:2px">${SKILL_LABELS.map(([k, n]) => `${n} ${dec(e.skills[k])}`).join(' · ')}</div></div>
        <div class="ur-row" style="flex:1 1 200px"><div class="grow">${seg(`execActive.${i}`, [['1', 'Aktif'], ['0', 'Eğitimde']], e.active ? '1' : '0', `${t} durumu`)}</div>
          <button type="button" class="ur-btn" data-act="execEdit" data-v="${i}" aria-label="${t} düzenle">${icon('edit')}</button></div></div>`;
    }).join('');
    const scores = H.teamScores(ex);
    return `<section class="ur-card" aria-labelledby="h-exec"><h2 id="h-exec">Yöneticiler</h2>
      <p class="ur-sub">Ekibiniz yalnız burada girilir; Üretim ve Perakende hesapları da buradan okuyacak.</p>
      <div class="ur-row"><button type="button" class="ur-btn tint grow" data-act="apiOpen">${icon('plus')}API'den yapıştır</button><button type="button" class="ur-btn grow" data-act="execNew">${icon('plus')}Elle ekle</button></div>
      ${ex.length ? `<div>${rows}</div>` : '<p class="ur-note">Henüz yönetici yok.</p>'}
      ${ex.length ? `<div class="ur-box"><span class="ur-note" style="font-weight:600">Ekip puanı (yalnız aktifler)</span><div class="ur-grid4" style="margin-top:6px">${SKILL_LABELS.map(([k, n]) => `<div class="ur-stat"><span>${n}</span><span>${num(scores[k], scores[k] % 1 ? 2 : 0)}</span></div>`).join('')}</div></div>` : ''}</section>`;
  }

  // ---- ARAŞTIRMA ----
  const priceTag = (manual, market) => (manual != null ? chip('Elle girildi', 'muted') : market?.price != null ? chip(`Borsa · ${market.source}`) : chip('Fiyat yok', 'down'));
  const options = (list, selected, empty) => `<option value="" ${selected == null ? 'selected' : ''}>${esc(empty)}</option>${list.map((p) => `<option value="${p.id}" ${Number(selected) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  function upgradeRow(u, i, row, rowNone) {
    const market = marketOf(u.researchId);
    return `<div class="yo-up">
      <div class="ur-grid2"><label class="ur-field"><span>Ürün</span><select data-u="${i}.product">${options(qualityList(), u.product, products ? 'Ürün seçin' : productError ? 'Liste okunamadı' : 'Yükleniyor…')}</select></label>
        <label class="ur-field"><span>Araştırma</span><select data-u="${i}.researchId">${options(researchList(), u.researchId, 'Araştırma seçin')}</select></label></div>
      <div class="yo-q">${field('Mevcut Q', `${i}.from`, String(u.from), { mode: 'numeric', attr: 'data-u' })}${field('Hedef Q', `${i}.to`, String(u.to), { mode: 'numeric', attr: 'data-u' })}
        ${field('Birim fiyat', `${i}.price`, u.price != null ? dec(u.price) : '', { unit: '$', attr: 'data-u', placeholder: market?.price != null ? NF[2].format(market.price) : '' })}</div>
      <div class="ur-chips">${priceTag(u.price, market)}</div>
      <div class="yo-res"><div><span>Patent</span><span>${num(row.patents)}</span></div><div><span>Araştırma</span><span>${num(row.research)}</span></div><div class="wide"><span>Maliyet</span><span class="c-price">${money(row.cost)}</span></div></div>
      ${row.patents > 0 && rowNone.research > row.research ? `<p class="ur-note">Bilim puanı olmasa ${num(rowNone.research)} araştırma${rowNone.cost != null ? `, ${money(rowNone.cost)}` : ''} gerekirdi.</p>` : ''}
      <div class="ur-row"><button type="button" class="ur-btn danger" data-act="upDel" data-v="${i}" aria-label="Satırı kaldır">${icon('trash')}Satırı kaldır</button></div></div>`;
  }
  function viewArastirma(s) {
    const c = company;
    const plan = s.plan;
    const none = s.planWithout;
    const rows = c.research.upgrades.map((u, i) => upgradeRow(u, i, plan.rows[i], none.rows[i])).join('');
    const resMarket = marketOf(c.research.researchId);
    const resPrice = c.research.price ?? resMarket?.price ?? null;
    return `<section class="ur-card" aria-labelledby="h-up"><h2 id="h-up">Kalite planı</h2>
      <p class="ur-sub">Ürünlerinizi daha yüksek kaliteye çıkarmak için gereken patent ve araştırma. Gereken araştırma = patent ÷ patent olasılığı.</p>
      <div class="ur-box">${kv('Patent olasılığınız', `%${NF[2].format(plan.chancePct)}`, 'c-price', true)}<p class="ur-note">Taban %6,25, etkili bilim puanı başı +%0,0625 (bilim 60 → %10).</p></div>
      <div class="ur-row"><button type="button" class="ur-btn tint grow" data-act="upNew">${icon('plus')}Ürün ekle</button><button type="button" class="ur-btn grow" data-act="prices">${icon('refresh')}Fiyatları yenile</button></div>
      ${productError ? `<div class="ur-msg err">Ürün listesi okunamadı (${esc(productError)}). Fiyatları elle girebilirsiniz.</div>` : ''}
      ${rows || '<p class="ur-note">Henüz satır yok.</p>'}
      ${c.research.upgrades.length ? `<div class="ur-box"><span class="ur-note" style="font-weight:600">Toplam</span>
        ${kv('Patent', num(plan.patents))}${kv('Araştırma', num(plan.research))}${kv('Maliyet', money(plan.cost), 'c-price', true)}
        ${s.upgradeSaving > 0 ? `<div class="ur-hr"></div>${kv('Bilim puanı olmasa', money(none.cost))}${kv('Ekibinizin tasarrufu', money(s.upgradeSaving), 'c-up', true)}` : ''}
        ${plan.missingPrice ? '<p class="ur-note">Fiyatı olmayan satırlar maliyete katılmadı.</p>' : ''}</div>` : ''}</section>
      <section class="ur-card" aria-labelledby="h-rp"><h2 id="h-rp">Araştırma üretimi</h2>
        <p class="ur-sub">Bilim puanı araştırma binalarının üretim hızını artırır (puan başı %2). Ürettiğiniz araştırmanın değeri bilimin günlük katkısıdır.</p>
        <label class="ur-field"><span>Araştırma türü (fiyat için)</span><select data-f="research.researchId">${options(researchList(), c.research.researchId, 'Araştırma seçin')}</select></label>
        ${field('Günlük araştırma üretimi (şu an)', 'research.outputDay', inVal(c.research.outputDay), { unit: 'adet', mode: 'numeric', hint: 'Bütün araştırma binalarınızın şu anki toplamı.' })}
        ${field('Birim fiyat', 'research.price', c.research.price != null ? dec(c.research.price) : '', { unit: '$', placeholder: resMarket?.price != null ? NF[2].format(resMarket.price) : '', hint: 'Boş bırakırsanız borsadan alınır.' })}
        <div class="ur-chips">${priceTag(c.research.price, resMarket)}</div>
        ${field('Ekip dışı hız bonusu', 'research.otherSpeedPct', inVal(c.research.otherSpeedPct), { unit: '%', hint: 'Rekreasyon, olay gibi yöneticiler dışındaki bonuslar. Bilmiyorsanız 0.' })}
        <div class="ur-box">${kv('Günlük üretim değeri', money(c.research.outputDay * (resPrice || 0)))}${kv('Bilimin günlük katkısı', money(s.sectors.cto), 'c-up', true)}</div></section>`;
  }

  // ---- ŞİRKET ----
  function viewSirket(s) {
    const c = company;
    const b = s.bases;
    return `<section class="ur-card" aria-labelledby="h-adm"><h2 id="h-adm">Yönetim gideri</h2>
        <p class="ur-sub">Yönetimin (COO) maaş tasarrufu için. İleride Üretim ve Perakende binalarınızdan otomatik gelecek.</p>
        ${field('Toplam bina seviyesi', 'admin.totalLevels', inVal(c.admin.totalLevels), { mode: 'numeric', hint: 'Rekreasyon binaları hariç bütün binaların seviyeleri toplamı.' })}
        ${field('Günlük toplam maaş', 'admin.wagesDay', inVal(c.admin.wagesDay), { unit: '$', mode: 'numeric', hint: 'Bütün binaların günlük maaşı, yönetim gideri dahil (oyunda ödediğiniz).' })}
        <div class="ur-box">${kv('Brüt yönetim gideri', `%${NF[2].format(b.gross * 100)}`)}${kv('Ekibin tasarrufu', `%${num(s.team.adminSavingsPct)}`)}
          ${kv('Yönetim gidersiz maaş', money(b.wageBaseDay))}${kv('Yönetimin günlük katkısı', money(s.sectors.coo), 'c-up', true)}</div></section>
      <section class="ur-card" aria-labelledby="h-fin"><h2 id="h-fin">Nakit, bono ve banka</h2>
        <p class="ur-sub">Vergi (muhasebe ücreti) ve muhasebecinin (CFO) kazandırdığı için.</p>
        ${field('Nakit', 'finance.cash', inVal(c.finance.cash), { unit: '$', mode: 'numeric', hint: 'Oyunun sağ üstündeki yeşil tutar; tipik gün sonu nakdiniz.' })}
        <div class="ur-grid2">${field('Alınan bono', 'finance.bondsBought', inVal(c.finance.bondsBought), { unit: '$', mode: 'numeric' })}${field('İhraç edilen bono', 'finance.bondsIssued', inVal(c.finance.bondsIssued), { unit: '$', mode: 'numeric' })}</div>
        ${field('Banka seviyesi', 'finance.bankLevel', inVal(c.finance.bankLevel), { mode: 'numeric', hint: 'Bankanız yoksa 0. Seviye başı, muhasebe puanı başı +$50k eşik (en çok 40).' })}
        <div class="ur-box">${kv('Vergilenen varlık', money(s.tax.assets))}${kv('Vergilendirme başlangıcı', money(s.tax.threshold))}
          ${kv('Günlük vergi', money(s.tax.day), 'c-price')}${kv('Yöneticisiz olsaydı', money(s.tax.withoutDay))}${kv('Muhasebenin günlük katkısı', money(s.sectors.cfo), 'c-up', true)}
          <p class="ur-note">Vergi kademeli: eşiğin üstüne %0,5; +3M, +6M, +9M'de %0,5 daha, +12M'de %1 daha.</p></div></section>
      <section class="ur-card" aria-labelledby="h-ret"><h2 id="h-ret">Perakende</h2>
        <p class="ur-sub">İletişimin (CMO) satış hızı katkısı için. Satış hızı arttıkça aynı sürede daha çok ürün satılır.</p>
        ${field('Günlük perakende marjı', 'retail.marginDay', inVal(c.retail.marginDay), { unit: '$', hint: 'Mağaza ve restoranlarınızda günlük satış geliri − satılan malın maliyeti (maaşlar hariç), şu anki ekiple.' })}
        ${field('Ekip dışı satış hızı bonusu', 'retail.otherSpeedPct', inVal(c.retail.otherSpeedPct), { unit: '%', hint: 'Oyundaki toplam satış hızından ekibin payı çıkınca kalan. Bilmiyorsanız 0.' })}
        <div class="ur-box">${kv('Ekibin satış hızı', `+%${num(s.team.salesSpeedPct)}`)}${kv('Restoran derecesi', `+${NF[3].format(s.team.restaurantRating)}`)}
          ${kv('İletişimin günlük katkısı', money(s.sectors.cmo), 'c-up', true)}
          <p class="ur-note">Satacak mal yeterliyse geçerli. Restoran derecesinin fiyata etkisi paraya çevrilmedi.</p></div></section>`;
  }

  // ---- olaylar ----
  const newExec = () => ({ id: uid('e'), name: '', position: 'o', salary: 0, skills: { coo: 0, cfo: 0, cmo: 0, cto: 0 }, active: true });
  function onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const act = el.dataset.act;
    const v = el.dataset.v;
    if (act.startsWith('execActive.')) {
      const i = Number(act.split('.')[1]);
      return commit({ ...company, executives: company.executives.map((e, j) => (j === i ? { ...e, active: v === '1' } : e)) });
    }
    if (act === 'execNew') { draft = { index: null, e: newExec() }; api = null; return render(); }
    if (act === 'execEdit') { const i = Number(v); draft = { index: i, e: structuredClone(company.executives[i]) }; return render(); }
    if (act === 'formClose') { draft = null; return render(); }
    if (act === 'dPos') { draft.e.position = v; return render(); }
    if (act === 'dActive') { draft.e.active = v === '1'; return render(); }
    if (act === 'execSave') {
      const list = [...company.executives];
      if (draft.index != null) list[draft.index] = draft.e; else list.push(draft.e);
      draft = null;
      commit({ ...company, executives: list });
      return toast('Kaydedildi.');
    }
    if (act === 'execDel') {
      const list = company.executives.filter((_, j) => j !== draft.index);
      draft = null;
      return commit({ ...company, executives: list });
    }
    if (act === 'apiOpen') { api = { text: '' }; draft = null; return render(); }
    if (act === 'apiClose') { api = null; return render(); }
    if (act === 'apiRead') {
      const text = root.querySelector('[data-api]')?.value || '';
      try {
        const parsed = H.parseExecutives(text);
        api = parsed.length ? { text, parsed } : { text, error: 'Listede yönetici bulunamadı.' };
      } catch { api = { text, error: 'Metin okunamadı. Sayfadaki metnin tamamını kopyaladığınızdan emin olun.' }; }
      return render();
    }
    if (act === 'apiApply') {
      const list = api.parsed.map((e) => ({ name: e.name, position: e.position, salary: e.salary, skills: e.skills, active: e.active }));
      api = null;
      commit({ ...company, executives: list });
      return toast(`${list.length} yönetici yüklendi.`);
    }
    if (act === 'upNew') {
      const last = company.research.upgrades[company.research.upgrades.length - 1];
      const u = { id: uid('u'), product: null, researchId: last?.researchId ?? null, from: 0, to: 1, price: null };
      return commit({ ...company, research: { ...company.research, upgrades: [...company.research.upgrades, u] } });
    }
    if (act === 'upDel') {
      const i = Number(v);
      return commit({ ...company, research: { ...company.research, upgrades: company.research.upgrades.filter((_, j) => j !== i) } });
    }
    if (act === 'prices') return refreshPrices();
  }
  function setPath(obj, path, value) {
    const [a, b] = path.split('.');
    return b ? { ...obj, [a]: { ...obj[a], [b]: value } } : { ...obj, [a]: value };
  }
  function onChange(ev) {
    const t = ev.target;
    if (t.dataset.f) {
      const path = t.dataset.f;
      const raw = t.value;
      let value;
      if (t.tagName === 'SELECT') value = raw === '' ? null : Number(raw);
      else if (path === 'research.price') value = raw.trim() === '' ? null : parseNum(raw);
      else value = parseNum(raw) ?? 0;
      return commit(setPath(company, path, value), { soft: true });
    }
    if (t.dataset.u) {
      const [i, k] = t.dataset.u.split('.');
      const raw = t.value;
      let value;
      if (k === 'product' || k === 'researchId') value = raw === '' ? null : Number(raw);
      else if (k === 'price') value = raw.trim() === '' ? null : parseNum(raw);
      else value = parseNum(raw) ?? 0;
      const upgrades = company.research.upgrades.map((u, j) => (j === Number(i) ? { ...u, [k]: value } : u));
      return commit({ ...company, research: { ...company.research, upgrades } }, { soft: true });
    }
  }
  function onInput(ev) {
    const t = ev.target;
    if (!t.dataset.d || !draft) return;
    const k = t.dataset.d;
    if (k === 'name') draft.e.name = t.value;
    else if (k === 'salary') draft.e.salary = Math.max(0, parseNum(t.value) ?? 0);
    else if (k.startsWith('skill.')) draft.e.skills[k.slice(6)] = Math.max(0, parseNum(t.value) ?? 0);
  }
  function onHash() {
    const [head, sub] = location.hash.slice(1).split('/');
    if (head !== 'yonetim') return;
    const next = TABS.some(([k]) => k === sub) ? sub : 'ozet';
    if (next === tab) return;
    tab = next;
    draft = null; api = null;
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* yok */ }
    render();
    window.scrollTo(0, 0);
  }

  root.addEventListener('click', onClick);
  root.addEventListener('click', onAnyClick, true);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('hashchange', onHash);
  load();

  return {
    setRealm(next) {
      if (next === r) return;
      r = next;
      ({ company, migrated } = loadCompany(r));
      draft = null; api = null;
      load();
    },
    destroy() {
      destroyed = true;
      clearTimeout(toastTimer); clearTimeout(settleTimer);
      root.removeEventListener('click', onClick);
      root.removeEventListener('click', onAnyClick, true);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onInput);
      root.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('hashchange', onHash);
      style.remove();
      root.replaceChildren();
    },
  };
}
