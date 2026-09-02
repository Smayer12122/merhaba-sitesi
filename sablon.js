// Küçük şablon motoru. Dışarıdan hiçbir paket kullanmaz.
//
// Desteklediği yazımlar:
//   {{ad}}            → değeri HTML'e güvenli hâle getirip yazar
//   {{{ad}}}          → değeri olduğu gibi yazar (içinde <strong> gibi etiketler varsa)
//   {{#liste}}…{{/liste}}   → dizi ise her öğe için tekrarlar, doluysa bir kez yazar
//   {{^liste}}…{{/liste}}   → boş/yok ise yazar
//   {{.}}             → dizi öğesinin kendisi (metin dizilerinde)
//   {{ust.alt}}       → iç içe alanlar
//   {{ad|json}}       → JSON metni olarak kaçırır (ld+json bloğu için)
//   {{ad|url}}        → yalnızca güvenli adresleri geçirir (javascript: engellenir)

function kacisla(deger) {
  return String(deger)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// <script type="application/ld+json"> içine yazarken HTML kaçışı yanlıştır:
// &quot; oraya olduğu gibi girer ve JSON'u bozar. Burada JSON kaçışı yapılır,
// ayrıca < karakteri \u003c'ye çevrilerek </script> oluşması engellenir.
function jsonKacisla(deger) {
  return JSON.stringify(String(deger)).slice(1, -1).replace(/</g, '\\u003c');
}

// href/src'nin tamamı panelden geliyorsa kullanılır: "javascript:" ya da
// "data:" gibi bir adres yazılıp betik çalıştırılmasını engeller.
const GUVENLI_ONEK = /^(https?:\/\/|\/|#|tel:|mailto:|whatsapp:)/i;

function guvenliAdres(deger) {
  const metin = String(deger).trim();
  return GUVENLI_ONEK.test(metin) ? metin : '#';
}

// Değeri kapsam yığınında arar; en içteki kapsamdan başlar.
function degerBul(yol, yigin) {
  if (yol === '.') return yigin[0];
  const parcalar = yol.split('.');
  for (const kapsam of yigin) {
    let simdiki = kapsam;
    let bulundu = true;
    for (const parca of parcalar) {
      if (simdiki !== null && typeof simdiki === 'object' && parca in simdiki) {
        simdiki = simdiki[parca];
      } else {
        bulundu = false;
        break;
      }
    }
    if (bulundu) return simdiki;
  }
  return undefined;
}

function belirtecleriAyir(sablon) {
  const belirtecler = [];
  const kalip = /\{\{(\{)?([#^/]?)\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}?\}\}/g;
  let son = 0;
  let eslesme;

  while ((eslesme = kalip.exec(sablon)) !== null) {
    if (eslesme.index > son) {
      belirtecler.push({ tur: 'metin', deger: sablon.slice(son, eslesme.index) });
    }
    const ham = Boolean(eslesme[1]);
    const isaret = eslesme[2];
    const ad = eslesme[3];

    if (isaret === '#') belirtecler.push({ tur: 'ac', ad });
    else if (isaret === '^') belirtecler.push({ tur: 'tersAc', ad });
    else if (isaret === '/') belirtecler.push({ tur: 'kapat', ad });
    else belirtecler.push({ tur: 'degisken', ad, ham, suzgec: eslesme[4] });

    son = kalip.lastIndex;
  }
  if (son < sablon.length) belirtecler.push({ tur: 'metin', deger: sablon.slice(son) });
  return belirtecler;
}

// Belirteç listesini iç içe geçmiş bir ağaca çevirir.
function agacKur(belirtecler) {
  const kok = { cocuklar: [] };
  const yigin = [kok];

  for (const b of belirtecler) {
    const ust = yigin[yigin.length - 1];

    if (b.tur === 'ac' || b.tur === 'tersAc') {
      const dugum = { tur: b.tur, ad: b.ad, cocuklar: [] };
      ust.cocuklar.push(dugum);
      yigin.push(dugum);
    } else if (b.tur === 'kapat') {
      if (yigin.length === 1 || ust.ad !== b.ad) {
        throw new Error(`Şablon hatası: {{/${b.ad}}} eşleşmiyor`);
      }
      yigin.pop();
    } else {
      ust.cocuklar.push(b);
    }
  }

  if (yigin.length !== 1) {
    throw new Error(`Şablon hatası: {{#${yigin[yigin.length - 1].ad}}} kapatılmamış`);
  }
  return kok;
}

function dolu(deger) {
  if (Array.isArray(deger)) return deger.length > 0;
  return Boolean(deger);
}

function ciz(dugum, kapsamYigini) {
  let cikti = '';

  for (const cocuk of dugum.cocuklar) {
    if (cocuk.tur === 'metin') {
      cikti += cocuk.deger;
      continue;
    }

    if (cocuk.tur === 'degisken') {
      const deger = degerBul(cocuk.ad, kapsamYigini);
      if (deger === undefined || deger === null || deger === false) continue;
      if (cocuk.suzgec === 'json') cikti += jsonKacisla(deger);
      else if (cocuk.suzgec === 'url') cikti += kacisla(guvenliAdres(deger));
      else cikti += cocuk.ham ? String(deger) : kacisla(deger);
      continue;
    }

    const deger = degerBul(cocuk.ad, kapsamYigini);

    if (cocuk.tur === 'tersAc') {
      if (!dolu(deger)) cikti += ciz(cocuk, kapsamYigini);
      continue;
    }

    // cocuk.tur === 'ac'
    if (!dolu(deger)) continue;
    if (Array.isArray(deger)) {
      for (const oge of deger) {
        // Öğe düz bir metinse kapsam olarak kendisi konur; {{.}} onu okur.
        cikti += ciz(cocuk, [oge, ...kapsamYigini]);
      }
    } else if (typeof deger === 'object') {
      cikti += ciz(cocuk, [deger, ...kapsamYigini]);
    } else {
      cikti += ciz(cocuk, kapsamYigini);
    }
  }

  return cikti;
}

function derle(sablon) {
  const agac = agacKur(belirtecleriAyir(sablon));
  return (veri) => ciz(agac, [veri]);
}

module.exports = { derle, kacisla, jsonKacisla, guvenliAdres };
