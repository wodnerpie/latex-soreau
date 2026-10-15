# LaTeX equation editor

Live at **https://latex.soreau.eu**. A small equation editor, not a full LaTeX document compiler.

- Live vector preview; incomplete input never replaces the last valid equation with a large error.
- CodeMirror editor with command autocomplete, editable snippets, undo, and quick-insert templates.
- SVG, PNG, JPG, WebP, and raw `.tex` exports; copy source or PNG to the clipboard.
- Black, white, or custom equation/background colors; transparency; font size, padding, image scale, and JPEG/WebP quality.
- Local draft saving (optional), share links, light/dark/system themes, and mobile layout.
- A focused default view: editor, preview, format, and download. Insert, More, Appearance, Export options, and Settings menus reveal secondary tools only when needed.
- Browser-only rendering. No API, accounts, equation uploads, external assets, analytics, or tracking.

## Develop

Node.js 24+:

```sh
npm ci
npm run dev
```

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

`npm run preview` serves the production build locally. Tests use port 4173. To test the deployed site:

```sh
SITE_URL=https://latex.soreau.eu npm run test:e2e
```

## How it works

Vite + TypeScript, native HTML controls, CodeMirror 6, and MathJax 3's TeX-to-SVG renderer in a dedicated web worker. SVG exports contain glyph paths and do not depend on installed fonts. Raster exports use browser canvas, with dimension/memory limits. Only the TeX packages listed in `src/render.ts` are enabled; dynamic package loading, HTML, and URL commands are disabled. Macro/input limits and a worker watchdog contain expensive or recursive expressions.

The worker returns either a successful SVG or a short error. The UI only replaces the preview after a successful render, ignores superseded responses, and labels stale previews explicitly. Image exports use the visible last valid equation; `.tex` exports always use the current source. Display style changes may temporarily leave the previous rendering visible while a new result is pending.

`src/export.ts` controls standalone SVG sizing/colors and canvas image exports. MathJax's `PACKAGE_VERSION` is injected at build time so its Node-only version loader is never executed in browsers or under strict CSP.

### Limitations

- MathJax supports mathematical LaTeX, not document preambles, arbitrary packages, or full `.tex` documents.
- JPG cannot have an alpha channel; transparent JPG exports use white (the interface warns you).
- `\\unicode` or text characters outside MathJax's math fonts can rely on system fonts; standard math glyphs export as paths.
- Clipboard image support depends on the browser; PNG download is the fallback.
- Share links put source in the URL fragment, not on the server. Anyone with the link can read it. Very long equations should be shared as `.tex` instead.
- Drafts are stored in localStorage on this browser only. Turn saving off to remove the saved source. No cross-device sync.

## Deployment

The VPS uses the existing `coolify-proxy` Traefik instance and external Docker network `coolify`. The site has its own Compose project in `/opt/latex-soreau`, with no published host ports. Traefik routes `latex.soreau.eu` to port 8080 and obtains/renews the Let's Encrypt certificate. No changes to the shared proxy configuration are required.

```sh
# In a checked-out copy at /opt/latex-soreau on the VPS:
docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

The production image serves only the compiled static files using non-root Nginx. Its filesystem is read-only with a small temporary filesystem, dropped capabilities, resource limits, log rotation, a health check, strict script CSP, and no backend database.

To deploy from this workstation without installing GitHub credentials on the VPS:

```sh
git archive --format=tar.gz -o latex-soreau.tar.gz HEAD
scp latex-soreau.tar.gz root@141.94.78.227:/opt/latex-soreau/source.tar.gz
ssh root@141.94.78.227 'cd /opt/latex-soreau && tar -xzf source.tar.gz && docker compose up -d --build'
```

Keep the previous image tagged before updating if you need image-level rollback. CI checks builds, renderer/export tests, and Chromium user workflows; deployments are explicit rather than automatic.
