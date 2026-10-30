
import http from "node:http";
import { URL } from "node:url";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT || 3000);
const UPSTREAM_ORIGIN = "https://vidfast.vc";

const BLOCKED_HOSTS = new Set([
  "smockeddesmoid.qpon",
  "kappa.suciunsizedzoner.cfd",
  "bc.cuculireactor.qpon",
  "fhvfd.com",
  "hummerleaked.cyou",
  "ee4po43t22i.vujk8juwjkwtzkjr3u7r.cfd",
  "drubbed.lisperscathjct.qpon"
]);

function isBlocked(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");

  return BLOCKED_HOSTS.has(host) ||
    [...BLOCKED_HOSTS].some(domain =>
      host.endsWith("." + domain)
    );
}

// Only block known advertising destinations.
// All other popup behavior remains unchanged.
const POPUP_GUARD = `
<script>
(function () {
  "use strict";

  const blockedHosts = [
    "smockeddesmoid.qpon",
    "kappa.suciunsizedzoner.cfd",
    "bc.cuculireactor.qpon",
    "fhvfd.com",
    "hummerleaked.cyou",
    "ee4po43t22i.vujk8juwjkwtzkjr3u7r.cfd",
    "drubbed.lisperscathjct.qpon"
  ];

  function isAdUrl(value) {
    if (!value || typeof value !== "string") return false;

    try {
      const url = new URL(value, location.href);
      const host = url.hostname.toLowerCase();

      return blockedHosts.some(domain =>
        host === domain || host.endsWith("." + domain)
      );
    } catch (error) {
      return false;
    }
  }

  const originalOpen = window.open;

  window.open = function (url, target, features) {
    if (isAdUrl(url)) {
      console.warn("[VidFast Filter] Advertisement popup blocked:", url);
      return null;
    }

    return originalOpen.call(window, url, target, features);
  };

  console.log("[VidFast Filter] Selective popup protection active");
})();
</script>
`;

function injectPopupGuard(html) {
  // Reuse an existing CSP nonce when the page provides one.
  const nonceMatch = html.match(
    /<script\\b[^>]*\\bnonce=["']([^"']+)["']/i
  );

  let script = POPUP_GUARD;

  if (nonceMatch) {
    const nonce = nonceMatch[1]
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");

    script = script.replace(
      "<script>",
      `<script nonce="${nonce}">`
    );
  }

  const headMatch = html.match(/<head\\b[^>]*>/i);

  if (!headMatch) {
    console.warn("[VidFast Filter] HTML head not found");
    return html;
  }

  return html.replace(
    headMatch[0],
    headMatch[0] + script
  );
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });

  res.end(body);
}

function proxyLocation(location, upstreamUrl, publicOrigin) {
  const target = new URL(location, upstreamUrl);

  if (isBlocked(target.hostname)) {
    return null;
  }

  if (target.hostname === "vidfast.vc") {
    return publicOrigin +
      target.pathname +
      target.search +
      target.hash;
  }

  return target.toString();
}

const server = http.createServer(async (req, res) => {
  try {
    const publicUrl = new URL(
      req.url,
      `https://${req.headers.host || "localhost"}`
    );

    if (publicUrl.pathname === "/health") {
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          service: "vidfast-filter-proxy",
          upstream: UPSTREAM_ORIGIN,
          blockedHostCount: BLOCKED_HOSTS.size,
          popupProtection: "selective",
          version: 5
        }),
        "application/json; charset=utf-8"
      );
    }

    const upstreamUrl = new URL(
      publicUrl.pathname + publicUrl.search,
      UPSTREAM_ORIGIN
    );

    const method = [
      "GET",
      "HEAD",
      "POST",
      "OPTIONS"
    ].includes(req.method) ? req.method : "GET";

    const requestHeaders = new Headers();

    const allowedHeaders = [
      "accept",
      "accept-language",
      "content-type",
      "cookie",
      "range",
      "if-none-match",
      "if-modified-since",
      "user-agent",
      "origin",
      "referer",
      "authorization"
    ];

    for (const name of allowedHeaders) {
      const value = req.headers[name];

      if (value) {
        requestHeaders.set(name, value);
      }
    }

    const init = {
      method,
      headers: requestHeaders,
      redirect: "manual"
    };

    if (method === "POST" || method === "OPTIONS") {
      const chunks = [];

      for await (const chunk of req) {
        chunks.push(chunk);
      }

      if (chunks.length) {
        init.body = Buffer.concat(chunks);
      }
    }

    const upstreamResponse = await fetch(upstreamUrl, init);

    const location = upstreamResponse.headers.get("location");

    if (location) {
      const publicOrigin =
        `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

      const rewritten = proxyLocation(
        location,
        upstreamUrl,
        publicOrigin
      );

      if (!rewritten) {
        return send(res, 204, "");
      }

      res.writeHead(upstreamResponse.status, {
        location: rewritten,
        "cache-control": "no-store"
      });

      return res.end();
    }

    const contentType =
      upstreamResponse.headers.get("content-type") || "";

    const isHtml = contentType.includes("text/html");

    const responseHeaders = {};

    const passHeaders = [
      "content-type",
      "cache-control",
      "etag",
      "last-modified",
      "accept-ranges",
      "content-range",
      "content-disposition",
      "access-control-allow-origin",
      "access-control-allow-methods",
      "access-control-allow-headers",
      "access-control-allow-credentials",
      "vary"
    ];

    for (const name of passHeaders) {
      const value = upstreamResponse.headers.get(name);

      if (value) {
        responseHeaders[name] = value;
      }
    }

    if (
      typeof upstreamResponse.headers.getSetCookie === "function"
    ) {
      const cookies = upstreamResponse.headers.getSetCookie().map(
        cookie => cookie.replace(
          /;\\s*Domain=\\.?vidfast\\.vc/ig,
          ""
        )
      );

      if (cookies.length) {
        responseHeaders["set-cookie"] = cookies;
      }
    }

    responseHeaders["x-content-type-options"] = "nosniff";

    if (isHtml && method !== "HEAD") {
      const html = await upstreamResponse.text();
      const modifiedHtml = injectPopupGuard(html);

      responseHeaders["content-type"] =
        "text/html; charset=utf-8";

      // The HTML changed, so the original validators no longer apply.
      delete responseHeaders.etag;
      delete responseHeaders["last-modified"];
      delete responseHeaders["content-range"];
      delete responseHeaders["accept-ranges"];

      res.writeHead(upstreamResponse.status, responseHeaders);
      return res.end(modifiedHtml);
    }

    if (!responseHeaders["content-type"]) {
      responseHeaders["content-type"] =
        "application/octet-stream";
    }

    res.writeHead(upstreamResponse.status, responseHeaders);

    if (method === "HEAD" || !upstreamResponse.body) {
      return res.end();
    }

    Readable.fromWeb(upstreamResponse.body).pipe(res);

  } catch (error) {
    console.error("Proxy error:", error);

    if (!res.headersSent) {
      send(res, 502, "Upstream request failed");
    } else {
      res.destroy(error);
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `VidFast Filter Proxy v5 listening on ${PORT}`
  );
});
