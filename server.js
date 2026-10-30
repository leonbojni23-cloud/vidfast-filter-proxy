
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
  "ee4po43t22i.vujk8juwjkwtzkjr3u7r.cfd"
]);

function isBlocked(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");

  return BLOCKED_HOSTS.has(host) ||
    [...BLOCKED_HOSTS].some(domain =>
      host.endsWith("." + domain)
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
    return publicOrigin + target.pathname +
      target.search + target.hash;
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
          version: 3
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

    if (!responseHeaders["content-type"]) {
      responseHeaders["content-type"] =
        "application/octet-stream";
    }

    responseHeaders["x-content-type-options"] = "nosniff";

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
    `VidFast filter proxy v3 listening on ${PORT}`
  );
});
