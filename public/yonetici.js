// DentSimco — Yönetici simülasyonu (hesap motoru, ekransız)
// Yöneticilerin dört alandaki para karşılığı: yönetim (maaş tasarrufu), muhasebe (vergi), iletişim (perakende satış hızı),
// bilim (araştırma üretim hızı ve kalite yükseltmede patent olasılığı). Ekip etkileri hesap.js'teki doğrulanmış
// teamEffects'ten gelir; burada yalnız paraya çevirme var.
//
// Şirket kaydı (company):
//   executives: [{ name, position, salary, skills: {coo,cfo,cmo,cto}, active }]
//   finance:  { cash, bondsBought, bondsIssued, bankLevel }        // bono = oyundaki tahvil
//   admin:    { totalLevels, wagesDay }      // yönetim gideri için: toplam bina seviyesi, yönetim gideri DAHİL günlük maaş
//   retail:   { marginDay, otherSpeedPct }   // perakende: günlük brüt marj (satış − mal maliyeti), ekip dışı satış hızı bonusu
//   research: { outputDay, price, otherSpeedPct, upgrades: [{ label, researchId, from, to, price }] }

import * as H from './hesap.js';

const num = (x, d = 0) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : d);
const EPS = 1e-9;

// ---------------------------------------------------------------------------------------------------------------
// Kalite yükseltme: her basamak için gereken patent (oyunda ürüne göre değişmez; Cooper's Tools ile doğrulandı)
// PATENTS_PER_STEP[q] = Q(q) → Q(q+1)
// ---------------------------------------------------------------------------------------------------------------
export const PATENTS_PER_STEP = [12, 50, 500, 2000, 5000, 10000, 10000, 10000, 10000, 10000, 50000, 50000];

export function patentsNeeded(from, to) {
  const a = H.clampQuality(from);
  const b = H.clampQuality(to);
  let total = 0;
  for (let q = a; q < b; q++) total += PATENTS_PER_STEP[q];
  return total;
}

// Patent olasılığı (%): taban %6,25 + etkili bilim puanı × 0,0625 (bilim 60 → %10)
export const patentChancePct = (team) => H.PATENT_BASE_PCT + (team?.patentPct || 0);

// Gereken araştırma = patent ÷ olasılık (yukarı yuvarlanır: araştırma tam adet)
export function researchNeeded(patents, chancePct) {
  const p = num(chancePct, 0) / 100;
  if (!(p > 0) || !(patents > 0)) return 0;
  return Math.ceil(patents / p - EPS);
}

export function upgradePlan(upgrades = [], team) {
  const chance = patentChancePct(team);
  const rows = upgrades.map((u) => {
    const patents = patentsNeeded(u.from, u.to);
    const research = researchNeeded(patents, chance);
    const price = num(u.price, null);
    return { ...u, patents, research, price, cost: price == null ? null : research * price };
  });
  const priced = rows.filter((x) => x.cost != null);
  return {
    chancePct: chance, rows,
    patents: rows.reduce((s, x) => s + x.patents, 0),
    research: rows.reduce((s, x) => s + x.research, 0),
    cost: priced.reduce((s, x) => s + x.cost, 0),
    missingPrice: rows.some((x) => x.patents > 0 && x.price == null),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Şirket kaydı
// ---------------------------------------------------------------------------------------------------------------
export function defaultCompany() {
  return {
    v: 1,
    executives: [],
    finance: { cash: 0, bondsBought: 0, bondsIssued: 0, bankLevel: 0 },
    admin: { totalLevels: 0, wagesDay: 0 },
    retail: { marginDay: 0, otherSpeedPct: 0 },
    research: { outputDay: 0, price: null, researchId: null, otherSpeedPct: 0, upgrades: [] },
  };
}

const pos = (x) => Math.max(0, num(x, 0));
let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function sanitizeCompany(raw) {
  const base = defaultCompany();
  if (!raw || typeof raw !== 'object') return base;
  const c = { ...base };
  c.executives = (Array.isArray(raw.executives) ? raw.executives : []).filter((e) => e && typeof e === 'object')
    .map((e) => ({ id: e.id || uid('e'), name: String(e.name || ''), position: String(e.position || 'o'), salary: pos(e.salary),
      skills: Object.fromEntries(H.SKILLS.map((k) => [k, pos(e.skills?.[k])])), active: e.active !== false }));
  const f = raw.finance || {};
  c.finance = { cash: pos(f.cash), bondsBought: pos(f.bondsBought), bondsIssued: pos(f.bondsIssued), bankLevel: H.clampBankLevel(f.bankLevel) };
  const a = raw.admin || {};
  c.admin = { totalLevels: Math.floor(pos(a.totalLevels)), wagesDay: pos(a.wagesDay) };
  const r = raw.retail || {};
  c.retail = { marginDay: num(r.marginDay, 0), otherSpeedPct: pos(r.otherSpeedPct) };
  const s = raw.research || {};
  c.research = {
    outputDay: pos(s.outputDay),
    price: s.price == null || s.price === '' ? null : pos(s.price),
    researchId: s.researchId == null || s.researchId === '' ? null : Number(s.researchId),
    otherSpeedPct: pos(s.otherSpeedPct),
    upgrades: (Array.isArray(s.upgrades) ? s.upgrades : []).filter((u) => u && typeof u === 'object').map((u) => {
      const from = H.clampQuality(u.from);
      return {
        id: u.id || uid('u'), label: String(u.label || ''),
        product: u.product == null || u.product === '' ? null : Number(u.product),
        researchId: u.researchId == null || u.researchId === '' ? null : Number(u.researchId),
        from, to: Math.max(from, H.clampQuality(u.to)),
        price: u.price == null || u.price === '' ? null : pos(u.price),
      };
    }),
  };
  return c;
}

// Üretim kurulumundan (eski yer) yöneticileri ve nakdi bir kez taşır
export function companyFromUretim(uretimSetup) {
  if (!uretimSetup || typeof uretimSetup !== 'object') return null;
  const ex = Array.isArray(uretimSetup.executives) ? uretimSetup.executives : [];
  const f = uretimSetup.finance || {};
  if (!ex.length && !f.cash && !f.bondsBought && !f.bondsIssued && !f.bankLevel) return null;
  return sanitizeCompany({ executives: ex, finance: f });
}

// ---------------------------------------------------------------------------------------------------------------
// Para karşılığı
// ---------------------------------------------------------------------------------------------------------------
// Sabit tabanlar (mevcut ekiple girilen değerlerden ekipsiz tabana iner, böylece ekip değişince doğru ölçeklenir)
export function companyBases(company) {
  const c = company;
  const team = H.teamEffects(c.executives, { bankLevel: c.finance.bankLevel });
  const gross = H.grossOverhead(c.admin.totalLevels);
  const savingsNow = Math.min(100, team.adminSavingsPct) / 100;
  // girilen maaş = taban × (1 + brüt × (1 − tasarruf))
  const wageBaseDay = c.admin.wagesDay / (1 + gross * (1 - savingsNow));
  // satış/üretim hızı: adet ∝ (100 + diğer + ekip)
  const retailPerPct = c.retail.marginDay / (100 + c.retail.otherSpeedPct + team.salesSpeedPct);
  const price = num(c.research.price, 0);
  const researchPerPct = (c.research.outputDay * price) / (100 + c.research.otherSpeedPct + team.researchSpeedPct);
  return { team, gross, wageBaseDay, retailPerPct, researchPerPct, assets: H.assessableAssets(c.finance) };
}

// Bir ekibin günlük getirisi ve kalite planı maliyeti (tabanlar sabit tutulur)
export function teamValue(executives, company, bases = companyBases(company)) {
  const team = H.teamEffects(executives, { bankLevel: company.finance.bankLevel });
  const coo = bases.wageBaseDay * bases.gross * (Math.min(100, team.adminSavingsPct) / 100);
  const taxNone = H.accountingOverheadDay(bases.assets, H.TAX_BASE_THRESHOLD);
  const tax = H.accountingOverheadDay(bases.assets, H.TAX_BASE_THRESHOLD + team.thresholdLift);
  const cfo = Math.max(0, taxNone - tax);
  const cmo = bases.retailPerPct * team.salesSpeedPct;
  const cto = bases.researchPerPct * team.researchSpeedPct;
  const plan = upgradePlan(company.research.upgrades, team);
  return { team, coo, cfo, cmo, cto, day: coo + cfo + cmo + cto, tax, taxNone, plan };
}

const SECTORS = ['coo', 'cfo', 'cmo', 'cto'];
const diff = (a, b) => Object.fromEntries(SECTORS.map((k) => [k, a[k] - b[k]]));

// Ana analiz: ekip toplamı + her yöneticinin alan alan katkısı
// Kişi başı katkı = o yönetici bugün ayrılsa kaybedilecek tutar (azalan getiri yüzünden toplamı ekip toplamına eşit olmayabilir).
export function executiveSimulation(rawCompany) {
  const company = sanitizeCompany(rawCompany);
  const ex = company.executives;
  const bases = companyBases(company);
  const now = teamValue(ex, company, bases);
  const none = teamValue([], company, bases);
  const salariesDay = ex.reduce((s, e) => s + e.salary, 0);
  const members = ex.map((e, index) => {
    const others = ex.filter((_, j) => j !== index);
    if (e.active) {
      const w = teamValue(others, company, bases);
      const by = diff(now, w);
      const day = SECTORS.reduce((s, k) => s + by[k], 0);
      return {
        index, id: e.id, name: e.name, position: e.position, active: true, salary: e.salary, by, day, netDay: day - e.salary,
        ratio: e.salary > 0 ? day / e.salary : null,
        upgradeSaving: w.plan.cost - now.plan.cost, // kalite planında tek seferlik tasarruf
        effects: {
          salesSpeedPct: now.team.salesSpeedPct - w.team.salesSpeedPct,
          restaurantRating: now.team.restaurantRating - w.team.restaurantRating,
          researchSpeedPct: now.team.researchSpeedPct - w.team.researchSpeedPct,
          patentPct: now.team.patentPct - w.team.patentPct,
          adminSavingsPct: now.team.adminSavingsPct - w.team.adminSavingsPct,
          thresholdLift: now.team.thresholdLift - w.team.thresholdLift,
        },
      };
    }
    const activated = ex.map((x, j) => (j === index ? { ...x, active: true } : x));
    const w = teamValue(activated, company, bases);
    const by = diff(w, now);
    const day = SECTORS.reduce((s, k) => s + by[k], 0);
    return {
      index, id: e.id, name: e.name, position: e.position, active: false, salary: e.salary,
      by: null, day: 0, netDay: -e.salary, ratio: null,
      ifActive: { by, day, upgradeSaving: now.plan.cost - w.plan.cost },
    };
  });
  return {
    company, bases, team: now.team,
    sectors: { coo: now.coo, cfo: now.cfo, cmo: now.cmo, cto: now.cto },
    day: now.day, salariesDay, netDay: now.day - salariesDay,
    tax: { assets: bases.assets, threshold: H.TAX_BASE_THRESHOLD + now.team.thresholdLift, day: now.tax, withoutDay: now.taxNone },
    plan: now.plan, planWithout: none.plan, upgradeSaving: none.plan.cost - now.plan.cost,
    members,
  };
}
