// Basit, boş bir site - sadece "Merhaba" yazar.
// Hiçbir ek pakete (Express vb.) ihtiyaç yok, Node'un kendi http modülünü kullanır.

const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Merhaba</title></head><body><h1>Merhaba</h1></body></html>');
});

server.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});
