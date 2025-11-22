#!/usr/bin/env node
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PROXY_PORT || process.env.BIBLE_GATEWAY_PROXY_PORT || 8090);
const ALLOW_ORIGINS = (process.env.PROXY_ALLOW_ORIGIN || '*')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const USER_AGENT = process.env.PROXY_USER_AGENT || 'wikistr-og-proxy/1.0';
const TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 10_000);
const MAX_BODY_BYTES = Number(process.env.PROXY_MAX_BODY_BYTES || 5 * 1024 * 1024);

function escapeForRegex(value) {
  return value.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');
}

function buildOriginPatterns() {
  if (ALLOW_ORIGINS.length === 0) return [{ hostRegex: /.*/ }];

  return ALLOW_ORIGINS.map((pattern) => {
    if (pattern === '*') {
      return { hostRegex: /.*/ };
    }

    const escaped = escapeForRegex(pattern);

    if (pattern.includes('://')) {
      const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`);
      return { fullRegex: regex };
    }

    const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`, 'i');
    return { hostRegex: regex };
  });
}

const ORIGIN_PATTERNS = buildOriginPatterns();

function matchesOrigin(origin) {
  if (!origin) return undefined;

  try {
    const parsed = new URL(origin);
    for (const pattern of ORIGIN_PATTERNS) {
      if (pattern.fullRegex && pattern.fullRegex.test(origin)) {
        return origin;
      }

      if (pattern.hostRegex && pattern.hostRegex.test(parsed.host)) {
        return origin;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function setCorsHeaders(req, res) {
  const allowedOrigin = matchesOrigin(req.headers.origin);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Origin,Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function proxyRequest(targetUrl, res) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const responseHeaders = {};
    for (const [name, value] of upstream.headers) {
      const lowerName = name.toLowerCase();
      // Skip headers that are no longer valid after decompression
      if (lowerName === 'transfer-encoding') continue;
      if (lowerName === 'content-encoding') continue;
      if (lowerName === 'content-length') continue;
      responseHeaders[name] = value;
    }

    const payload = await upstream.arrayBuffer();

    if (payload.byteLength > MAX_BODY_BYTES) {
      res.writeHead(413, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({ error: 'Upstream response too large' }));
      return;
    }

    // Set Content-Length to the actual decompressed size
    responseHeaders['Content-Length'] = payload.byteLength.toString();
    
    // Ensure Content-Type is set for HTML responses
    if (!responseHeaders['Content-Type'] && upstream.headers.get('content-type')?.includes('text/html')) {
      responseHeaders['Content-Type'] = 'text/html; charset=utf-8';
    }

    res.writeHead(upstream.status, responseHeaders);
    if (payload.byteLength > 0) {
      res.write(Buffer.from(payload));
    }
    res.end();
  } finally {
    clearTimeout(timeout);
  }
}

function handleRequest(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = requestUrl.pathname || '/';

  if (path === '/' || path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        name: 'wikistr-og-proxy',
        status: 'ok',
        targetPath: '/sites/{encoded-url}',
        port: PORT
      })
    );
    return;
  }

  const prefix = '/sites/';
  if (!path.startsWith(prefix)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Only /sites/{encoded-url} is supported' }));
    return;
  }

  const encoded = path.slice(prefix.length);
  if (!encoded) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Missing encoded URL' }));
    return;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Invalid encoded URL' }));
    return;
  }

  let targetUrl;
  try {
    const parsed = new URL(decoded);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Unsupported protocol');
    }
    targetUrl = parsed.toString();
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Target URL must be a valid http/https URL' }));
    return;
  }

  proxyRequest(targetUrl, res).catch((error) => {
    console.error('[proxy] fetch failed', error?.message || error);
    if (!res.writableEnded) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Failed to fetch upstream URL' }));
    }
  });
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Proxy server listening on http://localhost:${PORT}/sites/{encoded-url}`);
});

server.on('error', (err) => {
  console.error('Proxy server error', err);
  process.exit(1);
});

