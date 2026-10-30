import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const UPSTREAM = "https://vidfast.vc";

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
    [...BLOCKED_HOSTS].some(domain => host.endsWith("." + domain));
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const incoming = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (incoming.pathname === "/health") {
      return send(res, 200, JSON.stringify({
        ok: true,
        service: "vidfast-filter-proxy",
        upstream: UPSTREAM,
        blockedHostCount: BLOCKED_HOSTS.size
      }), "application/json; charset=utf-8");
    }

    // Only proxy paths beneath /v/
    if (!incoming.pathname.startsWith("/v/")) {
      return send(res, 404, "Not found. Use /v/movie/ID or /v/tv/ID/SEASON/EPISODE");
    }

    const upstreamPath = incoming.pathname.slice(2) + incoming.search;
    const target = new URL(upstreamPath, UPSTREAM);

    if (target.hostname !== "vidfast.vc") {
      return send(res, 403, "Upstream host is not allowed");
    }

    const headers = {
      "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
      "accept": req.headers.accept || "*/*",
      "accept-language": req.headers["accept-language"] || "en-US,en;q=0.9",
      "referer": UPSTREAM + "/"
    };

    if (req.headers.range) headers.range = req.headers.range;
    if (req.headers["if-none-match"]) headers["if-none-match"] = req.headers["if-none-match"];
    if (req.headers["if-modified-since"]) headers["if-modified-since"] = req.headers["if-modified-since"];

    const upstreamResponse = await fetch(target, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "manual"
    });

    const location = upstreamResponse.headers.get("location");
    if (location) {
      const redirect = new URL(location, target);
      if (isBlocked(redirect.hostname)) {
        return send(res, 204, "");
      }
      if (redirect.hostname === "vidfast.vc") {
        redirect.protocol = "https:";
        redirect.host = req.headers.host;
        redirect.pathname = "/v" + redirect.pathname;
        res.writeHead(upstreamResponse.status, {
          location: redirect.toString(),
          "cache-control": "no-store"
        });
        return res.end();
      }
      res.writeHead(upstreamResponse.status, {
        location: redirect.toString(),
        "cache-control": "no-store"
      });
      return res.end();
    }

    const contentType = upstreamResponse.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await upstreamResponse.arrayBuffer());

    // This first pass intentionally does not rewrite JavaScript or media URLs.
    // It is a diagnostic transport layer, not a complete ad blocker.
    const responseHeaders = {
      "content-type": contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    };

    const contentLength = upstreamResponse.headers.get("content-length");
    if (contentLength && req.method === "HEAD") {
      responseHeaders["content-length"] = contentLength;
    }

    res.writeHead(upstreamResponse.status, responseHeaders);
    if (req.method === "HEAD") return res.end();
    res.end(body);
  } catch (error) {
    console.error("Proxy error:", error);
    send(res, 502, "Upstream request failed");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`VidFast filter proxy listening on ${PORT}`);
});
