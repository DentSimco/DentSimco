// DentSimco — Perakende hesap motoru
//
// Arayüzsüz, saf fonksiyonlar: tarayıcıda ve Node'da aynen çalışır; DOM, ağ ya da Firestore bilgisi içermez.
// Formüller: SimCompanies "New Retail Model" (Nisan 2026) ve SimCompaniesTimes #317 / #349.
// Sabitler public/perakende-veri.js dosyasında; canlı değerler (doygunluk, hava, bonus, maaş) çağıran koddan gelir.
//
// Birimler: para dolar, miktar adet. "Hour" ile biten alanlar saatlik, "Day" ile bitenler günlük (24 saat).
// Yüzdeler "Pct" ile biter (12 = %12). usphpl = bina seviyesi başına saatlik satış adedi, pphpl = seviye başına saatlik kâr.
//
// Formüller (d, d_m, y, z):
//   d   = MIN(MAX(2 − s; 0); 2)                s = ürünün piyasa doygunluğu (resources-retail-info)
//   d_m = MAX(0,9; (d + 1) / 2)
//   y   = ½ · p · d · (B·u + 1) · (q·w/12 + 1)   p = 370, w = 0,3 (core), ağaçta q = 0 alınır
//   z   = (W + y) / (u · d_m)
//   usphpl(r) = [w_c · u · d_m / (1 − b/100)] · (2 − (r − c) / z)
//   pphpl(r)  = (r − c_act) · usphpl(r) − S      S = gerçek saatlik mağaza maaşı (yönetim gideri dahil)
//   r_max     = z + (c + c_act) / 2              kârı en büyük yapan fiyat
//
// Kurulum (setup) biçimi — arayüz üretir, tarayıcıda realm başına saklanır:
// {
//   economyPhase: 0,                                   // 0 Durgunluk, 1 Normal, 2 Büyüme
//   buildings: [{ id, letter: 'G', level: 20,
//                 lines: [{ id, product: 3, quality: 2, levels: 20,   // levels yoksa ve tek satırsa bina seviyesinin tamamı
//                           cost: 1.45,                                // gerçek birim maliyetiniz (boşsa modeldeki c)
//                           price: 3.2 }] }]                           // satış fiyatınız (boşsa en kârlı fiyat r_max)
// }
//
// Çağıranın verdiği bağlam (ctx):
// {
//   saturation: { [ürün]: s },            // parseSaturation(retailInfo) çıktısı
//   weather: (ürün) => 1,                 // yalnız dondurmada 1'den farklı (w_c)
//   bonusPct: 0,                          // b: harita + yönetici satış bonusu, yüzde (retailBonusPct ile)
//   adminNet: 0,                          // net yönetim gideri (kesir); hesap.js adminInfo().net
//   qualityWeight: 0.3,                   // core.RETAIL_MODELING_QUALITY_WEIGHT
//   buildings: { G: { salaryModifier: 0.4 } },   // meta/buildings (normalizeData().buildings)
//   averageSalary: 345,                   // core.AVERAGE_SALARY
// }

import { TABLE, SALES, RETAIL_P, DEFAULT_QUALITY_WEIGHT, TREE_ID, MODELED_WAGE_FACTOR } from './perakende-veri.js';

export const MAX_QUALITY = 12;
export const HOURS_PER_DAY = 24;
const num = (x, d = 0) => (x !== null && x !== '' && x !== undefined && Number.isFinite(Number(x)) ? Number(x) : d);
const has = (x) => x !== null && x !== '' && x !== undefined && Number.isFinite(Number(x));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const toLevel = (x) => Math.max(0, Math.floor(num(x, 0)));
export const clampQuality = (q) => clamp(Math.floor(num(q, 0)), 0, MAX_QUALITY);

// ---------------------------------------------------------------------------------------------------------------
// Sabit tablo
// ---------------------------------------------------------------------------------------------------------------

/** Modelin ürün sabitleri {B, c, W, u}; modelde satılmayan ürün için null. */
export function getModel(economy, productId, quality = 0) {
  const byProduct = TABLE[Number(economy)]?.[Number(productId)];
  if (!byProduct) return null;
  const row = Number(productId) === TREE_ID ? byProduct[clampQuality(quality)] : byProduct;
  if (!Array.isArray(row)) return null;
  const [B, c, W, u] = row;
  return u > 0 ? { B, c, W, u } : null;
}

export const isRetailProduct = (economy, productId) => getModel(economy, productId, 0) !== null;
export const retailLetters = () => Object.keys(SALES);
export const buildingProducts = (letter, economy = 0) => (SALES[letter] || []).filter((id) => isRetailProduct(economy, id));
/** Ürünü satan binalar (bir ürün birden çok binada satılabilir). */
export const buildingsOf = (productId) => Object.keys(SALES).filter((l) => SALES[l].includes(Number(productId)));

// ---------------------------------------------------------------------------------------------------------------
// Canlı veriyi okuma
// ---------------------------------------------------------------------------------------------------------------

/**
 * resources-retail-info yanıtından {ürün: doygunluk}. Dizi ya da {anahtar: kayıt} gelebilir; kalite 0 kaydı tercih edilir.
 * Doygunluk sayı değilse o ürün atlanır.
 */
export function parseSaturation(info) {
  const list = Array.isArray(info) ? info : Object.values(info || {});
  const out = {};
  const fromQ0 = new Set();
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const id = Number(e.dbLetter ?? e.id ?? e.kind);
    if (!Number.isFinite(id) || !has(e.saturation)) continue;
    const isQ0 = e.quality == null || Number(e.quality) === 0;
    if (isQ0 || !fromQ0.has(id)) {
      if (isQ0) fromQ0.add(id);
      out[id] = Number(e.saturation);
    }
  }
  return out;
}

/** Hava API'sinden (api/v2/weather/{realm}/) ürün çarpanı gerekirse çağıran verir; yoksa 1. */
export const noWeather = () => 1;

/** b = ekip dışı bonus (harita vb.) + ekibin (CMO) satış hızı, yüzde. %100 ve üstü hesaplanamaz. */
export const retailBonusPct = ({ otherSpeedPct = 0, teamSalesSpeedPct = 0 } = {}) =>
  Math.max(0, num(otherSpeedPct, 0)) + Math.max(0, num(teamSalesSpeedPct, 0));

/**
 * S: bir bina seviyesinin saatlik gerçek maaşı (yönetim gideri dahil).
 * Taban maaş = salaryModifier × ortalama maaş (perakende binalarında modeldeki W'nin 1/1,1'i, birebir).
 * Bina verisi yoksa W ÷ 1,1 kullanılır.
 */
export function storeWage({ modelW, salaryModifier, averageSalary = 345, adminNet = 0 }) {
  const base = has(salaryModifier) ? Number(salaryModifier) * num(averageSalary, 345) : num(modelW, 0) / MODELED_WAGE_FACTOR;
  return base * (1 + Math.max(0, num(adminNet, 0)));
}

// ---------------------------------------------------------------------------------------------------------------
// Ara değerler
// ---------------------------------------------------------------------------------------------------------------

export const demand = (s) => Math.min(Math.max(2 - num(s, 0), 0), 2);
export const demandMultiplier = (d) => Math.max(0.9, (d + 1) / 2);
export const yValue = ({ d, B, u, q, w }) => 0.5 * RETAIL_P * d * (B * u + 1) * ((q * w) / 12 + 1);

// ---------------------------------------------------------------------------------------------------------------
// Tek ürün, tek fiyat
// ---------------------------------------------------------------------------------------------------------------
/**
 * @param {object} i  economy, productId, quality, saturation, cAct, price?, bonusPct?, weather?, qualityWeight?, wage? (S)
 * price verilmezse (null) en kârlı fiyat (r_max) kullanılır ve priceAuto = true döner.
 */
export function calcProduct(i) {
  const { economy = 0, productId, saturation, bonusPct = 0, weather = 1, qualityWeight = DEFAULT_QUALITY_WEIGHT } = i;
  const quality = clampQuality(i.quality);
  if (!(bonusPct >= 0 && bonusPct < 100)) return { ok: false, reason: 'Satış bonusu %0 ile %100 arasında olmalı' };
  const model = getModel(economy, productId, quality);
  if (!model) return { ok: false, reason: 'Bu ürün perakendede modellenmiyor' };
  if (!has(saturation)) return { ok: false, reason: 'Ürünün doygunluk verisi yok' };

  const { B, c, W, u } = model;
  const costAuto = !has(i.cAct);
  const cAct = costAuto ? c : Number(i.cAct);
  const d = demand(saturation);
  const dm = demandMultiplier(d);
  const qForY = Number(productId) === TREE_ID ? 0 : quality; // ağaç: sabitler kaliteye göre, y hep q = 0
  const y = yValue({ d, B, u, q: qForY, w: qualityWeight });
  const z = (W + y) / (u * dm);
  const S = has(i.wage) ? Number(i.wage) : storeWage({ modelW: W });
  const K = (num(weather, 1) * u * dm) / (1 - bonusPct / 100);

  const rMax = z + (c + cAct) / 2;
  const priceAuto = !has(i.price);
  const price = priceAuto ? Math.round(rMax * 100) / 100 : Number(i.price);
  const usphpl = Math.max(0, K * (2 - (price - c) / z));
  const pphpl = (price - cAct) * usphpl - S;

  // f > 0 ⇔ en kârlı fiyat maliyetin üstünde. f ≤ 0 ise (maliyet c + 2z'yi geçti) hiçbir fiyatta satış kâra geçmez:
  // satış 0 olur, kâr = −S. (Karesini almak burada eksi × eksi = artı verip zararlı ürünü kârlı gösteriyordu.)
  const f = (c - cAct) / (2 * z) + 1;
  const sellable = f > 0;
  const usphplMax = sellable ? K * f : 0;
  const pphplMax = sellable ? K * z * f * f - S : -S;

  return {
    ok: true, quality, model, d, dm, y, z, S, K,
    cAct, costAuto, price, priceAuto,
    usphpl, pphpl,
    marginHourPerLevel: (price - cAct) * usphpl, // maaş hariç: satış − mal maliyeti
    rMax, sellable, usphplMax, pphplMax,
    rZero: c + 2 * z, // bu fiyatın üstünde hiç satılmaz
    belowCost: price < cAct,
    aboveOptimum: price > rMax + 0.005,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Bina içi sıralama (en karlı ürünler)
// ---------------------------------------------------------------------------------------------------------------
/**
 * Binanın ürünlerini en kârlı fiyattaki seviye başı saatlik kâra göre sıralar; ilki best = true (yıldız).
 * Kalite karşılaştırması anlamlı olsun diye hepsi aynı kalitede (varsayılan Q0) hesaplanır.
 * costFor(ürün, kalite) gerçek birim maliyeti verir; null ise modeldeki c kullanılır (modelle kıyas).
 */
export function rankBuilding({ letter, economy = 0, ctx, quality = 0, costFor = () => null, top = 10 }) {
  const list = [];
  const S = (model) => storeWage({
    modelW: model.W, salaryModifier: ctx.buildings?.[letter]?.salaryModifier, averageSalary: ctx.averageSalary, adminNet: ctx.adminNet,
  });
  for (const productId of buildingProducts(letter, economy)) {
    const model = getModel(economy, productId, quality);
    const r = calcProduct({
      economy, productId, quality, saturation: ctx.saturation?.[productId], cAct: costFor(productId, quality),
      bonusPct: ctx.bonusPct, weather: ctx.weather ? ctx.weather(productId) : 1, qualityWeight: ctx.qualityWeight, wage: S(model),
    });
    if (!r.ok) continue;
    list.push({ productId, quality, cAct: r.cAct, costAuto: r.costAuto, rMax: r.rMax, pphplMax: r.pphplMax, usphplMax: r.usphplMax });
  }
  list.sort((a, b) => b.pphplMax - a.pphplMax);
  return list.slice(0, top).map((x, k) => ({ ...x, rank: k + 1, best: k === 0 }));
}

// ---------------------------------------------------------------------------------------------------------------
// Bütün kurulum
// ---------------------------------------------------------------------------------------------------------------
export function evaluateRetail(setup, ctx) {
  const economy = [0, 1, 2].includes(Number(setup?.economyPhase)) ? Number(setup.economyPhase) : 0;
  const buildings = [];
  const warnings = [];
  const T = { levels: 0, unitsHour: 0, revenueHour: 0, costHour: 0, wagesHour: 0, marginHour: 0, profitHour: 0 };

  for (const b of setup?.buildings || []) {
    const level = toLevel(b.level);
    const lines = [];
    const notes = [];
    if (!SALES[b.letter]) notes.push('Bu harf bir perakende binası değil');
    const single = (b.lines || []).length === 1;
    let allocated = 0;
    let wageLevelHour = null;

    for (const ln of b.lines || []) {
      const productId = Number(ln.product);
      const levels = has(ln.levels) ? toLevel(ln.levels) : single ? level : 0;
      const quality = clampQuality(ln.quality);
      const model = getModel(economy, productId, quality);
      if (SALES[b.letter] && !(SALES[b.letter] || []).includes(productId)) notes.push(`${productId} numaralı ürün bu binada satılmaz`);
      const wage = storeWage({
        modelW: model?.W, salaryModifier: ctx.buildings?.[b.letter]?.salaryModifier, averageSalary: ctx.averageSalary, adminNet: ctx.adminNet,
      });
      if (wageLevelHour == null) wageLevelHour = wage;
      const r = calcProduct({
        economy, productId, quality, saturation: ctx.saturation?.[productId], cAct: ln.cost, price: ln.price,
        bonusPct: ctx.bonusPct, weather: ctx.weather ? ctx.weather(productId) : 1, qualityWeight: ctx.qualityWeight, wage,
      });
      if (!r.ok) { lines.push({ ...ln, product: productId, quality, levels, ok: false, reason: r.reason }); continue; }
      allocated += levels;
      const unitsHour = r.usphpl * levels;
      const revenueHour = unitsHour * r.price;
      const costHour = unitsHour * r.cAct;
      const wagesHour = wage * levels;
      lines.push({
        ...ln, product: productId, quality, levels, ...r,
        unitsHour, unitsDay: unitsHour * HOURS_PER_DAY,
        revenueHour, costHour, wagesHour,
        marginHour: revenueHour - costHour,
        profitHour: revenueHour - costHour - wagesHour,
        profitDay: (revenueHour - costHour - wagesHour) * HOURS_PER_DAY,
      });
    }

    if (allocated > level) notes.push(`Satırlar ${allocated} seviye kullanıyor ama bina ${level} seviye`);
    const unallocated = Math.max(0, level - allocated);
    // Bina boş seviyelerin de maaşını öder; satış getirmezler
    const idleWagesHour = unallocated * (wageLevelHour ?? 0);
    if (unallocated > 0 && lines.length) notes.push(`${unallocated} seviyeye ürün atanmadı; maaşı yine de ödeniyor`);

    const sum = (k) => lines.reduce((t, l) => t + (l.ok === false ? 0 : l[k] || 0), 0);
    const row = {
      id: b.id, letter: b.letter, level, allocated, unallocated, notes, lines,
      unitsHour: sum('unitsHour'), revenueHour: sum('revenueHour'), costHour: sum('costHour'),
      wagesHour: sum('wagesHour') + idleWagesHour, marginHour: sum('marginHour'),
    };
    row.profitHour = row.marginHour - row.wagesHour;
    row.profitDay = row.profitHour * HOURS_PER_DAY;
    row.unitsDay = row.unitsHour * HOURS_PER_DAY;
    buildings.push(row);

    T.levels += level;
    for (const k of ['unitsHour', 'revenueHour', 'costHour', 'wagesHour', 'marginHour', 'profitHour']) T[k] += row[k];
  }

  return {
    economy, buildings, warnings,
    totals: {
      ...T,
      unitsDay: T.unitsHour * HOURS_PER_DAY,
      revenueDay: T.revenueHour * HOURS_PER_DAY,
      costDay: T.costHour * HOURS_PER_DAY,
      wagesDay: T.wagesHour * HOURS_PER_DAY,
      marginDay: T.marginHour * HOURS_PER_DAY, // Yönetim › Perakende "günlük perakende marjı" alanı için
      profitDay: T.profitHour * HOURS_PER_DAY,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Yönetici (CMO) değeri: ekip olmasaydı kurulumun marjı ne olurdu
// ---------------------------------------------------------------------------------------------------------------
/** Ekibin satış hızı payının günlük marja katkısı ($). Fiyatlar aynı kalır; yalnız satılan adet değişir. */
export function cmoValueDay(setup, ctx, { otherSpeedPct = 0, teamSalesSpeedPct = 0 } = {}) {
  const withTeam = evaluateRetail(setup, { ...ctx, bonusPct: retailBonusPct({ otherSpeedPct, teamSalesSpeedPct }) });
  const without = evaluateRetail(setup, { ...ctx, bonusPct: retailBonusPct({ otherSpeedPct }) });
  return withTeam.totals.marginDay - without.totals.marginDay;
}
