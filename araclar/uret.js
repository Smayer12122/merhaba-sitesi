// Statik yayın üreticisi.
//
// Siteyi bir kez üretip dagitim/ klasörüne yazar. Render'ın Static Site
// hizmeti bu klasörü yayınlar: uyku modu yoktur, ziyaretçi hiç beklemez.
//
// Yönetici paneli (public/admin) bilerek dışarıda bırakılır — panel girişi
// canlı bir sunucu ister ve o iş mevcut web servisinde kalır.
//
// Çalıştırma:  node araclar/uret.js

const fs = require('fs');
const path = require('path');
const uretim = require('../uretim.js');

const KOK = path.join(__dirname, '..');
const CIKTI = path.join(KOK, 'dagitim');
const PUBLIC_DIR = path.join(KOK, 'public');
// admin: panel girişi canlı sunucu ister, statik yayında işi yok.
// index.html: public/ içindeki kopya eski ve artık kullanılmıyor — sunucu da
//   "/" isteğini şablondan üretiyor. Kopyalanırsa ürettiğimiz sayfanın üstüne
//   yazar, o yüzden dışarıda bırakılır.
const DISARIDA = new Set(['admin', 'index.html']);

function klasoruBosalt(dizin) {
  fs.rmSync(dizin, { recursive: true, force: true });
  fs.mkdirSync(dizin, { recursive: true });
}

function kopyala(kaynak, hedef, kokMu = false) {
  const girisler = fs.readdirSync(kaynak, { withFileTypes: true });
  let sayi = 0;
  for (const giris of girisler) {
    if (kokMu && DISARIDA.has(giris.name)) continue;
    const a = path.join(kaynak, giris.name);
    const b = path.join(hedef, giris.name);
    if (giris.isDirectory()) {
      fs.mkdirSync(b, { recursive: true });
      sayi += kopyala(a, b);
    } else {
      fs.copyFileSync(a, b);
      sayi += 1;
    }
  }
  return sayi;
}

function boyut(dizin) {
  let toplam = 0;
  for (const giris of fs.readdirSync(dizin, { withFileTypes: true })) {
    const tam = path.join(dizin, giris.name);
    toplam += giris.isDirectory() ? boyut(tam) : fs.statSync(tam).size;
  }
  return toplam;
}

function uret() {
  const { icerik } = uretim.icerikTopla();
  const kok = String((icerik.genel || {}).siteAdresi || '').replace(/\/+$/, '');
  if (!kok) {
    throw new Error('icerik/genel.json içinde siteAdresi boş; robots.txt ve sitemap.xml kurulamaz.');
  }

  klasoruBosalt(CIKTI);

  // Önce dosyalar kopyalanır, ürettiğimiz sayfa en son yazılır: böylece
  // kopyalanan bir dosya yanlışlıkla index.html'in üstüne yazamaz.
  const kopyalanan = kopyala(PUBLIC_DIR, CIKTI, true);

  const html = uretim.anaSayfaUret();
  fs.writeFileSync(path.join(CIKTI, 'index.html'), html);

  fs.writeFileSync(path.join(CIKTI, 'robots.txt'), uretim.robotsMetni(kok));
  fs.writeFileSync(path.join(CIKTI, 'sitemap.xml'), uretim.siteHaritasiMetni(kok));

  return { kok, html, kopyalanan };
}

const sonuc = uret();

console.log('Statik yayın üretildi → dagitim/');
console.log(`  site adresi   : ${sonuc.kok}`);
console.log(`  index.html    : ${Buffer.byteLength(sonuc.html, 'utf8').toLocaleString('tr-TR')} bayt`);
console.log(`  kopyalanan    : ${sonuc.kopyalanan} dosya (yönetici paneli hariç)`);
console.log(`  toplam boyut  : ${Math.round(boyut(CIKTI) / 1024).toLocaleString('tr-TR')} KB`);
