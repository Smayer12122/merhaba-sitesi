// ATA İLETİŞİM sitesi.
// Express vb. hiçbir pakete ihtiyaç yok; sadece Node'un kendi modülleri.
//
// Yaptığı üç iş:
//   1. Ana sayfayı sablon/anasayfa.html + icerik/site.json birleştirerek üretir
//   2. public/ klasöründeki dosyaları sunar
//   3. Yönetici panelinin (Decap CMS) GitHub girişini karşılar

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { derle } = require('./sablon.js');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SABLON_DOSYASI = path.join(__dirname, 'sablon', 'anasayfa.html');
const ICERIK_DIZINI = path.join(__dirname, 'icerik');

const MIME_TIPLERI = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const TAZE_KALSIN = new Set(['.html', '.css', '.js', '.json', '.yml']);

function onbellekKurali(uzanti) {
  return TAZE_KALSIN.has(uzanti) ? 'no-cache' : 'public, max-age=86400';
}

function etiketUret(bilgi) {
  return `W/"${bilgi.size.toString(16)}-${bilgi.mtimeMs.toString(16)}"`;
}

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
  const html = derle(sablon)(icerik);

  onbellek = { html, damga, sonBakis: Date.now() };
  return html;
}

function anaSayfaSun(req, res) {
  let html;
  try {
    html = anaSayfaUret();
  } catch (hata) {
    console.error('Ana sayfa üretilemedi:', hata.message);
    return yanitla(res, 500, 'Sayfa şu anda üretilemiyor.', {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  }

  const govde = Buffer.from(html, 'utf8');
  const etiket = `W/"${govde.length.toString(16)}-${crypto.createHash('sha1').update(govde).digest('hex').slice(0, 12)}"`;

  if (req.headers['if-none-match'] === etiket) {
    res.writeHead(304, { ETag: etiket, 'Cache-Control': 'no-cache' });
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': govde.length,
    'Cache-Control': 'no-cache',
    ETag: etiket,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : govde);
}

/* ---------------- Statik dosyalar ---------------- */

function dosyaYoluCoz(adres) {
  let cozulmus;
  try {
    cozulmus = decodeURIComponent(adres.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (cozulmus.includes('\0')) return null;
  if (cozulmus.endsWith('/')) cozulmus += 'index.html';

  const hedef = path.join(PUBLIC_DIR, path.normalize(cozulmus));
  if (hedef !== PUBLIC_DIR && !hedef.startsWith(PUBLIC_DIR + path.sep)) return null;
  return hedef;
}

function yanitla(res, durum, govde, baslikar = {}) {
  res.writeHead(durum, { 'X-Content-Type-Options': 'nosniff', ...baslikar });
  res.end(govde);
}

async function dosyaSun(req, res, dosyaYolu) {
  const bilgi = await fs.promises.stat(dosyaYolu);
  if (bilgi.isDirectory()) {
    const hata = new Error('Klasör');
    hata.code = 'EISDIR';
    throw hata;
  }

  const uzanti = path.extname(dosyaYolu).toLowerCase();
  const etiket = etiketUret(bilgi);
  const ortakBasliklar = {
    'Cache-Control': onbellekKurali(uzanti),
    ETag: etiket,
    'Last-Modified': bilgi.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  };

  if (req.headers['if-none-match'] === etiket) {
    res.writeHead(304, ortakBasliklar);
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': MIME_TIPLERI[uzanti] || 'application/octet-stream',
    'Content-Length': bilgi.size,
    ...ortakBasliklar,
  });

  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(dosyaYolu).pipe(res);
}

// Panel yerelde açıldığında girişin de yerel sunucudan geçmesi gerekir; yoksa
// config.yml'deki canlı base_url yüzünden giriş penceresi canlı siteye gider.
// Canlıda bu kod yoluna hiç girilmez, dosya olduğu gibi sunulur.
function yerelMi(req) {
  const sunucu = (req.headers.host || '').split(':')[0];
  return sunucu === 'localhost' || sunucu === '127.0.0.1';
}

function yerelPanelAyari(req, res) {
  return fs.promises
    .readFile(path.join(PUBLIC_DIR, 'admin', 'config.yml'), 'utf8')
    .then((metin) => {
      const govde = metin.replace(/^(\s*base_url:).*$/m, `$1 http://${req.headers.host}`);
      yanitla(res, 200, req.method === 'HEAD' ? undefined : govde, {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    })
    .catch(() => bulunamadi(req, res));
}

function bulunamadi(req, res) {
  fs.promises
    .readFile(path.join(PUBLIC_DIR, '404.html'))
    .then((govde) => {
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : govde);
    })
    .catch(() => {
      yanitla(res, 404, 'Sayfa bulunamadı', { 'Content-Type': 'text/plain; charset=utf-8' });
    });
}

/* ---------------- Yönetici paneli girişi (GitHub OAuth) ---------------- */
//
// Decap CMS tarayıcıdan doğrudan GitHub'a yazamaz; arada bir aracıya ihtiyacı var.
// Aşağıdaki iki uç nokta o aracı. Çalışması için Render'da iki ortam değişkeni
// tanımlı olmalı: GITHUB_CLIENT_ID ve GITHUB_CLIENT_SECRET.

// Anahtarlar Render paneline kopyala-yapıştır ile giriliyor; başa/sona kaçan
// boşluk, satır sonu ya da tırnak işareti GitHub tarafında "yanlış anahtar"
// sayılır ve giriş sessizce başarısız olur. Bu yüzden okurken temizliyoruz.
function ortamDegeri(ad) {
  return (process.env[ad] || '').trim().replace(/^["']|["']$/g, '').trim();
}

const OAUTH_ID = ortamDegeri('GITHUB_CLIENT_ID');
const OAUTH_SECRET = ortamDegeri('GITHUB_CLIENT_SECRET');

// GÜVENLİK: depo herkese açık olduğu için "public_repo" yetiyor. Eskiden "repo"
// isteniyordu; o kapsam anahtara hesabın BÜTÜN özel depolarına da yazma yetkisi
// verir. Depoyu özele çevirirseniz Render'da GITHUB_SCOPE=repo tanımlayın.
const OAUTH_KAPSAM = ortamDegeri('GITHUB_SCOPE') || 'public_repo';

// Ayarlanırsa geri dönüş adresi Host başlığına değil buna göre kurulur; böylece
// sahte Host başlığı gönderen istekler adresi saptıramaz.
// Örnek: SITE_ADRESI=https://www.xn--atailetiim-l9b.com
const GENEL_ADRES = ortamDegeri('SITE_ADRESI').replace(/\/+$/, '');

const bekleyenDurumlar = new Map(); // state -> son kullanma zamanı
const EN_FAZLA_DURUM = 5000;

function durumUret() {
  const durum = crypto.randomBytes(16).toString('hex');
  bekleyenDurumlar.set(durum, Date.now() + 10 * 60 * 1000);
  // Süresi geçmişleri temizle
  for (const [anahtar, bitis] of bekleyenDurumlar) {
    if (bitis < Date.now()) bekleyenDurumlar.delete(anahtar);
  }
  // Art arda /auth isteği yağdırıp belleği şişirmeye karşı üst sınır:
  // en eski kayıtlar düşer (Map ekleme sırasını korur).
  while (bekleyenDurumlar.size > EN_FAZLA_DURUM) {
    bekleyenDurumlar.delete(bekleyenDurumlar.keys().next().value);
  }
  return durum;
}

function kokAdres(req) {
  // Render isteği https olarak iletir. Bu başlık yoksa yereldeyiz demektir;
  // orada TLS olmadığı için http kullanmalıyız, yoksa GitHub var olmayan bir
  // https://localhost adresine geri dönmeye çalışır.
  if (GENEL_ADRES) return GENEL_ADRES;
  const iletilen = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protokol = iletilen || (yerelMi(req) ? 'http' : 'https');
  return `${protokol}://${req.headers.host}`;
}

function girisBaslat(req, res) {
  if (!OAUTH_ID || !OAUTH_SECRET) {
    return yanitla(res, 503, 'Yönetici girişi henüz yapılandırılmadı: GITHUB_CLIENT_ID ve GITHUB_CLIENT_SECRET tanımlı değil.', {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  }
  const durum = durumUret();
  const hedef = new URL('https://github.com/login/oauth/authorize');
  hedef.searchParams.set('client_id', OAUTH_ID);
  hedef.searchParams.set('redirect_uri', `${kokAdres(req)}/callback`);
  hedef.searchParams.set('scope', OAUTH_KAPSAM);
  hedef.searchParams.set('state', durum);
  res.writeHead(302, { Location: hedef.toString(), 'Cache-Control': 'no-store' });
  res.end();
}

function jetonIste(kod) {
  return new Promise((coz, reddet) => {
    const govde = JSON.stringify({
      client_id: OAUTH_ID,
      client_secret: OAUTH_SECRET,
      code: kod,
    });
    const istek = https.request(
      {
        hostname: 'github.com',
        path: '/login/oauth/access_token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(govde),
          'User-Agent': 'ata-iletisim-sitesi',
        },
      },
      (yanit) => {
        let veri = '';
        yanit.on('data', (parca) => (veri += parca));
        yanit.on('end', () => {
          try {
            coz(JSON.parse(veri));
          } catch {
            reddet(new Error('GitHub yanıtı okunamadı'));
          }
        });
      }
    );
    istek.on('error', reddet);
    istek.setTimeout(15000, () => istek.destroy(new Error('GitHub yanıt vermedi')));
    istek.write(govde);
    istek.end();
  });
}

// GitHub'ın hata kodlarını, paneli kullanan kişinin anlayacağı Türkçeye çevirir.
function jetonHatasiMetni(yanit, kok) {
  switch (yanit.error) {
    case 'incorrect_client_credentials':
      return 'GitHub anahtarları eşleşmiyor. Render → Environment altındaki GITHUB_CLIENT_ID ve GITHUB_CLIENT_SECRET değerlerini GitHub OAuth uygulamasındakiyle birebir aynı yapın.';
    case 'redirect_uri_mismatch':
      return `GitHub uygulamasındaki geri dönüş adresi uyuşmuyor. "Authorization callback URL" tam olarak şu olmalı: ${kok}/callback`;
    case 'bad_verification_code':
      return 'Giriş kodu geçersiz ya da süresi dolmuş. Pencereyi kapatıp tekrar deneyin.';
    default:
      return yanit.error_description || yanit.error || 'Erişim anahtarı alınamadı';
  }
}

function metniKacir(metin) {
  return String(metin).replace(/[&<>]/g, (k) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[k]);
}

// Decap CMS açtığı pencereden postMessage bekler; sonucu o biçimde döneriz.
//
// GÜVENLİK: mesaj yalnızca kendi sitemizin adresine gönderilir. Eskiden hedef
// olarak '*' kullanılıyordu; o durumda kötü niyetli bir site bu pencereyi kendi
// sayfasından açıp GitHub erişim anahtarını doğrudan okuyabiliyordu.
function kapanisSayfasi(sonuc, yuk, kok) {
  // </script> yazımının betiği erken kapatmasını engellemek için < kaçırılır.
  const mesaj = JSON.stringify(`authorization:github:${sonuc}:${JSON.stringify(yuk)}`).replace(/</g, '\\u003c');
  const hedef = JSON.stringify(kok);
  const basarili = sonuc === 'success';
  const aciklama = basarili
    ? 'Giriş başarılı, pencere kapanıyor…'
    : `Giriş yapılamadı.</p><p style="color:#b00">${metniKacir(yuk.message || '')}`;
  return `<!doctype html><meta charset="utf-8"><title>Giriş</title>
<body style="font-family:system-ui;padding:2rem;line-height:1.6;max-width:38rem">
<p>${aciklama}</p>
<script>
(function () {
  var mesaj = ${mesaj};
  // Adres verilmemişse sayfanın kendi adresi zaten doğru hedeftir (aynı site).
  var hedef = ${hedef} || window.location.origin;
  function gonder() {
    if (!window.opener) return;
    window.opener.postMessage(mesaj, hedef);
  }
  window.addEventListener('message', gonder, false);
  if (window.opener) window.opener.postMessage('authorizing:github', hedef);
  setTimeout(function () { gonder(); }, 300);
  // Hata varsa pencere açık kalsın; yoksa sebep okunamadan kapanıyor.
  ${basarili ? 'setTimeout(function () { window.close(); }, 1200);' : ''}
})();
</script>
</body>`;
}

async function girisDon(req, res, adres) {
  const sorgu = new URL(adres, 'http://x').searchParams;
  const kod = sorgu.get('code');
  const durum = sorgu.get('state');

  if (!durum || !bekleyenDurumlar.has(durum)) {
    return yanitla(res, 400, kapanisSayfasi('error', { message: 'Oturum doğrulanamadı, tekrar deneyin.' }, kokAdres(req)), {
      'Content-Type': 'text/html; charset=utf-8',
    });
  }
  bekleyenDurumlar.delete(durum);

  if (!kod) {
    return yanitla(res, 400, kapanisSayfasi('error', { message: 'GitHub kod göndermedi.' }, kokAdres(req)), {
      'Content-Type': 'text/html; charset=utf-8',
    });
  }

  try {
    const yanit = await jetonIste(kod);
    if (!yanit.access_token) {
      console.error('GitHub jeton hatası:', yanit.error, '-', yanit.error_description);
      throw new Error(jetonHatasiMetni(yanit, kokAdres(req)));
    }
    yanitla(res, 200, kapanisSayfasi('success', { token: yanit.access_token, provider: 'github' }, kokAdres(req)), {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  } catch (hata) {
    console.error('OAuth hatası:', hata.message);
    yanitla(res, 500, kapanisSayfasi('error', { message: hata.message }, kokAdres(req)), {
      'Content-Type': 'text/html; charset=utf-8',
    });
  }
}

/* ---------------- Sunucu ---------------- */

const server = http.createServer(async (req, res) => {
  const baslangic = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - baslangic}ms)`);
  });

  // Bütün yanıtlara giden güvenlik başlıkları. writeHead ile ayrıca verilen
  // başlıklar bunların üzerine yazar, o yüzden mevcut davranış bozulmaz.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY'); // panelin çerçeveye alınıp tıklama tuzağına düşürülmesini engeller
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if ((req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return yanitla(res, 405, 'Yöntem desteklenmiyor', {
      'Content-Type': 'text/plain; charset=utf-8',
      Allow: 'GET, HEAD',
    });
  }

  const adres = req.url || '/';
  const yol = adres.split('?')[0];

  if (yol === '/saglik' || yol === '/health') {
    return yanitla(res, 200, JSON.stringify({ durum: 'ok', calismaSuresi: Math.round(process.uptime()) }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }

  if (yol === '/auth') return girisBaslat(req, res);
  if (yol === '/callback') return girisDon(req, res, adres);

  if (yol === '/' || yol === '/index.html') return anaSayfaSun(req, res);

  if (yol === '/admin/config.yml' && yerelMi(req)) return yerelPanelAyari(req, res);

  const dosyaYolu = dosyaYoluCoz(adres);
  if (!dosyaYolu) return bulunamadi(req, res);

  try {
    await dosyaSun(req, res, dosyaYolu);
  } catch (hata) {
    if (hata.code === 'ENOENT' || hata.code === 'EISDIR' || hata.code === 'ENOTDIR') {
      // İstenen bir klasörse sonuna eğik çizgi ekleyip yönlendir: /admin -> /admin/
      // Böyle olmazsa klasör içindeki göreli adresler (./config.yml) yanlış çözülür.
      if (hata.code === 'EISDIR' && !yol.endsWith('/')) {
        try {
          await fs.promises.access(path.join(dosyaYolu, 'index.html'));
          const sorgu = adres.slice(yol.length);
          res.writeHead(301, { Location: yol + '/' + sorgu, 'Cache-Control': 'no-cache' });
          return res.end();
        } catch {
          /* klasörde index.html yok, aşağıdaki 404'e düş */
        }
      }
      if (!path.extname(dosyaYolu)) {
        try {
          return await dosyaSun(req, res, dosyaYolu + '.html');
        } catch {
          /* aşağıdaki 404'e düş */
        }
      }
      return bulunamadi(req, res);
    }
    console.error('Sunucu hatası:', hata);
    yanitla(res, 500, 'Sunucu hatası', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
  console.log(`Yönetici girişi: ${OAUTH_ID && OAUTH_SECRET ? 'yapılandırıldı' : 'YAPILANDIRILMADI (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET eksik)'}`);
  // Anahtarların kendisi loga yazılmaz; sadece uzunlukları — yanlış yapıştırma
  // (eksik karakter, satır sonu, tırnak) buradan anlaşılır.
  if (OAUTH_ID || OAUTH_SECRET) {
    console.log(`  GITHUB_CLIENT_ID     : ${OAUTH_ID.length} karakter (beklenen 20)`);
    console.log(`  GITHUB_CLIENT_SECRET : ${OAUTH_SECRET.length} karakter (beklenen 40)`);
    if (OAUTH_SECRET.length !== 40) {
      console.warn('  UYARI: client secret 40 karakterlik değil. GitHub OAuth uygulamasından yeni bir secret üretip Render\'a yapıştırın.');
    }
  }
});

for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, () => {
    console.log(`${sinyal} alındı, sunucu kapatılıyor...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
