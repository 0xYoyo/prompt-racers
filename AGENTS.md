# Base44 environment notes

- The game is a single self-contained `dist/index.html` built by `tools/build.mjs`
  (esbuild, three.js vendored in `vendor/`). No backend, no database, no secrets,
  zero network at runtime.
- For the sandbox preview, `tools/devserve.mjs` rebuilds `dist/index.html` on any
  change under `src/` or `vendor/` and serves it on port 3000. Started by
  `docker-compose.base44.yml` (node:22, repo bind-mounted at /app).
- There is no HMR: after editing `src/`, the rebuild is automatic but the browser
  needs a page reload to pick it up.
- Verify: `curl -sf localhost:3000 | head`, and `npm run gate` for the full suite
  (some gates need Chrome via puppeteer-core and won't run in this container).
