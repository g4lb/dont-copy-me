import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { isInside } from './paths.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export interface RequestLogEntry {
  method: string;
  path: string;
  status: number;
  bytes: number;
  userAgent: string;
}

export interface StaticServer {
  url: string;
  port: number;
  requests: RequestLogEntry[];
  close(): Promise<void>;
}

export interface StaticServerOptions {
  root: string;
  port?: number;
  host?: string;
  spaFallback?: boolean;
}

async function statFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Minimal, dependency-free static file server for local verification and benchmarks. It binds
 * to loopback, rejects path traversal and never serves `.git`. Every request is logged so
 * benchmarks can count what an agent downloaded.
 */
export async function startStaticServer(options: StaticServerOptions): Promise<StaticServer> {
  const root = path.resolve(options.root);
  const requests: RequestLogEntry[] = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      const method = req.method ?? 'GET';
      const log = (status: number, bytes: number): void => {
        requests.push({ method, path: req.url ?? '/', status, bytes, userAgent: String(req.headers['user-agent'] ?? '') });
      };
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' }).end();
        log(405, 0);
        return;
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      } catch {
        res.writeHead(400).end();
        log(400, 0);
        return;
      }
      if (pathname.includes('\0') || pathname.split('/').includes('.git')) {
        res.writeHead(404).end();
        log(404, 0);
        return;
      }
      let file = path.join(root, pathname);
      if (!isInside(root, file)) {
        res.writeHead(403).end();
        log(403, 0);
        return;
      }
      if (!pathname.endsWith('/') && (await statFile(path.join(file, 'index.html')))) {
        // Directory without trailing slash: redirect like nginx/Apache/`serve` so relative URLs resolve.
        const query = (req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : '';
        res.writeHead(301, { location: `${encodeURI(pathname)}/${query}`, 'cache-control': 'no-store' }).end();
        log(301, 0);
        return;
      }
      if (pathname.endsWith('/')) file = path.join(file, 'index.html');
      let found = await statFile(file);
      if (!found && !path.extname(file) && (await statFile(`${file}.html`))) {
        file = `${file}.html`;
        found = true;
      }
      if (!found && !path.extname(pathname) && options.spaFallback !== false) {
        file = path.join(root, 'index.html');
        found = await statFile(file);
      }
      if (!found) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('Not found');
        log(404, 9);
        return;
      }
      const stat = await fs.stat(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      log(200, stat.size);
      if (method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export async function findFreePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
