# VidFast filter proxy (diagnostic starter)

This is a small Node.js service intended for a first deployment/test on Render.

## What it currently does
- Provides `/health`.
- Proxies `/v/...` requests to `https://vidfast.vc`.
- Restricts the upstream host to `vidfast.vc`.
- Drops upstream redirects to the known ad/redirect hosts observed in the browser trace.

## Important limitation
This is **not yet a complete popup/ad blocker**. VidFast's page can load scripts and make requests directly to third-party hosts. A normal HTTP reverse proxy cannot filter those requests unless the HTML, scripts, and resource URLs are also rewritten consistently. This starter deliberately does not rewrite them, because a careless rewrite can break playback, subtitles, DRM, or autoplay.

Do not point the LG app at this proxy yet. First deploy it and verify `/health`; then we can add controlled HTML/script rewriting and test the player before changing `features/details.js`.

## Render setup
- New Web Service
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

After deployment, test:
- `https://YOUR-SERVICE.onrender.com/health`
- `https://YOUR-SERVICE.onrender.com/v/movie/155?autoPlay=true`

The second URL is only a diagnostic test. It may not play correctly until the rewriting stage is implemented.
