// icerik/*.json içindeki her alanın yönetici panelinde (public/admin/config.yml)
// tanımlı olduğunu doğrular.
//
// Neden gerekli: Decap CMS bir dosyayı kaydederken YALNIZCA config.yml'de
// tanımlı alanları yazar. Tanımlanmamış bir alan, o bölüm panelden ilk kez
// kaydedildiğinde sessizce silinir. Bu betik o riski önceden yakalar.
//
// Çalıştırmak için:  node araclar/icerik-denetle.js

const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');
const ICERIK_DIZINI = path.join(KOK, 'icerik');
const CONFIG = path.join(KOK, 'public', 'admin', 'config.yml');
const SABLON = path.join(KOK, 'sablon', 'anasayfa.html');

// Bir JSON nesnesindeki bütün alan adlarını toplar (dizi öğelerinin içi dahil).
function alanlariTopla(deger, kume = new Set()) {
  if (Array.isArray(deger)) {
    for (const oge of deger) alanlariTopla(oge, kume);
  } else if (deger !== null && typeof deger === 'object') {
    for (const [anahtar, ic] of Object.entries(deger)) {
      kume.add(anahtar);
      alanlariTopla(ic, kume);
    }
  }
  return kume;
}

// config.yml'i dosya bölümlerine ayırır: { 'icerik/genel.json': Set(alanlar) }
function configiOku() {
  const satirlar = fs.readFileSync(CONFIG, 'utf8').split(/\r?\n/);
  const bolumler = new Map();
  let simdikiDosya = null;

  for (const satir of satirlar) {
    const dosyaEslesme = satir.match(/^\s*file:\s*"([^"]+)"/);
    if (dosyaEslesme) {
      simdikiDosya = dosyaEslesme[1];
      if (!bolumler.has(simdikiDosya)) bolumler.set(simdikiDosya, new Set());
      continue;
    }
    if (!simdikiDosya) continue;

    // Yeni bir dosya bölümü başlıyorsa (- name: "x" satırı, 6 boşluk girintili)
    if (/^      - name:/.test(satir)) {
      simdikiDosya = null;
      continue;
    }

    for (const eslesme of satir.matchAll(/\bname:\s*"?([A-Za-zçğıöşüÇĞİÖŞÜ0-9_]+)"?/g)) {
      bolumler.get(simdikiDosya).add(eslesme[1]);
    }
  }
  return bolumler;
}

let hata = 0;
const bolumler = configiOku();
const icerikDosyalari = fs.readdirSync(ICERIK_DIZINI).filter((a) => a.endsWith('.json')).sort();

console.log('--- Panel alan denetimi ---');
for (const ad of icerikDosyalari) {
  const anahtar = `icerik/${ad}`;
  const veri = JSON.parse(fs.readFileSync(path.join(ICERIK_DIZINI, ad), 'utf8'));
  const gerekenler = alanlariTopla(veri);
  const tanimlilar = bolumler.get(anahtar);

  if (!tanimlilar) {
    console.log(`  HATA  ${anahtar} panelde hiç tanımlı değil`);
    hata++;
    continue;
  }

  const eksikler = [...gerekenler].filter((alan) => !tanimlilar.has(alan));
  if (eksikler.length) {
    console.log(`  HATA  ${anahtar} — panelde eksik alanlar: ${eksikler.join(', ')}`);
    hata++;
  } else {
    console.log(`  tamam ${anahtar} (${gerekenler.size} alan)`);
  }
}

// Şablonun kullandığı üst düzey anahtarlar içerikte var mı?
console.log('');
console.log('--- Şablon değişkeni denetimi ---');
const sablon = fs.readFileSync(SABLON, 'utf8');
const tumIcerik = {};
for (const ad of icerikDosyalari) {
  Object.assign(tumIcerik, JSON.parse(fs.readFileSync(path.join(ICERIK_DIZINI, ad), 'utf8')));
}

const ustDuzeyKullanilan = new Set();
for (const eslesme of sablon.matchAll(/\{\{[{#^/]?\s*([A-Za-z_][\w]*)(?:\.[\w.]+)?\s*\}?\}\}/g)) {
  ustDuzeyKullanilan.add(eslesme[1]);
}

// Dizi öğelerinin içindeki alanlar üst düzeyde bulunmaz; onları ayıklamak için
// içerikteki bütün alan adlarını da biliyoruz.
const tumAlanlar = alanlariTopla(tumIcerik);
const bilinmeyen = [...ustDuzeyKullanilan].filter((a) => !(a in tumIcerik) && !tumAlanlar.has(a));

if (bilinmeyen.length) {
  console.log(`  HATA  şablonda içerikte karşılığı olmayan değişkenler: ${bilinmeyen.join(', ')}`);
  hata++;
} else {
  console.log(`  tamam şablondaki ${ustDuzeyKullanilan.size} değişkenin hepsinin karşılığı var`);
}

console.log('');
if (hata) {
  console.log(`${hata} sorun bulundu.`);
  process.exit(1);
}
console.log('Denetim temiz.');
