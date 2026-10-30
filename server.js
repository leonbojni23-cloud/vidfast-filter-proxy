
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

// Runs before VidFast scripts.
const POPUP_GUARD = `
<script>
(function () {
  "use strict";

  // Block all script-created popup windows.
  try {
    Object.defineProperty(window, "open", {
      value: function () {
        console.warn("[VidFast Filter] Popup blocked");
        return null;
      },
      writable: false,
      configurable: false
    });
  } catch (e) {
    window.open = function () {
      console.warn("[VidFast Filter] Popup blocked");
      return null;
    };
  }

  function shouldBlockLink(element) {
    if (!element || !element.getAttribute) return false;

    const target = (
      element.getAttribute("target") || ""
    ).toLowerCase();

    if (!target || target === "_self" ||
        target === "_top" || target === "_parent") {
      return false;
    }

    const href = element.getAttribute("href");
    if (!href || href.startsWith("javascript:")) {
      return false;
    }

    try {
      const url = new URL(href, location.href);
      return url.origin !== location.origin;
    } catch (e) {
      return false;
    }
  }

  // Stop links that try to open external tabs.
  document.addEventListener("click", function (event) {
    const link = event.target.closest &&
      event.target.closest("a");

    if (shouldBlockLink(link)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      console.warn("[VidFast Filter] External tab blocked");
    }
  }, true);

  document.addEventListener("auxclick", function (event) {
    const link = event.target.closest &&
      event.target.closest("a");

    if (shouldBlockLink(link)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // Stop forms from opening new tabs.
  document.addEventListener("submit", function (event) {
    const form = event.target;
    const target = (
      form.getAttribute("target") || ""
    ).toLowerCase();

    if (target && target !== "_self" &&
        target !== "_top" && target !== "_parent") {
      event.preventDefault();
      event.stopImmediatePropagation();
      console.warn("[VidFast Filter] Popup form blocked");
    }
  }, true);

  console.log("[VidFast Filter] Popup protection active");
})();
</script>
`;

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
    return publicOrigin + target.pathname +
      target.search + target.hash;
  }

  return target.toString();
}

function injectPopupGuard(html) {
  // Remove restrictive HTML meta CSP before injecting our script.
  html = html.replace(
    /<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/ig,
    ""
  );

  const headMatch = html.match(/<head\b[^>]*>/i);

  if (headMatch) {
    return html.replace(
      headMatch[0],
      headMatch[0] + POPUP_GUARD
    );
  }

  return POPUP_GUARD + html;
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
          popupProtection: true,
          version: 4
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
          /;\s*Domain=\.?vidfast\.vc/ig,
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

      // Body changed, so old validators and lengths are invalid.
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
    `VidFast Filter Proxy v4 listening on ${PORT}`
  );
});
