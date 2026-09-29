// DentSimco — veri katmanı (tüm modüller ortak kullanır)
// Firestore'u anahtarsız REST ile okur. Kurallar herkese okuma izni verir, yazma kapalıdır.
// Botun yazdığı biçim (bot/common.mjs başındaki "VERİ HARİTASI"):
//   live/r{realm}                  data = {t, items: {id: [t, {q: [p,a,s,v]}]}}   son ölçüm
//   intraday/r{realm}_{gün}_s{NN}  t{SSDD} = {id: {q: [p,a,s,v]}}               23 dk'lık noktalar
//   daily/r{realm}_{id}_{yıl}      d{AAGG} = {q: [açılış,yüksek,düşük,kapanış,ortArz,satış,tutar]}
//   p = en düşük fiyat, a = arz, s = tahmini satış adedi, v = tahmini satış tutarı. Saatler UTC.

export const PROJECT_ID = 'dentsimco-e1c85';
export const START_YEAR = 2026; // botun veri toplamaya başladığı yıl
export const SHARDS = 16; // parça = ürün ID % 16
export const QUALITIES = Array.from({ length: 13 }, (_, q) => q); // Q0–Q12
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const API = `https://firestore.googleapis.com/v1/${ROOT}`;
const TIMEOUT_MS = 15_000;

// ---- Tarih (bot UTC günlerini kullanır; TR saatiyle gün 03:00'te başlar) ----

const pad2 = (n) => String(n).padStart(2, '0');
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const dayStart = (day) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day, n) => utcDay(dayStart(day) + n * DAY);

export const PATHS = {
  live: (r) => `live/r${r}`,
  intraday: (r, day, id) => `intraday/r${r}_${day}_s${pad2(Number(id) % SHARDS)}`,
  daily: (r, id, year) => `daily/r${r}_${id}_${year}`,
  meta: (name) => `meta/${name}`,
};

// ---- Firestore okuma ----

export class VeriHatasi extends Error {
  constructor(message) {
    super(message);
    this.name = 'VeriHatasi';
  }
}

function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) out[key] = decodeValue(value);
  return out;
}

async function batchGet(paths) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}:batchGet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents: paths.map((p) => `${ROOT}/${p}`) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = body?.error?.message ? ` (${body.error.message})` : '';
      if (res.status === 401 || res.status === 403) {
        throw new VeriHatasi(`Firestore okuma izni vermedi${detail}. Rules sekmesinde "allow read: if true" olmalı.`);
      }
      throw new VeriHatasi(`Firestore hata verdi: ${res.status}${detail}`);
    }
    const items = await res.json();
    const out = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      if (item.found) out.set(item.found.name.slice(ROOT.length + 1), decodeFields(item.found.fields));
      else if (item.missing) out.set(item.missing.slice(ROOT.length + 1), null);
    }
    return out;
  } catch (e) {
    if (e instanceof VeriHatasi) throw e;
    if (e?.name === 'AbortError') throw new VeriHatasi('Firestore 15 saniyede yanıt vermedi.');
    throw new VeriHatasi(navigator.onLine === false ? 'İnternet bağlantısı yok.' : "Firestore'a ulaşılamadı.");
  } finally {
    clearTimeout(timer);
  }
}

// Önbellek: geçmiş günler değişmez, bugün ve canlı veri birkaç dakikada tazelenir.
const cache = new Map(); // yol -> { at, fields }
const pending = new Map(); // yol -> Promise

function isFresh(path, at, now) {
  const m = /^intraday\/r\d+_(\d{4}-\d{2}-\d{2})_/.exec(path);
  if (m) {
    const settled = dayStart(m[1]) + DAY + 5 * MIN; // gün bitti, son yazma da geçti
    return at >= settled || now - at < 4 * MIN;
  }
  if (path.startsWith('daily/')) return now - at < 20 * MIN;
  if (path.startsWith('live/')) return now - at < 2 * MIN;
  return now - at < 6 * HOUR; // ürün listesi ve diğer sabitler
}

// Belgeleri tek istekte okur (100'lük gruplar). refresh(yol) true dönerse önbelleği atlar.
export async function readDocs(paths, { refresh } = {}) {
  const now = Date.now();
  const out = new Map();
  const waits = [];
  const need = [];
  for (const path of new Set(paths)) {
    const hit = cache.get(path);
    if (hit && !refresh?.(path) && isFresh(path, hit.at, now)) {
      out.set(path, hit.fields);
    } else if (pending.has(path)) {
      waits.push(pending.get(path).then((fields) => out.set(path, fields)));
    } else {
      need.push(path);
    }
  }
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const job = batchGet(chunk).then((got) => {
      const at = Date.now();
      for (const p of chunk) cache.set(p, { at, fields: got.get(p) ?? null });
      return got;
    });
    for (const p of chunk) {
      const one = job.then((got) => got.get(p) ?? null);
      pending.set(p, one);
      one.catch(() => {}).finally(() => { if (pending.get(p) === one) pending.delete(p); });
    }
    waits.push(job.then((got) => { for (const p of chunk) out.set(p, got.get(p) ?? null); }));
  }
  await Promise.all(waits);
  return out;
}

// ---- Belge çözümleme (her belge bir kez çözülür) ----

const parsed = new WeakMap();

function parseJSON(text) {
  if (typeof text !== 'string' || !text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function memo(fields, build) {
  if (!fields) return build(null);
  if (!parsed.has(fields)) parsed.set(fields, build(fields));
  return parsed.get(fields);
}

export const dataField = (fields) => memo(fields, (f) => parseJSON(f?.data));

// Gün içi belge → [{t, items}] zamana göre sıralı
export function intradayPoints(fields, day) {
  return memo(fields, (f) => {
    const list = [];
    if (!f) return list;
    const base = dayStart(day);
    for (const [key, text] of Object.entries(f)) {
      const m = /^t(\d\d)(\d\d)$/.exec(key);
      if (!m) continue;
      const items = parseJSON(text);
      if (items) list.push({ t: base + (Number(m[1]) * 60 + Number(m[2])) * MIN, items });
    }
    return list.sort((a, b) => a.t - b.t);
  });
}

// Günlük belge → Map(gün → {q: [açılış,yüksek,düşük,kapanış,ortArz,satış,tutar]})
export function dailyRows(fields, year) {
  return memo(fields, (f) => {
    const rows = new Map();
    for (const [key, text] of Object.entries(f || {})) {
      const m = /^d(\d\d)(\d\d)$/.exec(key);
      const qs = m && parseJSON(text);
      if (qs) rows.set(`${year}-${m[1]}-${m[2]}`, qs);
    }
    return rows;
  });
}

// ---- Yükleyiciler ----

// Realm'in ürün adları, borsadaki ürün listesi ve son ölçüm
export async function loadBasics(r, options) {
  const P = { products: PATHS.meta(`products_r${r}`), tradable: PATHS.meta('tradable'), live: PATHS.live(r) };
  const docs = await readDocs(Object.values(P), options);
  const products = dataField(docs.get(P.products)) || {};
  const tradable = dataField(docs.get(P.tradable)) || {};
  const live = dataField(docs.get(P.live));
  let ids = (tradable[r] || []).map(Number).filter(Number.isFinite);
  if (!ids.length) ids = Object.keys(live?.items || {}).map(Number).sort((a, b) => a - b);
  return { products, ids, live };
}

// Bir ürünün gün içi noktaları (günlere göre) ve günlük özetleri
export async function loadProduct(r, id, { days = [], years = [] } = {}, options) {
  const intraPaths = days.map((d) => PATHS.intraday(r, d, id));
  const dailyPaths = years.map((y) => PATHS.daily(r, id, y));
  const docs = await readDocs([...intraPaths, ...dailyPaths], options);
  const byDay = new Map();
  days.forEach((day, i) => {
    const points = [];
    for (const { t, items } of intradayPoints(docs.get(intraPaths[i]), day)) {
      const qs = items[id];
      if (qs) points.push({ t, qs });
    }
    byDay.set(day, points);
  });
  const daily = new Map();
  years.forEach((year, i) => {
    for (const [day, qs] of dailyRows(docs.get(dailyPaths[i]), year)) daily.set(day, qs);
  });
  return { byDay, daily };
}

// ---- Özetler ----

// Botun gece çıkardığı günlük özetin aynısı (bot/market.mjs → summarize)
export function summarize(points) {
  let open = null, high = null, low = null, close = null;
  let supplySum = 0, supplyN = 0, sold = 0, value = 0, soldN = 0;
  for (const [p, a, s, v] of points) {
    if (p != null) {
      if (open == null) open = p;
      close = p;
      high = high == null ? p : Math.max(high, p);
      low = low == null ? p : Math.min(low, p);
    }
    if (a != null) { supplySum += a; supplyN++; }
    if (s != null) { sold += s; value += v || 0; soldN++; }
  }
  return [open, high, low, close, supplyN ? Math.round(supplySum / supplyN) : 0, soldN ? sold : null, soldN ? Math.round(value * 100) / 100 : null];
}

// Bir günün noktaları [{t, qs}] → {q: [açılış,yüksek,düşük,kapanış,ortArz,satış,tutar]}
export function summarizeDay(points) {
  const perQ = {};
  for (const { qs } of points) for (const [q, m] of Object.entries(qs)) (perQ[q] ||= []).push(m);
  const out = {};
  for (const [q, list] of Object.entries(perQ)) out[q] = summarize(list);
  return out;
}

// ---- Biçimlendirme (Türkçe sayı ve tarih) ----

const numberFormats = new Map();
function nf(key, options) {
  let f = numberFormats.get(key);
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat('tr-TR', options)));
  return f;
}
const fixed = (d) => nf(`f${d}`, { minimumFractionDigits: d, maximumFractionDigits: d });

export const priceDigits = (p) => (Math.abs(p) < 10 ? 3 : Math.abs(p) < 1000 ? 2 : 0);
export function fmtPrice(p, digits) {
  if (p == null || !Number.isFinite(p)) return '—';
  return `$${fixed(digits ?? priceDigits(p)).format(p)}`;
}
export const fmtNum = (n) => (n == null || !Number.isFinite(n) ? '—' : fixed(0).format(Math.round(n)));
export const fmtCompact = (n) => (n == null || !Number.isFinite(n) ? '—'
  : nf('c', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
export const fmtPct = (x) => (x == null || !Number.isFinite(x) ? '—'
  : nf('p', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(x));
export const fmtShare = (x) => (x == null || !Number.isFinite(x) ? '—'
  : nf('s', { style: 'percent', maximumFractionDigits: x < 0.1 ? 1 : 0 }).format(x));

const dateFormats = new Map();
function df(key, options) {
  let f = dateFormats.get(key);
  if (!f) dateFormats.set(key, (f = new Intl.DateTimeFormat('tr-TR', options)));
  return f;
}
export const fmtTime = (ms) => df('t', { hour: '2-digit', minute: '2-digit' }).format(ms);
export const fmtDate = (ms) => df('d', { day: 'numeric', month: 'short' }).format(ms);
export const fmtDateTime = (ms) => df('dt', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
export const fmtMonth = (ms) => df('m', { month: 'short' }).format(ms);
export const fmtMonthYear = (ms) => df('my', { month: 'short', year: 'numeric' }).format(ms);

export function fmtAgo(ms, now = Date.now()) {
  const m = Math.round((now - ms) / MIN);
  if (m < 1) return 'az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}
