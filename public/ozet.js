// DentSimco — Şirket özeti
import * as H from './hesap.js';
import * as Y from './yonetici.js';
import { CSS, loadSetup, loadData, loadLive } from './uretim.js';

const PERIOD_KEY = 'dentsimco.ozet.period';
const PERIODS = [['hour', 'Saatlik', 1 / 24], ['day', 'Günlük', 1], ['week', 'Haftalık', 7], ['month', 'Aylık', 30]];

const NF = [0, 1, 2].map((d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fin = (x) => x != null && Number.isFinite(x);
const num = (x, d = 0) => (fin(x) ? NF[d].format(x) : '—');
const money = (x, sign = false) => {
  if (!fin(x)) return '—';
  const s = `$${NF[0].format(Math.abs(x))}`;
  return Math.round(x) < 0 ? `−${s}` : sign && Math.round(x) > 0 ? `+${s}` : s;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (x) => (Math.round(x) > 0 ? 'c-up' : Math.round(x) < 0 ? 'c-down' : '');
const kv = (label, value, c = '', strong = false) => `<div class="ur-kv${strong ? ' strong' : ''}"><span>${label}</span><span class="${c}">${value}</span></div>`;
const seg = (act, options, value, label) => `<div class="ur-seg" role="group" aria-label="${esc(label)}">${options.map(([v, t]) =>
  `<button type="button" data-act="${act}" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(t)}</button>`).join('')}</div>`;
const tri = (label, a, b, o = {}) => `<div class="ur-tri${o.strong ? ' strong' : ''}${o.line ? ' line' : ''}${o.indent ? ' indent' : ''}${o.muted ? ' muted' : ''}"><span>${label}</span><span class="${o.ca || ''}">${a}</span><span class="${o.cb || ''}">${b}</span></div>`;
const grp = (t) => `<div class="ur-grp">${t}</div>`;

export function mountOzet(root, { realm = 0 } = {}) {
  let r = realm;
  let company = Y.loadCompanyRecord(r).company;
  let setup = loadSetup(r);
  let data = null;
  let live = null;
  let loadError = null;
  let loadToken = 0;
  let destroyed = false;
  let period = 'day';
  try { period = PERIODS.some(([k]) => k === localStorage.getItem(PERIOD_KEY)) ? localStorage.getItem(PERIOD_KEY) : 'day'; } catch { /* gizli sekme */ }

  const style = document.createElement('style');
  style.dataset.module = 'ozet';
  style.textContent = CSS;
  document.head.append(style);
  root.innerHTML = '<div class="ur"></div>';
  const view = root.querySelector('.ur');

  const marketPrice = (id, q) => live?.items?.[id]?.[1]?.[q]?.[0] ?? null;
  const researchPrice = () => company.research.price ?? marketPrice(company.research.researchId, 0);

  async function load() {
    const my = ++loadToken;
    data = null;
    loadError = null;
    render();
    try {
      const [d, l] = await Promise.all([loadData(r), loadLive(r).catch(() => null)]);
      if (destroyed || my !== loadToken) return;
      data = d;
      live = l;
    } catch (e) {
      if (destroyed || my !== loadToken) return;
      loadError = e?.message || String(e);
    }
    render();
  }

  const withTeam = (s) => ({ ...s, executives: company.executives, finance: company.finance, admin: { mode: 'executives' } });

  function render() {
    if (destroyed) return;
    let body;
    if (loadError) {
      body = `<div class="ur-msg err" role="alert">Veriler okunamadı: ${esc(loadError)}</div><button type="button" class="ur-btn" data-act="retry">Tekrar dene</button>`;
    } else if (!data) {
      body = '<p class="ur-sub" aria-busy="true">Ürün ve bina verileri yükleniyor…</p>';
    } else {
      try { body = viewOzet(); } catch (e) {
        console.error(e);
        body = `<div class="ur-msg err" role="alert">Bu ekran gösterilemedi: ${esc(e?.message || e)}</div>`;
      }
    }
    const scroll = window.scrollY;
    view.innerHTML = body;
    window.scrollTo(0, scroll);
  }

  function viewOzet() {
    const k = PERIODS.find(([key]) => key === period)[2];
    const m = (v, sign = false) => money(v * k, sign);
    const periodName = PERIODS.find(([key]) => key === period)[1].toLocaleLowerCase('tr');
    const head = `<div class="ur-head"><div><h1>Şirket özeti</h1><p class="ur-sub">Üretim, yönetici ekibi ve vergi tek tabloda.</p></div></div>${seg('period', PERIODS.map(([key, t]) => [key, t]), period, 'Dönem')}`;

    const plan = H.evaluatePlan(withTeam(setup), data, marketPrice, { now: Date.now() });
    const t = plan.totals;
    const hasPlan = plan.rows.length > 0;
    const ex = H.executiveAnalysis(withTeam(setup), data, plan);
    const sim = Y.executiveSimulation({ ...company, research: { ...company.research, price: researchPrice() } });

    const tax = ex.taxDay;
    const cashX = t.netCashExchangeDay;
    const cashC = t.netCashContractDay;
    const afterX = cashX - tax;
    const afterC = cashC - tax;

    const stats = `<div class="ur-grid2">
      <div class="ur-card" style="padding:12px;gap:2px"><span class="ur-note" style="font-weight:600">Vergi sonrası net · Borsa</span><span class="${cls(afterX)}" style="font:600 22px var(--font-c)">${m(afterX, true)}</span><span class="ur-note">${periodName}</span></div>
      <div class="ur-card" style="padding:12px;gap:2px"><span class="ur-note" style="font-weight:600">Vergi sonrası net · Kontrat</span><span class="${cls(afterC)}" style="font:600 22px var(--font-c)">${m(afterC, true)}</span><span class="ur-note">${periodName}</span></div></div>`;

    const table = `<section class="ur-card" aria-labelledby="h-sum"><h2 id="h-sum">Gelir tablosu (${periodName})</h2>
      <div class="ur-tri head"><span></span><span>Borsa</span><span>Kontrat</span></div>
      ${grp('Üretim')}${tri('Net satış', m(t.revenueExchangeDay), m(t.revenueContractDay), { indent: true })}
      ${tri('Girdi alımları', m(-t.purchasesDay), m(-t.purchasesDay), { indent: true })}
      ${tri('Bina maaşları', m(-t.wageBaseDay), m(-t.wageBaseDay), { indent: true })}
      ${tri('Yönetim gideri', m(-(t.wagesDayNet - t.wageBaseDay)), m(-(t.wagesDayNet - t.wageBaseDay)), { indent: true })}
      ${tri('Üretim brüt kârı', m(t.profitExchangeDay, true), m(t.profitContractDay, true), { strong: true, line: true, ca: cls(t.profitExchangeDay), cb: cls(t.profitContractDay) })}
      ${grp('Perakende')}${tri('Perakende kârı', '—', '—', { indent: true, muted: true })}
      ${grp('Şirket')}${tri('Yönetici maaşları', m(-ex.salariesDay), m(-ex.salariesDay), { indent: true })}
      ${tri('Net nakit', m(cashX, true), m(cashC, true), { strong: true, line: true, ca: cls(cashX), cb: cls(cashC) })}
      ${tri('Vergi (muhasebe ücreti)', m(-tax), m(-tax), { indent: true })}
      ${tri('Vergi sonrası net', m(afterX, true), m(afterC, true), { strong: true, line: true, ca: cls(afterX), cb: cls(afterC) })}
      <p class="ur-note">Perakende henüz hesaba girmiyor. Vergi nakit ve bonoya göre günlük ücrettir; Yönetim › Muhasebe'de girilir.${hasPlan ? '' : ' Üretim planında bina yok; Üretim › Binalar\'dan ekleyin.'}</p></section>`;

    const members = ex.members.map((mm) => `<div class="ur-line"><div class="grow"><div class="title ${mm.active ? '' : 'c-muted'}">${esc(mm.name || '—')}</div>
        <span class="ur-note">${mm.active ? `maaş ${m(mm.salary)}` : 'Eğitimde'}</span></div>
        <div style="text-align:right">${mm.active ? `<div class="c-up" style="font-weight:600;font-variant-numeric:tabular-nums">${m(mm.valueDay, true)}</div>` : `<div class="c-muted" style="font-weight:600">${m(mm.ifActiveValueDay || 0, true)}</div><span class="ur-note">başlayınca</span>`}</div></div>`).join('');
    const ctoMissing = sim.sectors.cto === 0 && company.research.outputDay > 0 && !researchPrice();
    const team = `<section class="ur-card" aria-labelledby="h-team"><h2 id="h-team">Yöneticiler ne kazandırıyor (${periodName})</h2>
      <div class="ur-box">${kv('Yönetim (maaş tasarrufu)', m(ex.teamCooValueDay), ex.teamCooValueDay > 0 ? 'c-up' : '')}
        ${kv('Muhasebe (ödenmeyen vergi)', m(ex.teamCfoValueDay), ex.teamCfoValueDay > 0 ? 'c-up' : '')}
        ${kv('İletişim (perakende satış)', company.retail.marginDay > 0 ? m(sim.sectors.cmo) : '—', sim.sectors.cmo > 0 ? 'c-up' : '')}
        ${kv('Bilim (araştırma üretimi)', company.research.outputDay > 0 ? m(sim.sectors.cto) : '—', sim.sectors.cto > 0 ? 'c-up' : '')}
        <div class="ur-hr"></div>
        ${kv('Yöneticilerin kazandırdığı', m(ex.teamCooValueDay + ex.teamCfoValueDay + sim.sectors.cmo + sim.sectors.cto), '', true)}${kv('Yönetici maaşları', m(ex.salariesDay))}
        ${kv('Net getiri', m(ex.teamCooValueDay + ex.teamCfoValueDay + sim.sectors.cmo + sim.sectors.cto - ex.salariesDay, true), cls(ex.teamCooValueDay + ex.teamCfoValueDay + sim.sectors.cmo + sim.sectors.cto - ex.salariesDay), true)}</div>
      ${company.executives.length ? `<div>${members}</div>` : '<p class="ur-note">Henüz yönetici yok. Yönetim › Ekip\'ten ekleyin.</p>'}
      <p class="ur-note">Yönetim ve muhasebe bu sayfadaki Üretim planına göre; kişi başı tutar o yönetici ayrılırsa kaybedilecek paradır (yalnız Yönetim ve Muhasebe için). İletişim ve bilim Yönetim › Satış ve Araştırma'da girdiğiniz değerlerden gelir.${ctoMissing ? ' Bilim için araştırma fiyatı bulunamadı; Yönetim › Araştırma\'da araştırmayı seçin.' : ''}</p></section>`;

    const links = `<div class="ur-row"><a class="ur-btn grow" href="#uretim/binalar" style="text-decoration:none">Üretim</a><a class="ur-btn grow" href="#yonetim/ekip" style="text-decoration:none">Yönetim</a></div>`;
    return `${head}${stats}${table}${team}${links}`;
  }

  function onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || !root.contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'retry') return load();
    if (act === 'period') { period = btn.dataset.v; try { localStorage.setItem(PERIOD_KEY, period); } catch { /* yok */ } render(); }
  }
  root.addEventListener('click', onClick);
  load();

  return {
    setRealm(next) {
      if (next === r) return;
      r = next;
      company = Y.loadCompanyRecord(r).company;
      setup = loadSetup(r);
      load();
    },
    destroy() {
      destroyed = true;
      root.removeEventListener('click', onClick);
      style.remove();
      root.replaceChildren();
    },
  };
                                    }
