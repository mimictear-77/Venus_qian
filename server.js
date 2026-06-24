// 转念教练·小钱钱 —— Node.js 单文件本地开发服务
// 功能：1) 静态文件 (index.html / picture) 2) /api/chat 代理 DeepSeek
// 要求：Node.js >= 18（内置 fetch）

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const { Readable } = require('stream');
const { buildSystemMessages } = require('./systemPrompt.js');

// ── 加载同目录下的 .env（无依赖，简易实现） ──────────────
(function loadEnv() {
  try {
    const content = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    content.split(/\r?\n/).forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const eq = line.indexOf('=');
      if (eq === -1) return;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    });
  } catch (_) { /* 没 .env 也没关系，可能用系统环境变量 */ }
})();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.txt':  'text/plain; charset=utf-8',
};

// 禁止通过 HTTP 拿到的文件名（密钥、源码等）
const BLOCKED = new Set(['.env', 'server.js', 'systemPrompt.js', 'package.json', 'package-lock.json']);

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };
}

// ── /api/chat 处理 ───────────────────────────────────────
async function handleChat(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let parsed;
  try { parsed = JSON.parse(body); }
  catch (_) {
    res.writeHead(400, cors());
    return res.end('Invalid JSON');
  }

  const { messages, name, date } = parsed;
  if (!messages || !Array.isArray(messages)) {
    res.writeHead(400, cors());
    return res.end('Missing messages');
  }

  // 静态提示词在前（可被缓存的固定前缀），姓名/日期紧随其后
  const fullMessages = [
    ...buildSystemMessages(name, date),
    ...messages,
  ];

  const apiBase = 'https://api.deepseek.com';
  const apiKey  = process.env.DEEPSEEK_KEY;
  const model   = 'deepseek-chat';

  if (!apiKey) {
    res.writeHead(500, { ...cors(), 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: { message: '服务器未配置 DEEPSEEK_KEY 环境变量' }
    }));
  }

  try {
    const upstream = await fetch(`${apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, max_tokens: 700, temperature: 0.7, stream: true, messages: fullMessages }),
    });

    if (!upstream.ok || !upstream.body) {
      const t = await upstream.text().catch(() => '');
      res.writeHead(upstream.status || 500, { ...cors(), 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: `上游错误 ${upstream.status}: ${t.slice(0, 200)}` } }));
    }

    // 把 DeepSeek 的 SSE 流原样转发给前端
    res.writeHead(200, {
      ...cors(),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    res.writeHead(500, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: e.message } }));
  }
}

// ── 静态文件 ─────────────────────────────────────────────
function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(url.parse(req.url).pathname); }
  catch (_) {
    res.writeHead(400, cors());
    return res.end('Bad URL');
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // 防目录穿越
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, cors());
    return res.end('Forbidden');
  }
  // 屏蔽敏感文件
  if (BLOCKED.has(path.basename(filePath))) {
    res.writeHead(403, cors());
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, cors());
      return res.end('Not found');
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ── 启动 ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors());
    return res.end();
  }
  if (req.url === '/api/chat' && req.method === 'POST') {
    return handleChat(req, res);
  }
  if (req.method === 'GET') {
    return serveStatic(req, res);
  }
  res.writeHead(405, cors());
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  const haveDS = !!process.env.DEEPSEEK_KEY;
  console.log(`[转念教练·小钱钱] 已启动 → http://localhost:${PORT}`);
  console.log(`  DeepSeek: ${haveDS ? '✓' : '✗  未设置 DEEPSEEK_KEY'}`);
});
