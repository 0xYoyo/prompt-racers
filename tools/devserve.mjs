// Dev server for the sandbox/preview: rebuilds dist/index.html when src/ changes
// and serves it over HTTP. Production is still a single self-contained file.
import { createServer } from 'http';
import { readFileSync, watch } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist/index.html');
const PORT = Number(process.env.PORT || 3000);

function build() {
  const r = spawnSync(process.execPath, [resolve(root, 'tools/build.mjs'), '--dev'], { stdio: 'inherit' });
  if (r.status !== 0) console.error('[devserve] build failed');
}

build();

let timer = null;
for (const dir of ['src', 'vendor']) {
  watch(resolve(root, dir), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(build, 150);
  });
}

createServer((req, res) => {
  try {
    const html = readFileSync(dist);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('build not ready');
  }
}).listen(PORT, '0.0.0.0', () => console.log(`[devserve] http://0.0.0.0:${PORT}`));
