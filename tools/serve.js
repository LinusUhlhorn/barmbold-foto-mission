// Kleiner Entwicklungsserver, damit die App lokal im Browser läuft.
//
// Warum überhaupt ein Server?
// Die App nutzt JavaScript-Module (import/export). Öffnet man index.html
// direkt per Doppelklick, blockiert der Browser das aus Sicherheitsgründen.
//
// Aufruf:  npm start
// Danach:  http://localhost:5173

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((request, response) => {
  let requestPath;
  try {
    requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Ungültige Adresse');
    return;
  }

  // Verzeichniswechsel nach oben verhindern.
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403).end('Nicht erlaubt');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<h1>404 – nicht gefunden</h1><p><a href="/">Zur Startseite</a></p>');
    return;
  }

  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  response.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Foto-Mission läuft lokal:');
  console.log('');
  console.log(`    App:        http://localhost:${PORT}/`);
  console.log(`    Testmodus:  http://localhost:${PORT}/?test=1`);
  console.log(`    Album:      http://localhost:${PORT}/album/`);
  console.log(`    QR-Druck:   http://localhost:${PORT}/qr-print.html`);
  console.log('');
  console.log('  Beenden mit Strg + C');
  console.log('');
});
