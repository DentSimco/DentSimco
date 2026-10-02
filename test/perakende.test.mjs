// DentSimco — perakende hesap motoru testleri. Çalıştırma: node test/perakende.test.mjs
// "Veri" ve "Formül" bölümleri PDF'teki formüllerin kendi tutarlılığını sınar. "Oyun verisiyle" bölümü, önceki
// oturumlarda oyundan ölçülen satış hızlarıyla karşılaştırır; doygunluk (s) o ölçümlerden geri çözüldüğü için
// bu bölüm "yaklaşık"tır: aynı gün alınmış canlı doygunlukla gerçek bir doğrulama henüz yapılmadı.

import * as R from '../public/hesap-perakende.js';
import { TABLE, SALES } from '../public/perakende-veri.js';

// ---- küçük test düzeneği (hesap.test.mjs ile aynı) ----
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
function rel(actual, expected, tol, label = '') {
  if (!(Math.abs(actual / expected - 1) <= tol)) throw new Error(`${label} beklenen ${expected} (±%${tol * 100}), bulunan ${actual}`);
}
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} beklenen ${b}, bulunan ${a}`);
}
function ok(value, label = 'koşul sağlanmadı') { if (!value) throw new Error(label); }

const BUILDINGS = { G: { salaryModifier: 0.4 }, d: { salaryModifier: 0.5 }, A: { salaryModifier: 1.0 }, u: { salaryModifier: 0.7 } };
const ctxOf = (extra = {}) => ({
  saturation: { 3: 1.2, 4: 0.9, 5: 1.6, 7: 0.7, 8: 1.0, 9: 1.3, 102: 0.8, 103: 1.1, 108: 1.4, 109: 0.6, 110: 1.0, 11: 1.0, 12: 1.5, 150: 1.0 },
  weather: () => 1, bonusPct: 0, adminNet: 0, qualityWeight: 0.3, buildings: BUILDINGS, averageSalary: 345, ...extra,
});
const base = (o = {}) => ({ economy: 1, productId: 3, quality: 0, saturation: 1.2, cAct: 1.5, price: 3.5, ...o });

// =====================================================================================================
section('Veri');
test('Üç ekonomi fazında da 67 ürün; ağaçta 13 kalite satırı', () => {
  for (const e of [0, 1, 2]) eq(Object.keys(TABLE[e]).length, 67, `faz ${e}`);
  eq(Object.keys(TABLE[1][150]).length, 13);
});
test('Binalarda satılan her ürünün sabiti ya var ya da modelde satılmayan (u = 0) listesinde', () => {
  const unmodeled = new Set([117, 121, 129, 130, 131, 132, 134, 142, 143, 149]);
  for (const ids of Object.values(SALES)) for (const id of ids) ok(TABLE[1][id] || unmodeled.has(id), `eksik ${id}`);
});
test('Modelde satılmayan ürün reddedilir', () => {
  eq(R.isRetailProduct(1, 117), false);
  eq(R.calcProduct(base({ productId: 117 })).ok, false);
});
test('W = taban maaş × 1,1: her W değeri 0,1 × 345 × 1,1 katı', () => {
  for (const e of [0, 1, 2]) for (const [id, v] of Object.entries(TABLE[e])) {
    const rows = Number(id) === 150 ? Object.values(v) : [v];
    for (const [, , W] of rows) {
      const mod = W / 345 / 1.1;
      ok(Math.abs(mod * 10 - Math.round(mod * 10)) < 1e-6, `${id}: W ${W}`);
    }
  }
});
test('Bakkal elması: W = 0,4 × 345 × 1,1 = 151,8 ve u = 110', () => {
  const m = R.getModel(1, 3, 0);
  near(m.W, 151.8, 6); eq(m.u, 110);
});
test('Her bina en az bir ürün satıyor ve ürün → bina eşlemesi tutarlı', () => {
  for (const l of R.retailLetters()) ok(R.buildingProducts(l, 1).length > 0, l);
  ok(R.buildingsOf(124).includes('G') && R.buildingsOf(124).includes('r'));
});

// =====================================================================================================
section('Formül');
test('Talep 0–2 aralığına sıkışır; d_m tabanı 0,9, tavanı 1,5', () => {
  eq(R.demand(0), 2); eq(R.demand(5), 0); near(R.demand(1.507), 0.493, 9);
  eq(R.demandMultiplier(0), 0.9); eq(R.demandMultiplier(2), 1.5);
});
test('Elma (Durgunluk, s = 1,507): y ≈ 171, z ≈ 3,26, r_max ≈ 4,58', () => {
  const m = R.getModel(0, 3, 0);
  const r = R.calcProduct({ economy: 0, productId: 3, quality: 0, saturation: 1.507, cAct: m.c, price: 4 });
  near(r.d, 0.493, 9); eq(r.dm, 0.9);
  ok(Math.abs(r.y - 171.0) < 0.5, `y=${r.y}`);
  ok(Math.abs(r.z - 3.26) < 0.02, `z=${r.z}`);
  ok(Math.abs(r.rMax - 4.58) < 0.05, `rMax=${r.rMax}`);
});
test('r_max fiyatındaki kâr, kapalı formdaki pphpl_max ile aynı; r_max gerçek maksimum', () => {
  for (const [id, q, s, cAct] of [[3, 0, 1.2, 1.5], [3, 7, 0.4, 2], [11, 3, 1.9, 25], [150, 5, 1.0, 400], [102, 4, 0.9, 2]]) {
    const o = { economy: 1, productId: id, quality: q, saturation: s, cAct, bonusPct: 12, wage: 100 };
    const at = R.calcProduct({ ...o, price: R.calcProduct({ ...o, price: 1 }).rMax });
    near(at.pphpl, at.pphplMax, 9, `pphpl ${id}`);
    near(at.usphpl, at.usphplMax, 9, `usphpl ${id}`);
    for (const f of [0.9, 0.99, 1.01, 1.1]) {
      ok(R.calcProduct({ ...o, price: at.rMax * f }).pphpl <= at.pphpl + 1e-9, `fiyat ×${f} optimumu geçti (${id})`);
    }
  }
});
test('Fiyat boş bırakılırsa r_max (kuruşa yuvarlı) kullanılır ve işaretlenir; maliyet boşsa modeldeki c', () => {
  const r = R.calcProduct({ economy: 1, productId: 3, quality: 0, saturation: 1.2 });
  eq(r.priceAuto, true); eq(r.costAuto, true);
  near(r.price, Math.round(r.rMax * 100) / 100, 9);
  near(r.cAct, R.getModel(1, 3).c, 9);
});
test('Satış bonusu adedi 1/(1 − b/100) ile, hava doğrusal çarpar', () => {
  const a = R.calcProduct(base()), b = R.calcProduct(base({ bonusPct: 20 })), w = R.calcProduct(base({ weather: 0.5 }));
  near(b.usphpl / a.usphpl, 1 / 0.8, 9); near(w.usphpl / a.usphpl, 0.5, 9);
});
test('Aşırı yüksek fiyatta adet sıfırın altına inmez; maaş yine de ödenir', () => {
  const r = R.calcProduct(base({ price: 9999, wage: 150 }));
  eq(r.usphpl, 0); ok(r.pphpl === -150);
});
test('Fiyat maliyetin altındaysa uyarı bayrağı, optimumun üstündeyse bayrak', () => {
  eq(R.calcProduct(base({ price: 1 })).belowCost, true);
  eq(R.calcProduct(base({ price: 50 })).aboveOptimum, true);
});
test('Ağaç: sabitler kaliteye göre değişir, y hep q = 0 ile hesaplanır', () => {
  const a = R.calcProduct({ economy: 1, productId: 150, quality: 0, saturation: 1, cAct: 50, price: 100 });
  const b = R.calcProduct({ economy: 1, productId: 150, quality: 8, saturation: 1, cAct: 50, price: 100 });
  ok(a.model.u !== b.model.u);
  near(b.y, 0.5 * 370 * b.d * (b.model.B * b.model.u + 1), 9);
});
test('Diğer ürünlerde kalite yalnız y çarpanını değiştirir: ×(1 + q·w/12)', () => {
  const q0 = R.calcProduct(base({ quality: 0 })), q12 = R.calcProduct(base({ quality: 12 }));
  eq(q0.model, q12.model);
  near(q12.y / q0.y, 1 + 12 * 0.3 / 12, 9);
});
test('Geçersiz girdiler hata fırlatmaz, açıklamayla döner', () => {
  eq(R.calcProduct(base({ bonusPct: 100 })).ok, false);
  eq(R.calcProduct(base({ saturation: null })).ok, false);
  eq(R.calcProduct(base({ quality: 99 })).quality, 12);
});

// =====================================================================================================
section('Maaş ve bonus');
test('S = taban maaş × (1 + net yönetim gideri): Bakkal, %50 gider → 207', () => {
  near(R.storeWage({ salaryModifier: 0.4, averageSalary: 345, adminNet: 0.5 }), 207, 9);
});
test('Bina verisi yoksa W ÷ 1,1 kullanılır (151,8 → 138)', () => {
  near(R.storeWage({ modelW: 151.8 }), 138, 9);
});
test('Bonus = ekip dışı + CMO ekibi (yüzde olarak toplanır)', () => {
  eq(R.retailBonusPct({ otherSpeedPct: 9, teamSalesSpeedPct: 5 }), 14);
  eq(R.retailBonusPct({}), 0);
});
test('Doygunluk ayrıştırma: dizi ve nesne, kalite 0 tercih edilir, sayı olmayan atlanır', () => {
  const list = [{ dbLetter: 3, quality: 0, saturation: 1.5 }, { dbLetter: 3, quality: 2, saturation: 0.1 },
    { dbLetter: 4, saturation: 0.8 }, { dbLetter: 5, saturation: null }];
  eq(R.parseSaturation(list), { 3: 1.5, 4: 0.8 });
  eq(R.parseSaturation({ a: list[0], b: list[2] }), { 3: 1.5, 4: 0.8 });
  eq(R.parseSaturation(null), {});
});

// =====================================================================================================
section('Kurulum');
const setup1 = () => ({
  economyPhase: 1,
  buildings: [
    { id: 'b1', letter: 'G', level: 10, lines: [{ id: 'l1', product: 3, quality: 2, cost: 1.5, price: 3.5 }] },
    { id: 'b2', letter: 'd', level: 4, lines: [{ id: 'l2', product: 102, quality: 0, levels: 4, cost: 2, price: 9 }] },
  ],
});
test('Tek satırlı binada levels yoksa bina seviyesinin tamamı kullanılır', () => {
  const r = R.evaluateRetail(setup1(), ctxOf());
  eq(r.buildings[0].lines[0].levels, 10); eq(r.buildings[0].unallocated, 0);
});
test('Toplamlar bina toplamlarına eşit; günlük = saatlik × 24; maaş = seviye × S', () => {
  const ctx = ctxOf({ adminNet: 0.3, bonusPct: 10 });
  const r = R.evaluateRetail(setup1(), ctx);
  near(r.totals.profitHour, r.buildings[0].profitHour + r.buildings[1].profitHour, 9);
  near(r.totals.profitDay, r.totals.profitHour * 24, 6);
  near(r.buildings[0].wagesHour, 10 * 0.4 * 345 * 1.3, 6);
  near(r.buildings[1].wagesHour, 4 * 0.5 * 345 * 1.3, 6);
  eq(r.totals.levels, 14);
  near(r.totals.marginDay - r.totals.wagesDay, r.totals.profitDay, 6);
});
test('Satırdaki kâr, tek ürün hesabıyla (seviye × pphpl) aynı', () => {
  const ctx = ctxOf();
  const r = R.evaluateRetail(setup1(), ctx);
  const one = R.calcProduct({ economy: 1, productId: 3, quality: 2, saturation: 1.2, cAct: 1.5, price: 3.5, wage: 0.4 * 345 });
  near(r.buildings[0].lines[0].profitHour, one.pphpl * 10, 9);
});
test('Fiyat ve maliyet boşsa r_max ve modeldeki c ile hesaplanır, satır işaretlenir', () => {
  const r = R.evaluateRetail({ economyPhase: 1, buildings: [{ letter: 'G', level: 5, lines: [{ product: 3, quality: 0 }] }] }, ctxOf());
  const l = r.buildings[0].lines[0];
  eq([l.priceAuto, l.costAuto], [true, true]);
  ok(l.profitHour > 0);
});
test('Atanmamış seviyelerin maaşı da ödenir ve not düşülür', () => {
  const s = { economyPhase: 1, buildings: [{ letter: 'G', level: 10, lines: [{ product: 3, quality: 0, levels: 6, cost: 1.5, price: 3.5 }] }] };
  const r = R.evaluateRetail(s, ctxOf());
  eq(r.buildings[0].unallocated, 4);
  near(r.buildings[0].wagesHour, 10 * 138, 6);
  ok(r.buildings[0].notes.some((n) => n.includes('atanmadı')));
});
test('Binada satılmayan ürün ve fazla seviye için uyarı; doygunluğu olmayan satır hesaba girmez', () => {
  const s = { economyPhase: 1, buildings: [{ letter: 'A', level: 2, lines: [
    { product: 3, quality: 0, levels: 1, cost: 1, price: 3 },
    { product: 11, quality: 0, levels: 2, cost: 20, price: 30 },
    { product: 12, quality: 0, levels: 0, cost: 20, price: 30 }] }] };
  const c = ctxOf(); delete c.saturation[12];
  const r = R.evaluateRetail(s, c);
  ok(r.buildings[0].notes.some((n) => n.includes('satılmaz')));
  ok(r.buildings[0].notes.some((n) => n.includes('3 seviye kullanıyor')));
  eq(r.buildings[0].lines[2].ok, false);
});
test('Ekonomi fazı sabitleri değiştirir (aynı kurulum Durgunluk ve Büyümede farklı kâr verir)', () => {
  const a = R.evaluateRetail({ ...setup1(), economyPhase: 0 }, ctxOf()).totals.profitDay;
  const b = R.evaluateRetail({ ...setup1(), economyPhase: 2 }, ctxOf()).totals.profitDay;
  ok(a !== b);
});
test('Boş kurulum sıfır döner', () => {
  const r = R.evaluateRetail({ economyPhase: 1, buildings: [] }, ctxOf());
  eq([r.totals.levels, r.totals.profitDay], [0, 0]);
});

// =====================================================================================================
section('Sıralama');
test('Sıralama azalan, en çok 10 ürün, ilki yıldızlı', () => {
  const list = R.rankBuilding({ letter: 'G', economy: 1, ctx: ctxOf(), costFor: () => null });
  ok(list.length > 0 && list.length <= 10);
  eq(list[0].best, true); eq(list.filter((x) => x.best).length, 1);
  for (let i = 1; i < list.length; i++) ok(list[i - 1].pphplMax >= list[i].pphplMax);
});
test('Doygunluğu bilinmeyen ürün sıralamaya girmez', () => {
  const c = ctxOf(); c.saturation = { 3: 1.2 };
  eq(R.rankBuilding({ letter: 'G', economy: 1, ctx: c }).map((x) => x.productId), [3]);
});
test('Maliyet artınca ilgili ürün aşağı düşer', () => {
  const cheap = R.rankBuilding({ letter: 'G', economy: 1, ctx: ctxOf(), costFor: () => null });
  const top = cheap[0].productId;
  const dear = R.rankBuilding({ letter: 'G', economy: 1, ctx: ctxOf(), costFor: (id) => (id === top ? R.getModel(1, id).c * 1.8 : null) });
  ok(dear[0].productId !== top || dear.length === 1);
});

// =====================================================================================================
section('Yönetici (CMO)');
test('CMO değeri: ekip bonusu yokken 0, varken marjı artırır; fiyatlar sabit', () => {
  const ctx = ctxOf();
  eq(R.cmoValueDay(setup1(), ctx, { otherSpeedPct: 9, teamSalesSpeedPct: 0 }), 0);
  const v = R.cmoValueDay(setup1(), ctx, { otherSpeedPct: 9, teamSalesSpeedPct: 5 });
  ok(v > 0);
  const m1 = R.evaluateRetail(setup1(), { ...ctx, bonusPct: 14 }).totals.marginDay;
  const m0 = R.evaluateRetail(setup1(), { ...ctx, bonusPct: 9 }).totals.marginDay;
  near(v, m1 - m0, 6);
});
test('Aynı +%5 ekip bonusu, bonus yüksekken daha değerli (1/(1−b) büyür)', () => {
  const lo = R.cmoValueDay(setup1(), ctxOf(), { otherSpeedPct: 0, teamSalesSpeedPct: 5 });
  const hi = R.cmoValueDay(setup1(), ctxOf(), { otherSpeedPct: 40, teamSalesSpeedPct: 5 });
  ok(hi > lo);
});

// =====================================================================================================
section('Oyun verisiyle (yaklaşık)');
// Önceki oturumlarda oyundan ölçülen satış hızları. Doygunluk o günün canlı değeri bilinmediği için, ölçülen satış
// sıfırlanma fiyatından (M0) geri çözüldü; yani aşağıdaki testler formülün biçimini sınar, mutlak doğruluğu değil.
test('Portakal suyu (Durgunluk), Q2, bonus %9, fiyat 59,04: seviye 50 → oyun 525,19 (s ≈ 1,347)', () => {
  const r = R.calcProduct({ economy: 0, productId: 124, quality: 2, saturation: 1.3473, cAct: 20, price: 59.04, bonusPct: 9 });
  rel(r.usphpl * 50, 525.19, 0.06, 'seviye 50');
  rel(r.usphpl * 10, 105.04, 0.06, 'seviye 10');
});
test('Tuğla (Durgunluk), Q10, bonus %44, fiyat 7,90: seviye 50 → oyun 6475 (s ≈ 0,937)', () => {
  const r = R.calcProduct({ economy: 0, productId: 102, quality: 10, saturation: 0.9366, cAct: 2, price: 7.9, bonusPct: 44 });
  rel(r.usphpl * 50, 6475, 0.015);
});

// ---- rapor ----
const failed = results.filter((r) => !r.ok);
let last = '';
for (const r of results) {
  if (r.group !== last) { console.log(`\n${r.group}`); last = r.group; }
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n      ${r.error}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} test geçti${failed.length ? `, ${failed.length} başarısız` : ''}.`);
if (failed.length) process.exit(1);
