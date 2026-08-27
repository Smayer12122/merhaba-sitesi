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

let onbellek = { html: null, damga: 0 };

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
  const { icerik, damga: icerikDamgasi } = icerikTopla();
  const damga = fs.statSync(SABLON_DOSYASI).mtimeMs + icerikDamgasi;

  if (onbellek.html && onbellek.damga === damga) return onbellek.html;

  const sablon = fs.readFileSync(SABLON_DOSYASI, 'utf8');
  const html = derle(sablon)(icerik);

  onbellek = { html, damga };
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

const OAUTH_ID = process.env.GITHUB_CLIENT_ID || '';
const OAUTH_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const bekleyenDurumlar = new Map(); // state -> son kullanma zamanı

function durumUret() {
  const durum = crypto.randomBytes(16).toString('hex');
  bekleyenDurumlar.set(durum, Date.now() + 10 * 60 * 1000);
  // Süresi geçmişleri temizle
  for (const [anahtar, bitis] of bekleyenDurumlar) {
    if (bitis < Date.now()) bekleyenDurumlar.delete(anahtar);
  }
  return durum;
}

function kokAdres(req) {
  const protokol = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
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
  hedef.searchParams.set('scope', 'repo,user');
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

// Decap CMS açtığı pencereden postMessage bekler; sonucu o biçimde döneriz.
function kapanisSayfasi(sonuc, yuk) {
  const mesaj = JSON.stringify(`authorization:github:${sonuc}:${JSON.stringify(yuk)}`);
  return `<!doctype html><meta charset="utf-8"><title>Giriş</title>
<body style="font-family:system-ui;padding:2rem">
<p>${sonuc === 'success' ? 'Giriş başarılı, pencere kapanıyor…' : 'Giriş yapılamadı.'}</p>
<script>
(function () {
  var mesaj = ${mesaj};
  function gonder(e) {
    if (!window.opener) return;
    window.opener.postMessage(mesaj, e && e.origin ? e.origin : '*');
  }
  window.addEventListener('message', gonder, false);
  if (window.opener) window.opener.postMessage('authorizing:github', '*');
  setTimeout(function () { gonder(); }, 300);
  setTimeout(function () { window.close(); }, 1200);
})();
</script>
</body>`;
}

async function girisDon(req, res, adres) {
  const sorgu = new URL(adres, 'http://x').searchParams;
  const kod = sorgu.get('code');
  const durum = sorgu.get('state');

  if (!durum || !bekleyenDurumlar.has(durum)) {
    return yanitla(res, 400, kapanisSayfasi('error', { message: 'Oturum doğrulanamadı, tekrar deneyin.' }), {
      'Content-Type': 'text/html; charset=utf-8',
    });
  }
  bekleyenDurumlar.delete(durum);

  if (!kod) {
    return yanitla(res, 400, kapanisSayfasi('error', { message: 'GitHub kod göndermedi.' }), {
      'Content-Type': 'text/html; charset=utf-8',
    });
  }

  try {
    const yanit = await jetonIste(kod);
    if (!yanit.access_token) {
      throw new Error(yanit.error_description || 'Erişim anahtarı alınamadı');
    }
    yanitla(res, 200, kapanisSayfasi('success', { token: yanit.access_token, provider: 'github' }), {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  } catch (hata) {
    console.error('OAuth hatası:', hata.message);
    yanitla(res, 500, kapanisSayfasi('error', { message: hata.message }), {
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
});

for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, () => {
    console.log(`${sinyal} alındı, sunucu kapatılıyor...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
