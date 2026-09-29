// DentSimco Bot v2 — ortak ayarlar ve yardımcı fonksiyonlar
// Ayar değiştirmek gerekirse sadece CONFIG kısmına dokun.
//
// FIRESTORE VERİ HARİTASI (dashboard bunları okur)
//   live/r{realm}                  data = JSON {t, items: {id: [t, {q: [p,a,s,v]}]}}   son ölçüm
//   intraday/r{realm}_{gün}_s{NN}  t{SSDD} = JSON {id: {q: [p,a,s,v]}}             23 dk'lık noktalar
//   daily/r{realm}_{id}_{yıl}      d{AAGG} = JSON {q: [açılış,yüksek,düşük,kapanış,ortArz,satış,değer]}
//   state/r{realm}_s{NN}           data = JSON {t, items: {id: [ilanId,q,fiyat,adet,satıcı,...]}}
//   meta/products_r{realm}, meta/tradable, meta/buildings, meta/core,
//   meta/modifiers_r{realm}, meta/retail_r{realm}, meta/status, meta/rollup
//
//   p = en düşük satış fiyatı, a = satıştaki toplam adet (arz),
//   s = tahmini satılan adet (önceki ölçümden beri), v = tahmini satış tutarı
//   VWAP = toplam v / toplam s.  Parça (shard) numarası = ürün ID % 16.  Saatler UTC.

import { pathToFileURL } from 'node:url';

export const CONFIG = {
  realms: [0, 1],
  simcoBase: 'https://www.simcompanies.com',
  encyclopedia: { lang: 'en', phase: 0 },

  shards: 16,
  rawRetentionDays: 35,

  // Her çalışma 1 dakikanın altında kalsın diye borsa çekme işi bu süre sonunda durur (ms).
  fetchBudgetMs: 50000,
  fetchBudgetOnRollupMs: 42000,

  market: { concurrency: 3, delayMs: 300 },
  constants: { concurrency: 3, delayMs: 300 },

  stateMaxPerQuality: 250,
  maxRollupDaysPerRun: 3,
};

const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; DentSimco-Bot/2.0)',
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const pad2 = (n) => String(n).padStart(2, '0');
export const range = (n) => Array.from({ length: n }, (_, i) => i);
export const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
export const shardOf = (id) => Number(id) % CONFIG.shards;

export function parseJSON(text) {
  if (typeof text !== 'string' || !text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export function hhmm(ms) {
  const d = new Date(ms);
  return pad2(d.getUTCHours()) + pad2(d.getUTCMinutes());
}
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d.getTime());
}

export const PATHS = {
  live: (r) => `live/r${r}`,
  state: (r, s) => `state/r${r}_s${pad2(s)}`,
  intraday: (r, day, s) => `intraday/r${r}_${day}_s${pad2(s)}`,
  daily: (r, id, year) => `daily/r${r}_${id}_${year}`,
  meta: (name) => `meta/${name}`,
};

// Oyun API'sinden JSON çeker. 429 ve 5xx hatalarında bekleyip tekrar dener.
export async function fetchJson(url, { deadline = Infinity, retries = 3, onThrottle } = {}) {
  let lastError = new Error('bilinmeyen hata');
  for (let attempt = 0; attempt <= retries; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Object.assign(new Error('süre doldu'), { deadline: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(15000, remaining));
    let res;
    try {
      res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (Date.now() >= deadline - 50) throw Object.assign(new Error('süre doldu'), { deadline: true });
      lastError = e;
      await sleep(800 * (attempt + 1));
      continue;
    }
    clearTimeout(timer);

    if (res.status === 429 || res.status >= 500) {
      if (res.status === 429 && onThrottle) onThrottle();
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1);
      lastError = new Error(`HTTP ${res.status}`);
      if (Date.now() + wait >= deadline) break;
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }
  throw lastError;
}

// İşleri aynı anda en fazla `concurrency` tane olacak şekilde çalıştırır.
// Süre dolunca yeni iş başlatmaz; başlatılamayan işlerin sonucu undefined kalır.
export async function runPool(items, worker, { concurrency = 3, delayMs = 0, deadline = Infinity } = {}) {
  const results = new Array(items.length);
  let next = 0;
  let delay = delayMs;
  const control = {
    slowDown() { delay = Math.min(2000, Math.max(250, delay * 2)); },
  };
  async function loop() {
    while (Date.now() < deadline) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await worker(items[index], control) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
      if (delay > 0) await sleep(delay);
    }
  }
  await Promise.all(range(Math.min(concurrency, items.length)).map(loop));
  return results;
}

// Tek dosyayı doğrudan çalıştırınca main() çağrılır; test ederken çağrılmaz.
export function runIfMain(metaUrl, main) {
  const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
  if (metaUrl !== entry) return;
  main().then(
    () => process.exit(0),
    (error) => {
      console.error('HATA:', error?.stack || error);
      process.exit(1);
    },
  );
}
