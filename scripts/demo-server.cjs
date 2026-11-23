const http = require('node:http');
const { fixture } = require('../tests/fixture.cjs');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fixture(url.searchParams.get('view') || 'original'));
});
server.listen(8765, '127.0.0.1', () => console.log('Moji demo: http://127.0.0.1:8765/paper'));
