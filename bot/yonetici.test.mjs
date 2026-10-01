// DentSimco — yönetici simülasyonu testleri. Çalıştırma: node test/yonetici.test.mjs
// Patent ve araştırma değerleri Cooper's Tools ekranlarından (Alüminyum, Portakal suyu), ekip etkileri oyundaki
// "Ekibinizin etkisi" ekranlarından; para karşılıkları elle hesaplanmış örneklerle sınanır.

import * as Y from '../public/yonetici.js';
import * as H from '../public/hesap.js';

const results = [];
let group = '';
const section = (name) => { group = name; };
function test(name, fn) {
  try { fn(); results.push({ group, name, ok: true }); } catch (e) { results.push({ group, name, ok: false, error: e.message }); }
}
function near(actual, expected, decimals, label = '') {
  const tol = 0.5 * 10 ** -decimals + 1e-9;
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`${label} beklenen ${expected}, bulunan ${actual}`);
}
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} beklenen ${b}, bulunan ${a}`);
}
function ok(value, label = 'koşul sağlanmadı') { if (!value) throw new Error(label); }

const ex = (name, position, salary, coo, cfo, cmo, cto, active = true) => ({ name, position, salary, skills: { coo, cfo, cmo, cto }, active });
const DENTIUM = [
  ex('Marie Flores', 'o', 225000, 50, 10, 17, 9), ex('Ann Edwards', 'm', 2323, 12, 6, 5, 4, false),
  ex('Nicholas Cook', 't', 7500, 26, 4, 3, 18), ex('Matthew Watson', 'v', 60000, 24, 5, 6, 7),
  ex('Sandra Johnson', '1', 1399, 4, 5, 4, 4, false), ex('Gloria Cook', 'f', 1993, 5, 13, 5, 6),
  ex('Sota Hara', 'x', 2103, 5, 8, 4, 4, false),
];
const CTO60 = [ex('Bilimci', 't', 5000, 0, 0, 0, 60)];

// =====================================================================================================
section('Cooper · Patent tablosu');
test('Basamak başı patent: Q0→Q1 12 … Q11→Q12 50.000', () => {
  eq([...Array(12).keys()].map((q) => Y.patentsNeeded(q, q + 1)), [12, 50, 500, 2000, 5000, 10000, 10000, 10000, 10000, 10000, 50000, 50000]);
});
test('Q0→Q5: 7.562 patent', () => eq(Y.patentsNeeded(0, 5), 7562));
test('Q0→Q9: 47.562 patent (Cooper)', () => eq(Y.patentsNeeded(0, 9), 47562));
test('Portakal suyu Q4→Q7: 25.000 patent (Cooper)', () => eq(Y.patentsNeeded(4, 7), 25000));
test('Hedef mevcuttan küçükse 0', () => eq(Y.patentsNeeded(7, 4), 0));

section('Cooper · Patent olasılığı ve araştırma');
test('Bilim 0 → %6,25; bilim 60 → %10', () => {
  eq(Y.patentChancePct(H.teamEffects([])), 6.25);
  eq(Y.patentChancePct(H.teamEffects(CTO60)), 10);
});
test('Dentium (etkili bilim 21) → %6,25 + %1,3125', () => near(Y.patentChancePct(H.teamEffects(DENTIUM)), 7.5625, 4));
test('Sağlama Q0→Q5: bilim 0 → 120.992, bilim 60 → 75.620 araştırma', () => {
  eq([Y.researchNeeded(7562, 6.25), Y.researchNeeded(7562, 10)], [120992, 75620]);
});
test('Cooper Q0→Q9, %10: 475.620 araştırma', () => eq(Y.researchNeeded(47562, 10), 475620));
test('Alüminyum (Kimya araştırması $88,5986), %10: Q0→Q1 $10.631,83, Q5→Q6 $8.859.860, Q11→Q12 $44.299.300', () => {
  const p = Y.upgradePlan([
    { from: 0, to: 1, price: 88.5986 }, { from: 5, to: 6, price: 88.5986 }, { from: 11, to: 12, price: 88.5986 },
  ], H.teamEffects(CTO60));
  near(p.rows[0].cost, 10631.832, 2); near(p.rows[1].cost, 8859860, 2); near(p.rows[2].cost, 44299300, 2);
  eq(p.rows.map((x) => x.research), [120, 100000, 500000]);
});
test('Portakal suyu Q4→Q7 (Yemek tarifi $127,9067), %10: 250.000 araştırma, $31.976.675', () => {
  const p = Y.upgradePlan([{ from: 4, to: 7, price: 127.9067 }], H.teamEffects(CTO60));
  eq([p.patents, p.research], [25000, 250000]);
  near(p.cost, 31976675, 2);
});
test('Araştırma tam adet: olasılık %7,5625 → yukarı yuvarlanır', () => {
  eq(Y.researchNeeded(12, 7.5625), Math.ceil(12 / 0.075625));
});
test('Fiyatı olmayan satır maliyete katılmaz, işaretlenir', () => {
  const p = Y.upgradePlan([{ from: 0, to: 1, price: null }, { from: 0, to: 1, price: 100 }], H.teamEffects([]));
  eq([p.cost, p.missingPrice], [192 * 100, true]);
});

// =====================================================================================================
section('Para karşılığı · tek yönetici');
test('COO 50: 171 seviye (brüt %100), ödenen $150.000/gün → taban $100.000, tasarruf $50.000/gün', () => {
  const s = Y.executiveSimulation({ executives: [ex('Y', 'o', 20000, 50, 0, 0, 0)], admin: { totalLevels: 171, wagesDay: 150000 } });
  near(s.bases.wageBaseDay, 100000, 4);
  near(s.sectors.coo, 50000, 4);
  near(s.members[0].by.coo, 50000, 4);
  near(s.members[0].netDay, 30000, 4);
});
test('CMO 30 (+%10 satış hızı): marj $110.000/gün → katkı $10.000/gün', () => {
  const s = Y.executiveSimulation({ executives: [ex('P', 'm', 1000, 0, 0, 30, 0)], retail: { marginDay: 110000 } });
  eq(s.team.salesSpeedPct, 10);
  near(s.sectors.cmo, 10000, 4);
  near(s.members[0].by.cmo, 10000, 4);
});
test('CMO: ekip dışı %20 satış hızı varken marj $130.000 → katkı $10.000', () => {
  const s = Y.executiveSimulation({ executives: [ex('P', 'm', 1000, 0, 0, 30, 0)], retail: { marginDay: 130000, otherSpeedPct: 20 } });
  near(s.sectors.cmo, 10000, 4);
});
test('CTO 60 (+%120): çarpan mantığı, 40.614 araştırma × $100 → katkı = üretim × 120 ÷ 220', () => {
  const s = Y.executiveSimulation({ executives: [ex('B', 't', 1000, 0, 0, 0, 60)], research: { outputDay: 40614, price: 100 } });
  eq(s.team.researchSpeedPct, 120);
  near(s.sectors.cto, 40614 * 100 * 120 / 220, 2); // ekipsiz üretim 18.461 → ekip günde 22.153 adet ekliyor
});
test('CTO 30 (+%60 araştırma hızı): günde 160 araştırma × $100 → katkı $6.000/gün', () => {
  const s = Y.executiveSimulation({ executives: [ex('B', 't', 1000, 0, 0, 0, 30)], research: { outputDay: 160, price: 100 } });
  eq(s.team.researchSpeedPct, 60);
  near(s.sectors.cto, 6000, 4);
});
test('CTO 60, Q0→Q5 araştırma $100: plan $7.562.000, yöneticisiz $12.099.200, tasarruf $4.537.200 (tek seferlik)', () => {
  const s = Y.executiveSimulation({ executives: CTO60, research: { upgrades: [{ from: 0, to: 5, price: 100 }] } });
  eq([s.plan.cost, s.planWithout.cost, s.upgradeSaving], [7562000, 12099200, 4537200]);
  eq(s.members[0].upgradeSaving, 4537200);
});
test('CFO: Dentium, $4,49M nakit → yöneticisiz vergi $7.466, ekip vergisi 0', () => {
  const s = Y.executiveSimulation({ executives: DENTIUM, finance: { cash: 4493226 } });
  near(s.tax.withoutDay, 7466.13, 2);
  eq([s.tax.day, s.tax.threshold], [0, 11e6]);
  near(s.sectors.cfo, 7466.13, 2);
});
test('Bono: alınan bono vergiye girer, ihraç edilen düşer', () => {
  const s = Y.executiveSimulation({ finance: { cash: 3e6, bondsBought: 3e6, bondsIssued: 1e6 } });
  eq([s.tax.assets, s.tax.withoutDay], [5e6, 10000]);
});

section('Para karşılığı · ekip');
test('Dentium: dört alan birden; günlük toplam = alanların toplamı, net = toplam − maaşlar', () => {
  const s = Y.executiveSimulation({
    executives: DENTIUM, finance: { cash: 14e6 }, admin: { totalLevels: 340, wagesDay: 200000 },
    retail: { marginDay: 50000 }, research: { outputDay: 100, price: 90 },
  });
  near(s.day, s.sectors.coo + s.sectors.cfo + s.sectors.cmo + s.sectors.cto, 6);
  near(s.netDay, s.day - 300318, 6);
  eq(s.team.adminSavingsPct, 64);
  ok(s.sectors.coo > 0 && s.sectors.cfo > 0 && s.sectors.cmo > 0 && s.sectors.cto > 0, 'dört alan da pozitif olmalı');
});
test('Kişi başı: aktif olanların alanları toplanır; eğitimdekilerin bugünkü katkısı 0', () => {
  const s = Y.executiveSimulation({ executives: DENTIUM, finance: { cash: 14e6 }, admin: { totalLevels: 340, wagesDay: 200000 } });
  for (const m of s.members) {
    if (m.active) near(m.day, m.by.coo + m.by.cfo + m.by.cmo + m.by.cto, 6);
    else eq(m.day, 0);
  }
});
test('Eğitimdeki CFO stajyeri (Sota Hara) başlayınca vergi kazancı hesaplanır', () => {
  const s = Y.executiveSimulation({ executives: DENTIUM, finance: { cash: 30e6 } });
  const sota = s.members.find((m) => m.name === 'Sota Hara');
  ok(sota.ifActive.by.cfo > 0, 'stajyer başlayınca eşik yükselir');
});
test('Bilimci (Nicholas Cook) ayrılırsa araştırma hızı ve patent olasılığı düşer', () => {
  const s = Y.executiveSimulation({ executives: DENTIUM, research: { outputDay: 100, price: 90, upgrades: [{ from: 0, to: 5, price: 90 }] } });
  const n = s.members.find((m) => m.name === 'Nicholas Cook');
  ok(n.effects.researchSpeedPct >= 36, `araştırma hızı kaybı: ${n.effects.researchSpeedPct}`);
  ok(n.by.cto > 0 && n.upgradeSaving > 0, 'araştırmada katkı olmalı');
});
test('Girdi yoksa para karşılığı 0, maaşlar yine sayılır', () => {
  const s = Y.executiveSimulation({ executives: DENTIUM });
  eq([s.day, s.salariesDay], [0, 300318]);
});

section('Kayıt');
test('Hedef kalite mevcuttan küçük girilirse mevcuda eşitlenir; Q en çok 12', () => {
  const c = Y.sanitizeCompany({ research: { upgrades: [{ from: 7, to: 3 }, { from: 2, to: 99 }] } });
  eq(c.research.upgrades.map((u) => [u.from, u.to]), [[7, 7], [2, 12]]);
});
test('Banka seviyesi en çok 40, eksi değerler 0', () => {
  const c = Y.sanitizeCompany({ finance: { cash: -5, bankLevel: 99 } });
  eq([c.finance.cash, c.finance.bankLevel], [0, 40]);
});
test('Üretim kurulumundan taşıma: yöneticiler ve nakit gelir; boşsa null', () => {
  const c = Y.companyFromUretim({ executives: DENTIUM, finance: { cash: 5e6, bondsBought: 1e6 } });
  eq([c.executives.length, c.finance.cash, c.finance.bondsBought], [7, 5e6, 1e6]);
  eq(Y.companyFromUretim({ executives: [], finance: {} }), null);
});

section('Ortak şirket kaydı (Üretim ve Yönetim aynı kaydı okur)');
function withStorage(initial, fn) {
  const store = { ...initial };
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  try { return fn(store); } finally { delete globalThis.localStorage; }
}
test('Kayıt yoksa boş şirket; kaydedilen kayıt geri okunur, banka seviyesi 40 ile sınırlı', () => {
  withStorage({}, () => {
    eq(Y.loadCompanyRecord(0).company.executives.length, 0);
    const c = Y.sanitizeCompany({ finance: { cash: 1000, bankLevel: 99 }, executives: [ex('B', 't', 1000, 0, 0, 0, 60)] });
    ok(Y.saveCompanyRecord(0, c));
    const back = Y.loadCompanyRecord(0).company;
    eq(back.finance.bankLevel, 40);
    eq(back.executives.length, 1);
    eq(back.finance.cash, 1000);
  });
});
test('Şirket kaydı yoksa eski Üretim kurulumundaki yönetici ve nakit bir kez taşınır; sonra kayıt kullanılır', () => {
  const old = { executives: [ex('B', 't', 1000, 0, 0, 0, 60)], finance: { cash: 5e6, bankLevel: 3 } };
  withStorage({ 'dentsimco.uretim.r0': JSON.stringify(old) }, (store) => {
    const first = Y.loadCompanyRecord(0);
    eq(first.migrated, true);
    eq(first.company.finance.bankLevel, 3);
    ok(store['dentsimco.sirket.r0'], 'şirket kaydı yazılmalı');
    eq(Y.loadCompanyRecord(0).migrated, false);
  });
});
test('Realmler ayrı kayıt tutar', () => {
  withStorage({}, () => {
    Y.saveCompanyRecord(1, Y.sanitizeCompany({ finance: { cash: 7 } }));
    eq(Y.loadCompanyRecord(0).company.finance.cash, 0);
    eq(Y.loadCompanyRecord(1).company.finance.cash, 7);
  });
});

// ---- rapor ----
let failed = 0;
let current = null;
for (const r of results) {
  if (r.group !== current) {
    current = r.group;
    const inGroup = results.filter((x) => x.group === current);
    console.log(`\n${current} (${inGroup.filter((x) => x.ok).length}/${inGroup.length})`);
  }
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n      → ${r.error}`}`);
}
console.log(`\n${results.length - failed}/${results.length} test geçti${failed ? `, ${failed} başarısız` : ''}.`);
process.exitCode = failed ? 1 : 0;
