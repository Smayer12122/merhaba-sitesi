// Basit, bağımlılıksız statik site sunucusu.
// Express vb. hiçbir pakete ihtiyaç yok; sadece Node'un http, fs ve path modülleri.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TIPLERI = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

// Dosya adlarında sürüm damgası yok; bu yüzden metin varlıkları "no-cache" ile
// işaretlenir. Tarayıcı yine önbelleğe alır ama her seferinde ETag ile doğrular,
// değişmemişse 304 alır. Böylece deploy sonrası kimse eski CSS/JS ile kalmaz.
// Görsel ve fontlar nadiren değiştiği için bir gün önbellekte tutulur.
const TAZE_KALSIN = new Set(['.html', '.css', '.js', '.json']);

function onbellekKurali(uzanti) {
  return TAZE_KALSIN.has(uzanti) ? 'no-cache' : 'public, max-age=86400';
}

// Dosyanın boyutu ve değiştirilme zamanından üretilen zayıf etiket.
function etiketUret(bilgi) {
  return `W/"${bilgi.size.toString(16)}-${bilgi.mtimeMs.toString(16)}"`;
}

// İstenen adresi public/ içindeki bir dosya yoluna çevirir.
// public/ dışına çıkma denemesinde null döner.
function dosyaYoluCoz(adres) {
  let cozulmus;
  try {
    cozulmus = decodeURIComponent(adres.split('?')[0].split('#')[0]);
  } catch {
    return null; // bozuk yüzde kodlaması
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

  // Tarayıcıdaki kopya hâlâ geçerliyse gövdeyi hiç göndermeden 304 dön.
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

  // Render'ın health check ayarına doğrudan verilebilecek uç nokta.
  if (adres === '/saglik' || adres === '/health') {
    return yanitla(res, 200, JSON.stringify({ durum: 'ok', calismaSuresi: Math.round(process.uptime()) }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }

  const dosyaYolu = dosyaYoluCoz(adres);
  if (!dosyaYolu) return bulunamadi(req, res);

  try {
    await dosyaSun(req, res, dosyaYolu);
  } catch (hata) {
    if (hata.code === 'ENOENT' || hata.code === 'EISDIR' || hata.code === 'ENOTDIR') {
      // Uzantısız adresler de çalışsın: /hakkinda -> public/hakkinda.html
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
});

// Render deploy sırasında SIGTERM gönderir; açık istekleri tamamlayıp kapan.
for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, () => {
    console.log(`${sinyal} alındı, sunucu kapatılıyor...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
