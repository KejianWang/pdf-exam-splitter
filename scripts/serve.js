const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../public');
const port = Number(process.env.PORT || process.argv[2] || 5173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.pdf': 'application/pdf',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  let filePath = path.normalize(decodeURIComponent(url.pathname));
  if (filePath === '/' || filePath === '\\') filePath = '/index.html';
  if (filePath.endsWith('/share-target/')) filePath = '/index.html';
  const abs = path.resolve(root, `.${filePath}`);
  if (!abs.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(abs)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`PDF试卷切分助手已启动：http://127.0.0.1:${port}`);
});
