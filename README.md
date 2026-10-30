# VidFast filter proxy v2

## Changes
- Proxies root-level paths such as `/_next/static/...` as well as player URLs.
- Passes the real upstream content type, so CSS and JavaScript are not returned as `text/plain`.
- Streams media responses rather than buffering the entire response.
- Passes common request headers, POST bodies, and response cookies.
- Rewrites redirects back to `vidfast.vc` so they remain on this proxy.
- Keeps the `/health` endpoint.

## Deploy update on Render
1. Replace `server.js` in the GitHub repository with this version.
2. Replace `package.json` too (version 0.2.0).
3. Commit the changes to `main`.
4. Render should automatically redeploy.
5. Check `/health`; it should report `"version": 2`.

## Test
Open:
`https://YOUR-SERVICE.onrender.com/v/movie/155?autoPlay=true`

This is still an experimental reverse proxy, not a complete ad blocker. Third-party URLs embedded inside VidFast JavaScript may still be called directly by the browser. Do not integrate it into the LG app until the page and playback have been tested.
