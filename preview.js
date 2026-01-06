/*
 Copyright (c) 2026 EricZhao
 Licensed under GNU GPL v3: https://www.gnu.org/licenses/gpl-3.0.html
*/

import http from 'http';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { runBuild } from './build.js';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = new URL(req.url, 'http://localhost').pathname;
    const safePath = path.normalize(decodeURIComponent(urlPath));
    const candidate = path.join(DIST, safePath);

    if (!candidate.startsWith(DIST)) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    const filePath = await resolvePath(candidate);
    if (!filePath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const data = await fsp.readFile(filePath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch (err) {
    res.writeHead(500);
    res.end('Server error');
    console.error(err);
  }
});

await runBuild();
startWatch();

server.listen(PORT, () => {
  console.log(`Preview server running at http://localhost:${PORT}`);
  console.log(`Serving ${DIST}`);
});

async function resolvePath(candidate) {
  try {
    const stats = await fsp.stat(candidate);
    if (stats.isDirectory()) {
      const indexPath = path.join(candidate, 'index.html');
      await fsp.access(indexPath);
      return indexPath;
    }
    return candidate;
  } catch (err) {
    return null;
  }
}

function startWatch() {
  const targets = [
    path.join(ROOT, 'content'),
    path.join(ROOT, 'theme'),
    path.join(ROOT, 'site.config.json'),
    path.join(ROOT, 'build.js')
  ];

  let timer = null;
  let rebuilding = false;

  const trigger = (reason) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (rebuilding) return;
      rebuilding = true;
      try {
        await runBuild();
        console.log(`[preview] rebuilt due to ${reason}`);
      } catch (err) {
        console.error('[preview] rebuild failed', err);
      } finally {
        rebuilding = false;
      }
    }, 150);
  };

  for (const target of targets) {
    try {
      fs.watch(target, { recursive: true }, (_event, filename) => {
        const name = filename ? `${path.basename(target)}/${filename}` : path.basename(target);
        trigger(name);
      });
      console.log(`[preview] watching ${target}`);
    } catch (err) {
      console.warn(`[preview] cannot watch ${target}`, err.message);
    }
  }
}
