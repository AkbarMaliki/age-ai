// Tiny static server (ES modules don't load from file://). Usage: node server.cjs [port]
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = +process.argv[2] || 8772;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.log(`Port ${port} sudah dipakai - server Abad Kerajaan kemungkinan sudah berjalan. Buka http://localhost:${port}`);
  else console.log('Server error:', e.message);
}).listen(port, () => console.log(`Abad Kerajaan: http://localhost:${port}`));
