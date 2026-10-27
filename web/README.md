# Web source

From this folder, run `npm ci` and `npm run dev`, then open http://127.0.0.1:5174/.

The default synthetic preview uses the production pitch, stadium and player-rendering components. Its positions
and poses are generated from hand-authored formulas in `src/sample/scene.ts`. It makes no match-data or model
requests. This is a source-verification scene, not the complete licensed-data demonstration.

`src/GameApp.tsx` contains the full data-dependent application. `/app.html` is a separate entry for developers who
already have a compatible authorized local pack mounted at `public/data`. No such pack is included, and it must
not be committed. Default builds do not copy `public/data`; only the explicit favicon and preview image are public.

The private release exporter and identity mapping are intentionally absent. The public Vite configuration contains
no decryption key or private endpoint. Use the live demo linked in the root README for the full experience.

Checks: `npm run build`, `npm run lint`, `npm test`, `node --test scripts/*.node-test.mjs`.
