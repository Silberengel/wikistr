#!/usr/bin/env node
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PROXY_PORT || process.env.BIBLE_GATEWAY_PROXY_PORT || 8090);
const ALLOW_ORIGINS = (process.env.PROXY_ALLOW_ORIGIN || '*')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const USER_AGENT = process.env.PROXY_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 30_000); // Increased to 30 seconds for Bible Gateway
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

async function proxyRequest(targetUrl, res, retryCount = 0) {
  const MAX_RETRIES = 3;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Use a more browser-like user agent and headers for Bible Gateway
    const isBibleGateway = targetUrl.includes('biblegateway.com');
    const fetchHeaders = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0'
    };
    
    const upstream = await fetch(targetUrl, {
      signal: controller.signal,
      headers: fetchHeaders,
      // Add redirect handling
      redirect: 'follow'
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
  } catch (error) {
    clearTimeout(timeout);
    
    // Handle DNS/network errors with retry
    const isRetryableError = 
      error.message?.includes('EAI_AGAIN') ||
      error.message?.includes('getaddrinfo') ||
      error.message?.includes('ENOTFOUND') ||
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('ETIMEDOUT') ||
      (error.name === 'TypeError' && error.message?.includes('fetch failed'));
    
    if (isRetryableError && retryCount < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff, max 5s
      console.log(`[proxy] Retryable error (attempt ${retryCount + 1}/${MAX_RETRIES}), retrying in ${delay}ms:`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
      return proxyRequest(targetUrl, res, retryCount + 1);
    }
    
    // Handle abort/timeout errors more gracefully
    if (error.name === 'AbortError' || error.message?.includes('aborted')) {
      console.error('[proxy] Request timeout or aborted for', targetUrl);
      if (!res.writableEnded) {
        res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Request timeout - upstream server took too long to respond' }));
      }
      return;
    }
    
    // Re-throw other errors to be handled by the caller
    throw error;
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
        usage: '/sites/?url=https://example.com',
        port: PORT
      })
    );
    return;
  }

  const prefix = '/sites';
  if (!path.startsWith(prefix)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Only /sites/?url=... is supported' }));
    return;
  }

  // Get URL from query parameter
  const urlParam = requestUrl.searchParams.get('url');
  if (!urlParam) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Missing url query parameter. Use /sites/?url=https://example.com' }));
    return;
  }

  let targetUrl;
  try {
    const parsed = new URL(urlParam);
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy server listening on http://0.0.0.0:${PORT}/sites/?url=...`);
});

server.on('error', (err) => {
  console.error('Proxy server error', err);
  process.exit(1);
});

