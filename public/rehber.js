// DentSimco — Binalar sekmesinin üstündeki rehber kartı (Üretim ve Perakende aynı metni kullanır)
// Kart: başlık, kısa açıklama, iki bilgi etiketi (toplam bonus, yönetim gideri) ve Yönetim › Ekip bağlantısı.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** @param {{ title: string, lead: string, chips?: Array<[string, string?]|null|false> }} o  chips: [metin, tür('' | 'muted' | 'down' | 'up')] */
export function guideCard({ title, lead, chips = [] }) {
  const chipHtml = chips.filter(Boolean).map(([text, kind = '']) => `<span class="ur-chip ${esc(kind)}">${esc(text)}</span>`).join('');
  return `<section class="ur-card" aria-label="${esc(title)}"><h2>${esc(title)}</h2>
    <p class="ur-sub">${esc(lead)}</p>
    ${chipHtml ? `<div class="ur-chips">${chipHtml}</div>` : ''}
    <p class="ur-note">Yöneticilerin net getirisini Şirket özetinde görmek için <a href="#yonetim/ekip" style="color:var(--accent)">Yönetim</a> güncelleyin.</p></section>`;
}
