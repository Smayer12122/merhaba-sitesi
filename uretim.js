// İçerikten sayfa üretimi. Hem canlı sunucu (server.js) hem de statik yayın
// için çalışan üretici (araclar/uret.js) bu dosyayı kullanır; böylece ikisi
// asla birbirinden ayrı düşmez.

const fs = require('fs');
const path = require('path');
const { derle } = require('./sablon.js');

const PUBLIC_DIR = path.join(__dirname, 'public');
const SABLON_DOSYASI = path.join(__dirname, 'sablon', 'anasayfa.html');
const ICERIK_DIZINI = path.join(__dirname, 'icerik');

/* ---------------- Ana sayfa üretimi ---------------- */

let onbellek = { html: null, damga: 0, sonBakis: 0 };

// icerik/ klasöründeki bütün .json dosyalarını tek bir nesnede birleştirir.
// Her dosya panelde ayrı bir bölüm olarak düzenlenir; biri kaydedilince
// diğerleri etkilenmez.
function icerikTopla() {
  const dosyalar = fs.readdirSync(ICERIK_DIZINI).filter((ad) => ad.endsWith('.json')).sort();
  if (dosyalar.length === 0) throw new Error('icerik/ klasöründe hiç .json dosyası yok');

  let damga = 0;
  const icerik = {};
  for (const ad of dosyalar) {
    const tamYol = path.join(ICERIK_DIZINI, ad);
    damga += fs.statSync(tamYol).mtimeMs;
    Object.assign(icerik, JSON.parse(fs.readFileSync(tamYol, 'utf8')));
  }
  return { icerik, damga };
}

/* ---------------- Panelden istenmeyen alanları türetme ---------------- */
//
// Panelde eskiden aynı telefon üç ayrı biçimde ("0541 236 88 58",
// "+905412368858", "905412368858") ve fotoğraf başına dört teknik alan
// (srcset, sizes, genişlik, yükseklik) elle isteniyordu. Hepsi zaten
// hesaplanabilir bilgi olduğu için panelden kaldırıldı; burada üretiliyor.

// "0541 236 88 58" → "905412368858"
function telefonRakamlari(metin) {
  const rakam = String(metin || '').replace(/\D/g, '');
  if (!rakam) return '';
  if (rakam.startsWith('90')) return rakam;
  if (rakam.startsWith('0')) return '90' + rakam.slice(1);
  if (rakam.length === 10) return '90' + rakam;
  return rakam;
}

function aramaAdresi(metin) {
  const rakam = telefonRakamlari(metin);
  return rakam ? '+' + rakam : '';
}

// Panelde düz Türkçe yazılır, adrese girerken kodlanır. Zaten kodlanmış
// eski değerler iki kez kodlanmasın diye önce çözülmeye çalışılır.
function adresIcinKodla(metin) {
  const ham = String(metin || '');
  if (!ham) return '';
  let duz = ham;
  try {
    if (/%[0-9A-Fa-f]{2}/.test(ham)) duz = decodeURIComponent(ham);
  } catch {
    /* bozuk kodlama; olduğu gibi kullan */
  }
  return encodeURIComponent(duz);
}

// PNG ve JPEG başlığından en/boy okur. Dış pakete gerek yok.
function gorselOlcusu(tamYol) {
  let b;
  try {
    b = fs.readFileSync(tamYol);
  } catch {
    return null;
  }
  if (b.length > 24 && b.toString('latin1', 1, 4) === 'PNG') {
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const isaret = b[i + 1];
      if (isaret >= 0xc0 && isaret <= 0xcf && isaret !== 0xc4 && isaret !== 0xc8 && isaret !== 0xcc) {
        return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

// Aynı tabanı paylaşan boyutları (…-kucuk, …-orta, …-buyuk, tabanın kendisi)
// diskte arar ve gerçek genişlikleriyle srcset kurar.
function gorselBilgisi(dosya) {
  const bos = { srcset: '', en: '', boy: '' };
  const e = String(dosya || '').match(/^\/((?:[^/]+\/)*)([^/]+?)(\.\w+)$/);
  if (!e) return bos;

  const [, dizinUrl, ad, uzanti] = e;
  const taban = ad.replace(/-(kucuk|orta|buyuk)$/, '');
  const diskDizin = path.join(PUBLIC_DIR, dizinUrl);
  const izinli = new Set([
    taban + uzanti,
    `${taban}-kucuk${uzanti}`,
    `${taban}-orta${uzanti}`,
    `${taban}-buyuk${uzanti}`,
  ]);

  let bulunanlar;
  try {
    bulunanlar = fs.readdirSync(diskDizin).filter((f) => izinli.has(f));
  } catch {
    return bos;
  }

  const kayitlar = [];
  for (const f of bulunanlar) {
    const olcu = gorselOlcusu(path.join(diskDizin, f));
    if (olcu) kayitlar.push({ adres: `/${dizinUrl}${f}`, en: olcu[0] });
  }
  kayitlar.sort((a, b) => a.en - b.en);

  const kendi = gorselOlcusu(path.join(PUBLIC_DIR, dizinUrl, ad + uzanti));
  return {
    srcset: kayitlar.length > 1 ? kayitlar.map((k) => `${k.adres} ${k.en}w`).join(', ') : '',
    en: kendi ? String(kendi[0]) : '',
    boy: kendi ? String(kendi[1]) : '',
  };
}

// sizes yalnızca ızgara düzenine bağlı; üçlü dizilim ve dikeylik yeterli.
const SIZES_UCLU = '(max-width: 720px) 92vw, (max-width: 1184px) 30vw, 356px';
const SIZES_DIKEY = '(max-width: 720px) 92vw, (max-width: 1184px) 40vw, 460px';
const SIZES_YATAY = '(max-width: 720px) 92vw, (max-width: 1184px) 54vw, 622px';

function turetilmisAlanlar(icerik) {
  const iletisim = icerik.iletisim;
  if (iletisim) {
    iletisim.merkezCepLink = aramaAdresi(iletisim.merkezCep);
    iletisim.merkezSabitLink = aramaAdresi(iletisim.merkezSabit);
    iletisim.caddeCepLink = aramaAdresi(iletisim.caddeCep);
    iletisim.merkezWa = telefonRakamlari(iletisim.merkezCep);
    iletisim.caddeWa = telefonRakamlari(iletisim.caddeCep);
    iletisim.waMesaj = adresIcinKodla(iletisim.waMesaj);
  }

  for (const sube of (icerik.subelerBolumu || {}).liste || []) {
    sube.cepLink = aramaAdresi(sube.cep);
    sube.sabitLink = aramaAdresi(sube.sabit);
    sube.waLink = telefonRakamlari(sube.cep);
    sube.waNot = adresIcinKodla(sube.waNot);
  }

  for (const grup of (icerik.galeri || {}).gruplar || []) {
    for (const foto of grup.fotograflar || []) {
      const bilgi = gorselBilgisi(foto.dosya);
      foto.srcset = bilgi.srcset;
      foto.en = bilgi.en;
      foto.boy = bilgi.boy;
      foto.sizes = grup.uclu ? SIZES_UCLU : foto.dikey ? SIZES_DIKEY : SIZES_YATAY;
    }
  }

  return icerik;
}

/* ---------------- Arama motorları için yapısal veri ---------------- */
//
// Eskiden bu blok şablonda elle yazılıydı: tek şube, sabit puan, sabit saat.
// Panelden şube eklenince ya da saat değişince orası eskimiş kalıyordu.
// Artık içerik dosyalarından üretiliyor, ikisi birbirinden ayrılamaz.

// "Gazi Osman Paşa Mah., Barbaros Cd. No: 4/B<br>59500 Çerkezköy / Tekirdağ"
function adresAyikla(ham) {
  const parcalar = String(ham || '').split(/<br\s*\/?>/i);
  const sokak = (parcalar[0] || '').trim();
  const ikinci = (parcalar[1] || '').trim();
  const pk = (ikinci.match(/\b(\d{5})\b/) || [])[1] || '';
  const kalan = ikinci.replace(/\b\d{5}\b/, '').trim();
  const [ilce = '', il = ''] = kalan.split('/').map((p) => p.trim());
  return { sokak, pk, ilce, il };
}

// "Pzt – Cmt 09:00 – 20:30" → ['09:00', '20:30']
function saatAyikla(metin, yedek) {
  const e = String(metin || '').match(/(\d{1,2})[:.](\d{2})\D+(\d{1,2})[:.](\d{2})/);
  if (!e) return yedek;
  return [`${e[1].padStart(2, '0')}:${e[2]}`, `${e[3].padStart(2, '0')}:${e[4]}`];
}

function sayiyaCevir(metin) {
  const e = String(metin || '').replace(',', '.').match(/\d+(\.\d+)?/);
  return e ? Number(e[0]) : null;
}

function yapisalVeriUret(icerik) {
  const genel = icerik.genel || {};
  const saatler = icerik.saatler || {};
  const yorumlar = icerik.yorumlar || {};
  const kok = String(genel.siteAdresi || '').replace(/\/+$/, '');
  const subeler = (icerik.subelerBolumu || {}).liste || [];

  const [haftaAc, haftaKapa] = saatAyikla(saatler.dipSatir1, ['09:00', '20:30']);
  const [pazarAc, pazarKapa] = saatAyikla(saatler.dipSatir2, ['11:00', '19:00']);
  const acilis = [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      opens: haftaAc,
      closes: haftaKapa,
    },
    { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Sunday', opens: pazarAc, closes: pazarKapa },
  ];

  const puan = sayiyaCevir(yorumlar.puan);
  const adet = sayiyaCevir(yorumlar.adet);
  const haritaBaglantilari = [yorumlar.merkezLink, yorumlar.caddeLink].filter(Boolean);

  const dugumler = subeler.map((sube, sira) => {
    const adres = adresAyikla(sube.adres);
    const [enlem, boylam] = String(sube.koordinat || '').split(',').map((s) => Number(s.trim()));
    const dugum = {
      '@type': 'MobilePhoneStore',
      '@id': `${kok}/#sube-${sira + 1}`,
      name: `${genel.unvan || ''} — ${sube.ad || ''}`.trim(),
      url: kok || undefined,
      image: kok ? `${kok}/gorsel/logo@2x.png` : undefined,
      telephone: sube.cepLink || undefined,
      address: {
        '@type': 'PostalAddress',
        streetAddress: adres.sokak,
        addressLocality: adres.ilce,
        addressRegion: adres.il,
        postalCode: adres.pk,
        addressCountry: 'TR',
      },
      openingHoursSpecification: acilis,
    };
    if (Number.isFinite(enlem) && Number.isFinite(boylam)) {
      dugum.geo = { '@type': 'GeoCoordinates', latitude: enlem, longitude: boylam };
    }
    if (haritaBaglantilari[sira]) dugum.sameAs = [haritaBaglantilari[sira]];
    // Puan bütün işletmeyi temsil ettiği için yalnızca ana şubeye yazılır;
    // aynı puanı iki ayrı işletmeye yazmak yanıltıcı olur.
    if (sira === 0 && puan && adet) {
      dugum.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: String(puan),
        reviewCount: String(Math.round(adet)),
      };
    }
    return dugum;
  });

  if (dugumler.length === 0) return '';
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': dugumler }, null, 2)
    .replace(/</g, '\\u003c');
}

function anaSayfaUret() {
  // Tazelik kontrolü her istekte bütün .json dosyalarını diskten okuyordu; çok
  // istek gelince bu eşzamanlı okumalar olay döngüsünü kilitliyordu. Artık
  // saniyede bir bakılır, arada hazır sayfa döner.
  if (onbellek.html && Date.now() - onbellek.sonBakis < 1000) return onbellek.html;

  const { icerik, damga: icerikDamgasi } = icerikTopla();
  const damga = fs.statSync(SABLON_DOSYASI).mtimeMs + icerikDamgasi;

  if (onbellek.html && onbellek.damga === damga) {
    onbellek.sonBakis = Date.now();
    return onbellek.html;
  }

  const sablon = fs.readFileSync(SABLON_DOSYASI, 'utf8');
  turetilmisAlanlar(icerik);
  icerik.yapisalVeri = yapisalVeriUret(icerik);
  const html = derle(sablon)(icerik);

  onbellek = { html, damga, sonBakis: Date.now() };
  return html;
}

/* ---------------- Arama motoru dosyaları ---------------- */

// icerik/genel.json içindeki resmî site adresi.
function siteAdresi() {
  try {
    const g = JSON.parse(fs.readFileSync(path.join(ICERIK_DIZINI, 'genel.json'), 'utf8'));
    return String((g.genel || {}).siteAdresi || '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function robotsMetni(kok) {
  // Site artık statik yayından sunuluyor; canlı sunucu yalnızca panel girişi
  // için ayakta. Ama kendi onrender.com adresinden de aynı sayfayı sunuyor ve
  // Google orayı ayrı bir site sanıp ikiz içerik olarak indeksleyebilir.
  // Resmî adres dışındaki her konağı arama motorlarına tamamen kapatıyoruz.
  const resmi = siteAdresi();
  if (resmi && kok !== resmi) {
    return 'User-agent: *\nDisallow: /\n';
  }

  return `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /auth
Disallow: /callback

Sitemap: ${kok}/sitemap.xml
`;
}

// İçerik ve şablon dosyalarının en yenisinin tarihi; sitemap'teki lastmod.
function sonDegisimZamani() {
  try {
    const damgalar = fs
      .readdirSync(ICERIK_DIZINI)
      .filter((ad) => ad.endsWith('.json'))
      .map((ad) => fs.statSync(path.join(ICERIK_DIZINI, ad)).mtimeMs);
    damgalar.push(fs.statSync(SABLON_DOSYASI).mtimeMs);
    return Math.max(...damgalar);
  } catch {
    return Date.now();
  }
}

function siteHaritasiMetni(kok) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${kok}/</loc>
    <lastmod>${new Date(sonDegisimZamani()).toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

module.exports = {
  anaSayfaUret,
  icerikTopla,
  turetilmisAlanlar,
  yapisalVeriUret,
  robotsMetni,
  siteHaritasiMetni,
  siteAdresi,
  sonDegisimZamani,
  PUBLIC_DIR,
  ICERIK_DIZINI,
};
