// DentSimco — Üretim hesap motoru
//
// Arayüzsüz, saf fonksiyonlar: tarayıcıda ve Node'da aynen çalışır; DOM, ağ ya da Firestore bilgisi içermez.
// Formüller oyunun kendi Üretim ve Kâr hesaplayıcısı, satış ekranı, yönetici ekranları ve Cooper's Tools ile
// karşılaştırıldı; kanıtlar test/hesap.test.mjs dosyasında. Tek yaklaşık parça, yönetici puanından yönetim gideri
// tasarrufuna geçen eğri (MANAGEMENT_CURVE).
//
// Birimler: para dolar, miktar adet. "Hour" ile biten alanlar saatlik, "Day" ile bitenler günlük (24 saat).
// Oranlar kesir olarak tutulur (0,62 = %62); kullanıcıdan gelen yüzdeler "Pct" ile biter.
//
// Kurulum (setup) biçimi — arayüz üretir, tarayıcıda realm başına saklanır:
// {
//   buildings: [{ id, type: 'L', product: 22, level: 10, quality: 0, robots: false,
//                 efficiency: 100 }],             // verimlilik yalnız maden, petrol kuyusu ve taş ocağı bolluğu için
//   recreation: { park: 3, temple: 3, lake: 3 },  // 0–3; seviye başına %1 hız (üretim ve araştırma binaları)
//   economyPhase: 0,                              // 0 Durgunluk, 1 Normal, 2 Büyüme (null: verinin fazı)
//   otherWagesDay: 0,                             // planda olmayan binaların günlük maaşı (yönetim dahil); yönetici analizi için
//   events: { [productId]: false },               // oyun olayı kapatılan ürünler (varsayılan: hepsi açık)
//   extraBonusPct: 0,                             // arayüzde YOK: yalnız oyunun kendi hesaplayıcısıyla karşılaştırma testleri
//   academyLevel: 20, otherLevels: 0,             // planda olmayan binalar da yönetim giderine girer
//   admin: { mode: 'savings' | 'net' | 'executives', savingsPct: 62, netPct: 72.65 },
//   executives: [{ name, position: 'o', salary: 225000, skills: { coo, cfo, cmo, cto }, active: true }],
//   executiveSalaryDay: 0,                        // yönetici listesi yoksa elle girilen günlük toplam maaş
//   substitution: true,                           // yüksek kalite fazlası aynı ürünün düşük kalite ihtiyacını karşılar
//   buyPolicy: 'cheapest' | 'exact',              // eksik girdi: izinli kalitelerin en ucuzu mu, tam alt kalite mi
//   buyQuality: { [productId]: quality },         // eksik girdi için elle seçilen kalite
//   prices: { 'id:q': price },                    // elle alış ve satış fiyatı (borsa fiyatının yerine)
//   contractPrices: { 'id:q': price },            // elle kontrat fiyatı (yoksa satış fiyatı)
//   keep: { 'id:q': true },                       // bu fazla üretim satılmasın
//   transportPrice: null,                         // elle taşıma fiyatı (yoksa borsadaki Taşıma Q0)
// }

export const MAX_QUALITY = 12;
export const HOURS_PER_DAY = 24;
export const MARKET_FEE = 0.04; // borsada satıcıdan kesilen komisyon
export const ROBOT_WAGE_FACTOR = 0.97; // robot kurulu binada taban maaş %3 düşer (yönetim gideri de bu tabandan)
export const ADMIN_LEVELS_PER_UNIT = 170; // brüt yönetim gideri = (toplam bina seviyesi − 1) ÷ 170
export const RECREATION_BONUS_PER_LEVEL = 0.01;
export const RECREATION_MAX_LEVEL = 3;
export const CONTRACT_TRANSPORT_SHARE = 0.5; // kontratta taşıma, borsadakinin yarısı; komisyon yok
export const DEFAULT_AVERAGE_SALARY = 345;
export const TRANSPORT_ID = 13;
export const ABUNDANCE_BUILDINGS = new Set(['M', 'O', 'Q']); // maden, petrol kuyusu, taş ocağı: verimlilik = bolluk

const BONUS_CATEGORIES = new Set(['production', 'research']);
const NO_ADMIN_CATEGORIES = new Set(['recreation']); // park, tapınak, göl yönetim giderine girmez
const EPS = 1e-9;

const num = (value, fallback = 0) => {
  const n = Number(value);
  return value != null && value !== '' && Number.isFinite(n) ? n : fallback;
};
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const sum = (list, pick) => list.reduce((total, item) => total + (pick(item) || 0), 0);
const groupBy = (list, pick) => {
  const map = new Map();
  for (const item of list) {
    const k = pick(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
};
export const qualityKey = (product, quality) => `${product}:${quality}`;
export const clampQuality = (quality) => clamp(Math.floor(num(quality, 0)), 0, MAX_QUALITY);
const toLevel = (level) => Math.max(0, Math.floor(num(level, 0)));

// ---------------------------------------------------------------------------------------------------------------
// Veri: Firestore'daki meta belgeleri (products_r{r}, buildings, core, modifiers_r{r}) tek biçime çevrilir.
// ---------------------------------------------------------------------------------------------------------------

export function normalizeData({ products = {}, buildings = {}, core = {}, modifiers = {}, realm = 0 } = {}) {
  const averageSalary = num(core.AVERAGE_SALARY, DEFAULT_AVERAGE_SALARY) || DEFAULT_AVERAGE_SALARY;
  const bld = {};
  for (const [letter, b] of Object.entries(buildings || {})) {
    if (!b) continue;
    bld[letter] = { letter, category: b.category || 'production', salaryModifier: num(b.salaryModifier, 0) };
  }
  const prod = {};
  for (const [key, p] of Object.entries(products || {})) {
    if (!p) continue;
    const id = num(p.id ?? key, NaN);
    if (!Number.isFinite(id)) continue;
    const modifier = bld[p.building]?.salaryModifier;
    prod[id] = {
      id,
      name: p.name || `#${id}`,
      building: p.building,
      inputs: (p.inputs || [])
        .map(([input, amount]) => [Number(input), Number(amount)])
        .filter(([input, amount]) => Number.isFinite(input) && amount > 0),
      perHour: num(p.perHour, 0),
      perHourRaw: num(p.perHourRaw, 0),
      baseSalary: p.baseSalary != null ? num(p.baseSalary, 0) : modifier != null ? modifier * averageSalary : 0,
      transport: num(p.transportNeeded ?? p.transport, 0),
      research: !!p.research,
      tradable: p.exchangeTradable !== false,
    };
  }
  const list = Array.isArray(modifiers) ? modifiers : modifiers?.resourceProductionModifiers || [];
  const events = list
    .filter((m) => m && (m.realm == null || Number(m.realm) === Number(realm)))
    .map((m) => ({
      product: Number(m.kind),
      pct: num(m.speedModifier, 0),
      since: m.since ? Date.parse(m.since) : -Infinity,
      until: m.until ? Date.parse(m.until) : Infinity,
    }))
    .filter((e) => Number.isFinite(e.product));
  return { realm: Number(realm), averageSalary, products: prod, buildings: bld, events, economy: detectEconomy(prod, averageSalary, core.SALARY_MID) };
}

// ---------------------------------------------------------------------------------------------------------------
// Ekonomi fazı (oyunda: Durgunluk, Normal, Büyüme; çekirdek verideki SALARY_MID 655 / 700 / 745)
// ---------------------------------------------------------------------------------------------------------------
// Faz üretim hızını değiştirir: saatlik üretim ∝ (SALARY_MID[faz] ÷ AVERAGE_SALARY) ^ (−maaş çarpanı).
// Cooper'ın üç faz ekranıyla ve oyunun yardım tablosuyla doğrulandı. Faz maaşı değiştirmez.
// Bot ansiklopediyi faz 0 (Durgunluk) için ister; verinin hangi faza ait olduğu perHour ÷ perHourRaw'dan bulunur.
// Oyunun o anki fazı veride yoktur: kullanıcı seçer.
export const ECONOMY_PHASES = ['Durgunluk', 'Normal', 'Büyüme'];

function detectEconomy(products, averageSalary, salaryMidRaw) {
  const salaryMid = [0, 1, 2].map((i) => num(salaryMidRaw?.[i], 0));
  const samples = [];
  for (const p of Object.values(products)) {
    const mod = averageSalary > 0 ? p.baseSalary / averageSalary : 0;
    if (mod >= 0.3 && p.perHourRaw > 0 && p.perHour > 0 && p.perHour < p.perHourRaw) {
      samples.push(averageSalary * Math.pow(p.perHourRaw / p.perHour, 1 / mod));
    }
  }
  if (!samples.length || salaryMid.some((v) => !(v > 0))) return { salaryMid, currentPhase: null, currentMid: null };
  samples.sort((a, b) => a - b);
  const estimate = samples[Math.floor(samples.length / 2)];
  let phase = null;
  let best = Infinity;
  salaryMid.forEach((v, i) => {
    const d = Math.abs(estimate / v - 1);
    if (d < best) { best = d; phase = i; }
  });
  if (best > 0.01) return { salaryMid, currentPhase: null, currentMid: estimate }; // beklenmeyen değer: tahmini kullan
  return { salaryMid, currentPhase: phase, currentMid: salaryMid[phase] };
}

// Seçilen faza göre üretim hızı çarpanı (fazı seçilmemişse ya da veri yoksa 1).
export function phaseSpeedFactor(data, setup, product) {
  const eco = data.economy;
  const wanted = setup?.economyPhase;
  if (wanted == null || wanted === 'auto' || !eco?.currentMid) return 1;
  const target = eco.salaryMid[Number(wanted)];
  if (!(target > 0) || !(data.averageSalary > 0)) return 1;
  const mod = product.baseSalary / data.averageSalary;
  return Math.pow(target / eco.currentMid, -mod);
}

export const buildingCategory = (data, letter) => data.buildings[letter]?.category || 'production';

// Ürüne o an etki eden oyun içi olay (üretim hızı %). Oyunda doğrulandı: +%27 → ×1,27; −%21 → ×0,79.
export function activeEventPct(data, product, now = Date.now()) {
  let pct = 0;
  for (const e of data.events) if (e.product === product && e.since <= now && now < e.until) pct += e.pct;
  return pct;
}

// ---------------------------------------------------------------------------------------------------------------
// Yönetim gideri
// ---------------------------------------------------------------------------------------------------------------

export const grossOverhead = (totalLevels) => Math.max(0, (num(totalLevels, 0) - 1) / ADMIN_LEVELS_PER_UNIT);

// Yönetim giderine giren toplam seviye: plandaki binalar (rekreasyon hariç) + akademi + planda olmayan binalar.
export function totalAdminLevels(setup, data) {
  let total = 0;
  for (const b of setup.buildings || []) {
    const letter = b.type || data.products[b.product]?.building;
    if (!NO_ADMIN_CATEGORIES.has(buildingCategory(data, letter))) total += toLevel(b.level);
  }
  return total + toLevel(setup.academyLevel) + toLevel(setup.otherLevels);
}

export function adminInfo(setup, data) {
  const totalLevels = totalAdminLevels(setup, data);
  const gross = grossOverhead(totalLevels);
  const a = setup.admin || {};
  let mode = a.mode;
  let savings;
  let net;
  let approximate = false;
  if (mode === 'net') {
    net = Math.max(0, num(a.netPct, 0) / 100);
    savings = gross > 0 ? clamp(1 - net / gross, 0, 1) : 0;
  } else if (mode === 'executives') {
    savings = managementSavingsPct(teamScores(setup.executives || []).coo) / 100;
    net = gross * (1 - savings);
    approximate = true;
  } else {
    mode = 'savings';
    savings = clamp(num(a.savingsPct, 0), 0, 100) / 100;
    net = gross * (1 - savings);
  }
  return { totalLevels, gross, savings, net, mode, approximate };
}

// ---------------------------------------------------------------------------------------------------------------
// Üretim hızı ve maaş
// ---------------------------------------------------------------------------------------------------------------

export function recreationBonus(recreation = {}) {
  const lv = (x) => clamp(Math.floor(num(x, 0)), 0, RECREATION_MAX_LEVEL);
  return (lv(recreation.park) + lv(recreation.temple) + lv(recreation.lake)) * RECREATION_BONUS_PER_LEVEL;
}

// Toplam hız bonusu (kesir). Oyunda doğrulandı: üretim = taban ÷ (1 − bonus); %5, %9, %10 ve %12 ile.
export function speedBonus(setup, category) {
  return BONUS_CATEGORIES.has(category) ? recreationBonus(setup.recreation) + num(setup.extraBonusPct, 0) / 100 : 0;
}

export function buildingRate(building, setup, data, admin, now = Date.now()) {
  const b = building || {};
  const errors = [];
  const notes = [];
  const p = data.products[b.product];
  const level = toLevel(b.level);
  const quality = clampQuality(b.quality);
  if (!p) {
    return { id: b.id, ok: false, type: b.type, product: b.product, quality, level, errors: ['Ürün seçilmedi'], notes,
      hourly: 0, daily: 0, wageHour: 0, wageDayGross: 0, wageDayNet: 0 };
  }
  const type = b.type || p.building;
  if (b.type && b.type !== p.building) errors.push(`${p.name} bu binada üretilmez`);
  const category = buildingCategory(data, type);
  const eventOn = b.event !== false && setup.events?.[p.id] !== false; // olay ürüne göre açılıp kapanır
  const eventPct = eventOn ? activeEventPct(data, p.id, now) : 0;
  const efficiency = clamp(num(b.efficiency, 100), 0, 200) / 100;
  const bonus = speedBonus(setup, category);
  const phaseFactor = phaseSpeedFactor(data, setup, p);
  if (bonus >= 1) errors.push('Üretim hızı bonusu %100 veya üzeri olamaz');
  const robots = !!b.robots && category !== 'research';
  if (b.robots && category === 'research') notes.push('Araştırma binalarına robot kurulamaz; robot yok sayıldı');
  const ok = errors.length === 0;
  const perLevelHour = ok ? (p.perHour * phaseFactor * (1 + eventPct / 100) * efficiency) / (1 - bonus) : 0;
  const hourly = perLevelHour * level;
  const wageHour = p.baseSalary * level * (robots ? ROBOT_WAGE_FACTOR : 1); // olay, bonus ve verimlilik maaşı değiştirmez
  const unitWorker = hourly > 0 ? wageHour / hourly : null;
  return {
    id: b.id, ok, type, category, product: p.id, quality, level, robots, eventPct, efficiency, bonus, phaseFactor,
    perLevelHour, hourly, daily: hourly * HOURS_PER_DAY,
    wageHour,
    wageDayGross: wageHour * HOURS_PER_DAY * (1 + admin.gross),
    wageDayNet: wageHour * HOURS_PER_DAY * (1 + admin.net),
    unitWorker,
    unitAdmin: unitWorker == null ? null : unitWorker * admin.net,
    unitLabor: unitWorker == null ? null : unitWorker * (1 + admin.net),
    hoursPerUnit: hourly > 0 ? 1 / hourly : null,
    errors, notes,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Kalite, fiyat ve satış
// ---------------------------------------------------------------------------------------------------------------

// Qn ürün için girdi en az Q(n−1) olmalı (Q0 için Q0); üstü de olur.
export const minInputQuality = (quality) => Math.max(0, clampQuality(quality) - 1);
export function allowedQualities(minQuality) {
  const out = [];
  for (let q = clampQuality(minQuality); q <= MAX_QUALITY; q++) out.push(q);
  return out;
}

// Satıcının birim başına eline geçen: borsada komisyon ve taşıma düşer; kontratta yarım taşıma, komisyon yok.
export function saleUnitNet(price, transportUnits, transportPrice, channel = 'exchange') {
  const transport = num(transportUnits, 0) * num(transportPrice, 0);
  if (channel === 'contract') return num(price, 0) - CONTRACT_TRANSPORT_SHARE * transport;
  return num(price, 0) * (1 - MARKET_FEE) - transport;
}

// market: (id, q) => fiyat fonksiyonu, { price(id, q) } nesnesi ya da { 'id:q': fiyat } haritası.
function makePriceLookup(setup, market) {
  const overrides = setup.prices || {};
  const base =
    typeof market === 'function' ? market
      : typeof market?.price === 'function' ? (id, q) => market.price(id, q)
        : (id, q) => market?.[qualityKey(id, q)];
  return (id, q) => {
    const manual = overrides[qualityKey(id, q)];
    if (manual != null && manual !== '' && Number.isFinite(Number(manual)) && Number(manual) >= 0) {
      return { price: Number(manual), source: 'manual' };
    }
    const value = base(id, q);
    return value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? { price: Number(value), source: 'market' } : null;
  };
}

function purchaseChoice(product, minQuality, setup, priceOf) {
  const forced = setup.buyQuality?.[product];
  if (forced != null && forced !== '') {
    const q = Math.max(clampQuality(forced), minQuality);
    const found = priceOf(product, q);
    return { quality: q, price: found?.price ?? null, source: found?.source ?? null, forced: true };
  }
  const qualities = setup.buyPolicy === 'exact' ? [minQuality] : allowedQualities(minQuality);
  let best = null;
  for (const q of qualities) {
    const found = priceOf(product, q);
    if (found && (!best || found.price < best.price)) best = { quality: q, price: found.price, source: found.source };
  }
  return best || { quality: minQuality, price: null, source: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Tarif zinciri
// ---------------------------------------------------------------------------------------------------------------

// Girdiler önce gelecek şekilde sıralar (tarifler döngüsüz; döngü varsa hata verir).
export function topoOrder(ids, data) {
  const state = new Map();
  const out = [];
  const visit = (id) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) throw new Error(`Tariflerde döngü var (ürün ${id})`);
    state.set(id, 1);
    for (const [input] of data.products[id]?.inputs || []) visit(input);
    state.set(id, 2);
    out.push(id);
  };
  for (const id of ids) visit(id);
  return out;
}

// Bir ürünün tüm alt girdileri, her şeyi kendin üretirsen gereken miktar ve seviye-1 bina saati.
export function chainTotals(product, qty, data, setup = {}) {
  const order = topoOrder([product], data).reverse(); // tüketiciler önce
  const need = new Map([[product, qty]]);
  for (const id of order) {
    const n = need.get(id) || 0;
    for (const [input, amount] of data.products[id]?.inputs || []) need.set(input, (need.get(input) || 0) + amount * n);
  }
  need.delete(product);
  return [...need].map(([id, amount]) => ({
    product: id,
    qty: amount,
    levelHours: data.products[id]?.perHour > 0 ? amount / (data.products[id].perHour * phaseSpeedFactor(data, setup, data.products[id])) : null,
  }));
}

// "+N" düğmesi: eksik saatlik miktarı karşılamak için gereken bina seviyesi (verimlilik %100, aktif olay dahil).
export function quickAdd(product, quality, missingPerHour, setup, data, now = Date.now()) {
  const p = data.products[product];
  if (!p || !(p.perHour > 0) || !(missingPerHour > 0)) return null;
  const bonus = speedBonus(setup, buildingCategory(data, p.building));
  if (bonus >= 1) return null;
  const eventPct = setup.events?.[product] === false ? 0 : activeEventPct(data, product, now);
  const perLevelHour = (p.perHour * phaseSpeedFactor(data, setup, p) * (1 + eventPct / 100)) / (1 - bonus);
  return { type: p.building, product, quality: clampQuality(quality), perLevelHour,
    levels: Math.max(1, Math.ceil(missingPerHour / perLevelHour - 1e-9)) };
}

// "Otomatik kalite": girdi üreten her binayı, tükettiği binaların en yüksek kalitesinin bir altına ayarlar.
export function autoQuality(setup, data) {
  const buildings = (setup.buildings || []).map((b) => ({ ...b }));
  for (let pass = 0; pass <= buildings.length + 1; pass++) {
    const need = new Map();
    for (const b of buildings) {
      const p = data.products[b.product];
      if (!p) continue;
      const q = minInputQuality(b.quality);
      for (const [input] of p.inputs) need.set(input, Math.max(need.get(input) ?? 0, q));
    }
    let changed = false;
    for (const b of buildings) {
      if (!need.has(b.product)) continue;
      const q = need.get(b.product);
      if (clampQuality(b.quality) !== q) {
        b.quality = q;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { ...setup, buildings };
}

// ---------------------------------------------------------------------------------------------------------------
// Planın tamamı: üretim, girdi dağıtımı, alımlar, birim maliyetler, satışlar ve günlük toplamlar
// ---------------------------------------------------------------------------------------------------------------

export function evaluatePlan(setup = {}, data, market = null, { now = Date.now() } = {}) {
  const admin = adminInfo(setup, data);
  const priceOf = makePriceLookup(setup, market);
  const substitution = setup.substitution !== false;
  const warnings = [];
  const nameOf = (id) => data.products[id]?.name || `#${id}`;

  // 1) Binalar
  const rows = (setup.buildings || []).map((b, index) =>
    buildingRate({ ...b, id: b.id ?? `b${index + 1}` }, setup, data, admin, now));
  for (const r of rows) for (const text of r.errors) warnings.push({ kind: 'building', building: r.id, text });

  // 2) Arz havuzları: aynı ürün ve kalitedeki binalar birlikte
  const pools = new Map();
  rows.forEach((r, index) => {
    if (!r.ok || !(r.daily > 0)) return;
    const key = qualityKey(r.product, r.quality);
    let pool = pools.get(key);
    if (!pool) {
      pool = { key, product: r.product, quality: r.quality, producedDay: 0, usedDay: 0, levels: 0, laborDay: 0, inputCostDay: 0, unitCost: 0, rows: [] };
      pools.set(key, pool);
    }
    pool.producedDay += r.daily;
    pool.levels += r.level;
    pool.laborDay += r.wageDayNet;
    pool.rows.push(index);
  });

  // 3) Girdi talepleri
  const demands = [];
  rows.forEach((r, index) => {
    if (!r.ok || !(r.daily > 0)) return;
    for (const [input, amount] of data.products[r.product].inputs) {
      demands.push({ row: index, product: input, minQuality: minInputQuality(r.quality), qty: amount * r.daily, own: [], buyQty: 0 });
    }
  });

  // 4) Kendi üretimini dağıt: en yüksek kalite isteyen önce, ona yeten en düşük kaliteden (ikame kapalıysa tam kalite)
  for (const [product, list] of groupBy(demands, (d) => d.product)) {
    const cap = [];
    for (let q = 0; q <= MAX_QUALITY; q++) cap.push(pools.get(qualityKey(product, q))?.producedDay || 0);
    list.sort((a, b) => b.minQuality - a.minQuality);
    for (const d of list) {
      let rest = d.qty;
      const top = substitution ? MAX_QUALITY : d.minQuality;
      for (let q = d.minQuality; q <= top && rest > EPS; q++) {
        const take = Math.min(cap[q], rest);
        if (take > EPS) {
          d.own.push({ quality: q, qty: take });
          cap[q] -= take;
          rest -= take;
        }
      }
      d.buyQty = rest > EPS * Math.max(1, d.qty) ? rest : 0;
    }
    for (let q = 0; q <= MAX_QUALITY; q++) {
      const pool = pools.get(qualityKey(product, q));
      if (pool) pool.usedDay = pool.producedDay - cap[q];
    }
  }

  // 5) Kalan ihtiyaç borsadan alınır (ürün ve alt kalite başına)
  const purchaseMap = new Map();
  for (const d of demands) {
    if (!(d.buyQty > 0)) continue;
    const key = qualityKey(d.product, d.minQuality);
    if (!purchaseMap.has(key)) purchaseMap.set(key, { key, product: d.product, minQuality: d.minQuality, qtyDay: 0 });
    purchaseMap.get(key).qtyDay += d.buyQty;
  }
  const purchases = [...purchaseMap.values()].map((g) => {
    const choice = purchaseChoice(g.product, g.minQuality, setup, priceOf);
    if (choice.price == null) {
      warnings.push({ kind: 'price', product: g.product, quality: g.minQuality,
        text: `${nameOf(g.product)} (Q${g.minQuality} ve üstü) için alış fiyatı yok; elle girin` });
    }
    return {
      ...g,
      quality: choice.quality,
      price: choice.price,
      priceSource: choice.source,
      costDay: choice.price == null ? 0 : choice.price * g.qtyDay,
      suggestion: quickAdd(g.product, g.minQuality, g.qtyDay / HOURS_PER_DAY, setup, data, now),
    };
  });
  const buyPrice = new Map(purchases.map((p) => [p.key, p.price ?? 0]));

  // 6) Birim maliyet: girdiler önce (kendi ürettiğin girdi kendi maliyetiyle, alınan borsa fiyatıyla)
  const demandsByRow = groupBy(demands, (d) => d.row);
  const poolsByProduct = groupBy([...pools.values()], (p) => p.product);
  const involved = new Set([...pools.values()].map((p) => p.product));
  for (const d of demands) involved.add(d.product);
  for (const product of topoOrder([...involved], data)) {
    for (const pool of poolsByProduct.get(product) || []) {
      let inputCost = 0;
      for (const rowIndex of pool.rows) {
        for (const d of demandsByRow.get(rowIndex) || []) {
          for (const part of d.own) inputCost += part.qty * pools.get(qualityKey(d.product, part.quality)).unitCost;
          inputCost += d.buyQty * (buyPrice.get(qualityKey(d.product, d.minQuality)) ?? 0);
        }
      }
      pool.inputCostDay = inputCost;
      pool.unitCost = (pool.laborDay + inputCost) / pool.producedDay;
    }
  }

  // 7) Fazla üretim satılır: borsa ve kontrat ayrı ayrı
  const manualTransport = setup.transportPrice;
  const transport = manualTransport != null && manualTransport !== '' && Number.isFinite(Number(manualTransport))
    ? { price: Number(manualTransport), source: 'manual' } : priceOf(TRANSPORT_ID, 0);
  const transportPrice = transport?.price ?? null;
  let transportWarned = false;
  const sales = [];
  const kept = [];
  for (const pool of pools.values()) {
    const surplusDay = pool.producedDay - pool.usedDay;
    if (!(surplusDay > EPS * Math.max(1, pool.producedDay))) continue;
    const p = data.products[pool.product];
    const base = { key: pool.key, product: pool.product, quality: pool.quality, surplusDay, producedDay: pool.producedDay, levels: pool.levels, unitCost: pool.unitCost };
    if (setup.keep?.[pool.key]) {
      kept.push(base);
      continue;
    }
    const sale = priceOf(pool.product, pool.quality);
    const price = sale?.price ?? null;
    const manualContract = setup.contractPrices?.[pool.key];
    const contractPrice = manualContract != null && manualContract !== '' && Number.isFinite(Number(manualContract)) ? Number(manualContract) : price;
    if (price == null) warnings.push({ kind: 'price', product: pool.product, quality: pool.quality, text: `${nameOf(pool.product)} Q${pool.quality} için satış fiyatı yok; elle girin` });
    if (p.transport > 0 && transportPrice == null && !transportWarned) {
      warnings.push({ kind: 'transport', text: 'Taşıma fiyatı yok; satış gelirinden taşıma düşülmedi' });
      transportWarned = true;
    }
    const tp = transportPrice ?? 0;
    const exchangeUnit = price == null ? null : saleUnitNet(price, p.transport, tp, 'exchange');
    const contractUnit = contractPrice == null ? null : saleUnitNet(contractPrice, p.transport, tp, 'contract');
    const levelShare = (pool.levels * surplusDay) / pool.producedDay; // satılan kısmı üreten seviye
    const profitDay = (unit) => (unit == null ? null : surplusDay * (unit - pool.unitCost));
    const pphpl = (day) => (day == null || !(levelShare > 0) ? null : day / HOURS_PER_DAY / levelShare);
    const profitExchangeDay = profitDay(exchangeUnit);
    const profitContractDay = profitDay(contractUnit);
    const beforeFeesDay = profitDay(price); // oyunun Kâr hesaplayıcısı gibi: komisyon ve taşıma hariç
    sales.push({
      ...base,
      price, priceSource: sale?.source ?? null, contractPrice,
      transportUnits: p.transport, transportPrice,
      exchangeUnit, contractUnit,
      revenueExchangeDay: exchangeUnit == null ? null : surplusDay * exchangeUnit,
      revenueContractDay: contractUnit == null ? null : surplusDay * contractUnit,
      profitExchangeDay, profitContractDay,
      beforeFeesUnit: price == null ? null : price - pool.unitCost,
      pphplExchange: pphpl(profitExchangeDay),
      pphplContract: pphpl(profitContractDay),
      pphplBeforeFees: pphpl(beforeFeesDay),
    });
  }

  // 8) Günlük toplamlar
  const executives = setup.executives || [];
  const executiveSalariesDay = executives.length ? sum(executives, (e) => num(e.salary, 0)) : num(setup.executiveSalaryDay, 0);
  const purchasesDay = sum(purchases, (p) => p.costDay);
  const wagesDayNet = sum(rows, (r) => (r.ok ? r.wageDayNet : 0));
  const wagesDayGross = sum(rows, (r) => (r.ok ? r.wageDayGross : 0));
  const wageBaseDay = sum(rows, (r) => (r.ok ? r.wageHour * HOURS_PER_DAY : 0));
  const costDay = purchasesDay + wagesDayNet;
  const revenueExchangeDay = sum(sales, (s) => s.revenueExchangeDay);
  const revenueContractDay = sum(sales, (s) => s.revenueContractDay);
  const profitExchangeDay = revenueExchangeDay - costDay;
  const profitContractDay = revenueContractDay - costDay;
  return {
    admin, rows, pools: [...pools.values()], demands, purchases, sales, kept, transportPrice, warnings,
    totals: {
      purchasesDay, wagesDayNet, wagesDayGross, wageBaseDay,
      executiveSavingsDay: wagesDayGross - wagesDayNet, // yöneticilerin bu binaların maaşında kazandırdığı
      executiveSalariesDay, costDay,
      revenueExchangeDay, revenueContractDay,
      profitExchangeDay, profitContractDay, // yönetici maaşları hariç
      netCashExchangeDay: profitExchangeDay - executiveSalariesDay,
      netCashContractDay: profitContractDay - executiveSalariesDay,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Yöneticiler
// ---------------------------------------------------------------------------------------------------------------
// Pozisyon kodları (oyunun API'si): o COO, f CFO, m CMO, t CTO; v, x, y, z sırasıyla stajyerleri; rakamlar personel.
// Beceri anahtarları: coo = yönetim, cfo = muhasebe, cmo = iletişim, cto = bilim.
// Takım puanı (oyunda doğrulandı): ana pozisyon kendi alanında ×1, diğer alanlarda ×0,25; stajyer yalnız kendi
// alanında ×0,5; personel katkı vermez; eğitimde, yerleşmekte veya grevde olan sayılmaz.

export const EXEC_MAIN = { o: 'coo', f: 'cfo', m: 'cmo', t: 'cto' };
export const EXEC_APPRENTICE = { v: 'coo', x: 'cfo', y: 'cmo', z: 'cto' };
export const SKILLS = ['coo', 'cfo', 'cmo', 'cto'];

export function execKind(position) {
  const p = String(position ?? '');
  if (EXEC_MAIN[p]) return { kind: 'main', role: EXEC_MAIN[p] };
  if (EXEC_APPRENTICE[p]) return { kind: 'apprentice', role: EXEC_APPRENTICE[p] };
  if (/^\d+$/.test(p)) return { kind: 'staff', role: null };
  return { kind: 'unknown', role: null };
}

export function skillWeight(position, skill) {
  const { kind, role } = execKind(position);
  if (kind === 'main') return role === skill ? 1 : 0.25;
  if (kind === 'apprentice') return role === skill ? 0.5 : 0;
  return 0;
}

export function teamScores(executives = []) {
  const out = { coo: 0, cfo: 0, cmo: 0, cto: 0 };
  for (const e of executives) {
    if (!e || e.active === false) continue;
    for (const skill of SKILLS) out[skill] += skillWeight(e.position, skill) * num(e.skills?.[skill], 0);
  }
  return out;
}

// Yönetim puanı → yönetim gideri tasarrufu. Oyun etkin puanı tam sayıya indiriyor; 60'a kadar puan = tasarruf (%),
// 60 üstünde azalan getiri (oyuncu bilgisi). Eğrinin 60 sonrası biçimi beş oyuncu ölçümüne uydurulmuş bir yaklaşım;
// ölçümlerle birebir tutuyor, arada ±1 puan sapabilir.
export const MANAGEMENT_CURVE = { knee: 60, span: 22.3, scale: 35.85 };

export function managementSavingsRaw(score) {
  const x = Math.max(0, num(score, 0));
  const { knee, span, scale } = MANAGEMENT_CURVE;
  return x <= knee ? x : knee + span * (1 - Math.exp(-(x - knee) / scale));
}

export const managementSavingsPct = (score) => Math.floor(managementSavingsRaw(Math.floor(num(score, 0))) + 1e-9);

// Oyunun /api/v3/companies/{id}/executives/ çıktısını okur. Beceri ve maaş yalnız kendi şirketin çıktısında bulunur.
export function parseExecutives(input, now = Date.now()) {
  const obj = typeof input === 'string' ? JSON.parse(input) : input;
  const list = Array.isArray(obj) ? obj : obj?.executives || [];
  return list.map((e) => {
    const training = !!e.currentTraining;
    const strike = e.strikeUntil ? Date.parse(e.strikeUntil) > now : false;
    return {
      id: e.id,
      name: e.name || '',
      position: String(e.currentWorkHistory?.position ?? e.position ?? ''),
      salary: num(e.salary, 0),
      salaryKnown: e.salary != null,
      skills: { coo: num(e.skills?.coo, 0), cfo: num(e.skills?.cfo, 0), cmo: num(e.skills?.cmo, 0), cto: num(e.skills?.cto, 0) },
      skillsKnown: !!e.skills,
      active: !training && !strike,
      status: training ? 'training' : strike ? 'strike' : 'active',
    };
  });
}

// Yöneticilerin para karşılığı: planın binalarındaki maaş tasarrufu, yöneticilerin maaşıyla karşılaştırılır.
// Takım toplamı, oyundan girilen tasarruf oranıyla kesindir; kişi başı değerler eğriden hesaplanan farklarla bulunur.
// scope 'company': planda olmayan binaların günlük maaşı (setup.otherWagesDay, yönetim gideri dahil) da tabana eklenir.
export function executiveAnalysis(setup, data, plan, { scope = 'plan' } = {}) {
  const executives = setup.executives || [];
  const { gross, savings, net } = plan.admin;
  const otherBaseDay = scope === 'company' ? Math.max(0, num(setup.otherWagesDay, 0)) / (1 + net) : 0;
  const baseDay = plan.totals.wageBaseDay + otherBaseDay; // yönetim gideri eklenmemiş günlük maaş tabanı
  const moneyPerPct = (baseDay * gross) / 100; // tasarruftaki her %1'in günlük değeri
  const scores = teamScores(executives);
  const curveNow = managementSavingsPct(scores.coo);
  const members = executives.map((e, index) => {
    const others = executives.filter((_, j) => j !== index);
    const dropPct = curveNow - managementSavingsPct(teamScores(others).coo);
    const valueDay = e.active === false ? 0 : Math.max(0, Math.min(savings * 100, dropPct)) * moneyPerPct;
    let ifActiveValueDay = null;
    if (e.active === false) {
      const activated = executives.map((x, j) => (j === index ? { ...x, active: true } : x));
      ifActiveValueDay = (managementSavingsPct(teamScores(activated).coo) - curveNow) * moneyPerPct;
    }
    const weight = skillWeight(e.position, 'coo');
    const perPointDay = e.active === false || weight === 0 ? 0
      : (managementSavingsRaw(scores.coo + weight) - managementSavingsRaw(scores.coo)) * moneyPerPct;
    const salary = num(e.salary, 0);
    return {
      index, name: e.name, position: e.position, ...execKind(e.position), active: e.active !== false, salary, weight,
      valueDay, // bu yönetici bugün ayrılsa kaybedilecek günlük maaş tasarrufu (en fazla ödemeye değer maaş)
      netDay: valueDay - salary,
      ratio: salary > 0 ? valueDay / salary : null,
      ifActiveValueDay, // eğitimi bitip göreve başlayınca eklenecek günlük tasarruf
      perPointDay, // yönetim becerisi +1 olursa günlük ek tasarruf (yaklaşık)
    };
  });
  const teamValueDay = baseDay * gross * savings;
  const salariesDay = sum(executives, (e) => num(e.salary, 0));
  return {
    scope, scores, curvePct: curveNow, savings, gross, baseDay, otherBaseDay, moneyPerPct,
    teamValueDay, salariesDay, teamNetDay: teamValueDay - salariesDay,
    exact: plan.admin.mode !== 'executives', // takım toplamı oyundan girilen orana dayanıyorsa kesin
    members,
  };
}
