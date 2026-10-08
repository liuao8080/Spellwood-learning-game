import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { GameService } from "./service.mjs";
import { createQuestionService } from "./questions.mjs";
import { versions, plain } from "./protocol.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".ico": "image/x-icon",
};
const ASSET_TYPES = new Set([
  ".webp",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".mp3",
  ".m4a",
  ".ogg",
  ".wav",
  ".woff2",
  ".glb",
  ".gltf",
  ".bin",
]);
const CLIENT_TYPES = new Set(Object.keys(MIME));
function inventory(root, rel = "", set = new Set()) {
  if (!fs.existsSync(path.join(root, rel))) return set;
  for (const e of fs.readdirSync(path.join(root, rel), {
    withFileTypes: true,
  })) {
    if (e.name.startsWith(".") || e.isSymbolicLink()) continue;
    const name = path.posix.join(rel, e.name);
    if (e.isDirectory()) inventory(root, name, set);
    else if (e.isFile() && ASSET_TYPES.has(path.extname(e.name).toLowerCase()))
      set.add(name);
  }
  return set;
}
function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0,
      done = false;
    const timer = setTimeout(() => endError("REQUEST_TIMEOUT"), 5000);
    timer.unref?.();
    function endError(code) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(Object.assign(Error(code), { code }));
    }
    req.on("data", (b) => {
      n += b.length;
      if (n > limit) {
        endError("PAYLOAD_TOO_LARGE");
        return;
      }
      chunks.push(b);
    });
    req.on("aborted", () => endError("REQUEST_ABORTED"));
    req.on("error", () => endError("REQUEST_ERROR"));
    req.on("end", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(Error("BAD_JSON"), { code: "BAD_JSON" }));
      }
    });
  });
}
export function createGameServer(options = {}) {
  const host = options.host ?? "127.0.0.1",
    port = options.port ?? 4173,
    clientRoot = path.resolve(
      options.clientRoot ?? path.join(ROOT, "client-dist"),
    ),
    assetRoot = path.resolve(
      options.assetRoot ?? path.join(ROOT, "dist/assets"),
    );
  const questions =
      options.questionService ??
      createQuestionService(options.questionOptions || {}),
    assetFiles = inventory(assetRoot),
    study = new Map(),
    httpRates = new Map();
  let origin = "",
    allowedOrigins = new Set(options.allowedOrigins || []),
    closed = false;
  const send = (ws, data) => {
    if (!ws || ws.readyState !== 1) return;
    if (ws.bufferedAmount > 65536) {
      ws.close(1013, "Slow connection");
      return;
    }
    ws.send(JSON.stringify(data));
  };
  const service = new GameService({ questions, send, config: options.config });
  function json(res, status, data) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  }
  function validHost(req) {
    const h = req.headers.host;
    return [...allowedOrigins].some((o) => {
      try {
        return new URL(o).host === h;
      } catch {
        return false;
      }
    });
  }
  function validOrigin(req) {
    return (
      typeof req.headers.origin === "string" &&
      allowedOrigins.has(req.headers.origin)
    );
  }
  function rate(req) {
    const key = req.socket.remoteAddress || "unknown",
      now = Date.now(),
      a = (httpRates.get(key) || []).filter((t) => now - t < 1000);
    if (a.length >= 40) return false;
    a.push(now);
    httpRates.set(key, a);
    return true;
  }
  async function serve(req, res) {
    if (!validHost(req)) {
      json(res, 403, { code: "HOST_REJECTED" });
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, origin).pathname);
    } catch {
      json(res, 400, { code: "BAD_PATH" });
      return;
    }
    if (
      pathname.includes("\0") ||
      pathname.includes("\\") ||
      pathname.split("/").includes("..")
    ) {
      json(res, 404, { code: "NOT_FOUND" });
      return;
    }
    if (pathname === "/health" && ["GET", "HEAD"].includes(req.method)) {
      json(res, 200, { status: "ok", ...versions });
      return;
    }
    if (pathname.startsWith("/api/")) {
      if (!rate(req)) {
        json(res, 429, { code: "RATE_LIMIT" });
        return;
      }
      if (req.headers.origin && !validOrigin(req)) {
        json(res, 403, { code: "ORIGIN_REJECTED" });
        return;
      }
      if (pathname === "/api/curriculum" && req.method === "GET") {
        json(res, 200, questions.metadata());
        return;
      }
      const route = pathname.match(
        /^\/api\/study\/([a-zA-Z0-9_-]{1,80})(\/answer)?$/,
      );
      if (route) {
        const qid = route[1];
        try {
          if (!route[2] && req.method === "GET") {
            const now = Date.now();
            for (const [id, c] of study)
              if (c.expiresAt <= now) study.delete(id);
            if (study.size >= 512) {
              json(res, 429, { code: "STUDY_BUSY" });
              return;
            }
            const c = questions.issueStudy({ qid, expiresAt: now + 300000 });
            study.set(c.challengeId, {
              challenge: c,
              qid,
              expiresAt: c.expiresAt,
              feedback: null,
              optionId: null,
            });
            json(res, 200, questions.toPublic(c));
            return;
          }
          if (route[2] && req.method === "POST") {
            if (!validOrigin(req)) {
              json(res, 403, { code: "ORIGIN_REJECTED" });
              return;
            }
            if (!req.headers["content-type"]?.startsWith("application/json")) {
              json(res, 415, { code: "JSON_REQUIRED" });
              return;
            }
            const p = await readJson(req);
            if (
              !plain(p) ||
              Object.keys(p).some(
                (k) => !["challengeId", "optionId"].includes(k),
              ) ||
              typeof p.challengeId !== "string" ||
              typeof p.optionId !== "string"
            ) {
              json(res, 400, { code: "BAD_ANSWER" });
              return;
            }
            const found = study.get(p.challengeId);
            if (!found || found.qid !== qid || found.expiresAt <= Date.now()) {
              json(res, 410, { code: "STUDY_EXPIRED" });
              return;
            }
            if (found.feedback) {
              if (found.optionId !== p.optionId) {
                json(res, 409, { code: "ALREADY_ANSWERED" });
                return;
              }
              json(res, 200, found.feedback);
              return;
            }
            const feedback = {
              challengeId: p.challengeId,
              ...questions.answer(found.challenge, p.optionId, Date.now()),
            };
            found.feedback = feedback;
            found.optionId = p.optionId;
            json(res, 200, feedback);
            return;
          }
        } catch (e) {
          json(res, e.code === "QUESTION_NOT_FOUND" ? 404 : 400, {
            code: e.code || "STUDY_REJECTED",
          });
          return;
        }
      }
      json(res, 404, { code: "NOT_FOUND" });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      json(res, 405, { code: "METHOD_NOT_ALLOWED" });
      return;
    }
    let root, relative;
    if (pathname.startsWith("/assets/")) {
      root = assetRoot;
      relative = pathname.slice(8);
      if (!assetFiles.has(relative)) {
        json(res, 404, { code: "NOT_FOUND" });
        return;
      }
    } else {
      root = clientRoot;
      relative = pathname === "/" ? "index.html" : pathname.slice(1);
      if (
        !relative ||
        relative.split("/").some((x) => x.startsWith(".")) ||
        !CLIENT_TYPES.has(path.extname(relative).toLowerCase())
      ) {
        json(res, 404, { code: "NOT_FOUND" });
        return;
      }
    }
    const full = path.resolve(root, relative);
    if (!full.startsWith(root + path.sep)) {
      json(res, 404, { code: "NOT_FOUND" });
      return;
    }
    let st;
    try {
      const real = fs.realpathSync(full),
        realRoot = fs.realpathSync(root);
      if (
        !real.startsWith(realRoot + path.sep) ||
        fs.lstatSync(full).isSymbolicLink()
      )
        throw Error();
      st = fs.statSync(real);
      if (!st.isFile()) throw Error();
    } catch {
      json(res, pathname === "/" ? 503 : 404, {
        code: pathname === "/" ? "FRONTEND_NOT_BUILT" : "NOT_FOUND",
      });
      return;
    }
    const headers = {
      "Content-Type":
        MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": pathname.startsWith("/assets/")
        ? "public,max-age=3600"
        : "no-cache",
      "Referrer-Policy": "no-referrer",
    };
    if (path.extname(full) === ".html")
      headers["Content-Security-Policy"] =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
    let start = 0,
      end = st.size - 1,
      status = 200;
    if (req.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (
        !range ||
        (start = Number(range[1])) >= st.size ||
        (end = range[2]
          ? Math.min(Number(range[2]), st.size - 1)
          : st.size - 1) < start
      ) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
        res.end();
        return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
    }
    headers["Content-Length"] = String(Math.max(0, end - start + 1));
    headers["Accept-Ranges"] = "bytes";
    res.writeHead(status, headers);
    if (req.method === "HEAD" || st.size === 0) {
      res.end();
      return;
    }
    const stream = fs.createReadStream(full, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  }
  const server = http.createServer((req, res) => {
    serve(req, res).catch(() => json(res, 500, { code: "SERVER_ERROR" }));
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
    clientTracking: true,
  });
  server.on("upgrade", (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, origin).pathname;
    } catch {}
    if (
      pathname !== "/ws" ||
      !validHost(req) ||
      !validOrigin(req) ||
      wss.clients.size >= 512
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.frameTimes = [];
    const authTimer = setTimeout(() => {
      if (!ws.sessionId) ws.close(1008, "Authentication required");
    }, 5000);
    authTimer.unref?.();
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("error", () => {});
    ws.on("message", (data, binary) => {
      const frameNow = Date.now();
      ws.frameTimes = ws.frameTimes.filter((t) => frameNow - t < 1000);
      if (ws.frameTimes.length >= (options.messageRate ?? 60)) {
        ws.close(1008, "Message rate exceeded");
        return;
      }
      ws.frameTimes.push(frameNow);
      if (binary) {
        ws.close(1003, "JSON text required");
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString("utf8"));
      } catch {
        send(ws, { type: "protocol.error", code: "BAD_JSON" });
        return;
      }
      if (!ws.sessionId) {
        try {
          if (
            !plain(message) ||
            message.protocol !== 1 ||
            Object.keys(message).some(
              (k) => !["type", "protocol", "resumeToken"].includes(k),
            )
          )
            throw Object.assign(Error(), { code: "BAD_HANDSHAKE" });
          if (
            message.type === "session.open" &&
            message.resumeToken === undefined
          )
            service.makeSession(ws);
          else if (message.type === "session.resume")
            service.resume(message.resumeToken, ws);
          else throw Object.assign(Error(), { code: "BAD_HANDSHAKE" });
          clearTimeout(authTimer);
        } catch (e) {
          send(ws, { type: "session.error", code: e.code || "AUTH_REJECTED" });
          ws.close(1008, "Session rejected");
        }
        return;
      }
      try {
        service.command(ws, message);
      } catch {
        send(ws, { type: "protocol.error", code: "SERVER_ERROR" });
      }
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      service.detach(ws);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    for (const [id, c] of study)
      if (c.expiresAt <= Date.now()) study.delete(id);
    for (const [key, a] of httpRates)
      if (!a.some((t) => Date.now() - t < 1000)) httpRates.delete(key);
  }, options.heartbeatMs ?? 10000);
  heartbeat.unref?.();
  return {
    service,
    server,
    get origin() {
      return origin;
    },
    async listen() {
      if (server.listening) return this;
      await new Promise((resolve, reject) => {
        const error = (e) => {
            server.off("listening", ready);
            reject(e);
          },
          ready = () => {
            server.off("error", error);
            resolve();
          };
        server.once("error", error);
        server.once("listening", ready);
        server.listen(port, host);
      });
      const address = server.address();
      origin =
        options.publicOrigin ||
        `http://${host.includes(":") ? "[" + host + "]" : host}:${address.port}`;
      if (!allowedOrigins.size) allowedOrigins.add(origin);
      return this;
    },
    address() {
      return server.address();
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      service.close();
      study.clear();
      httpRates.clear();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      if (server.listening)
        await new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections?.();
        });
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = createGameServer({
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 4173),
    publicOrigin: process.env.PUBLIC_ORIGIN || undefined,
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").filter(Boolean),
    clientRoot: process.env.CLIENT_DIST || undefined,
  });
  try {
    await server.listen();
    console.log(`Spellwood authority ready at ${server.origin} (/health, /ws)`);
  } catch (e) {
    console.error(
      e.code === "EADDRINUSE"
        ? "Requested port is already occupied; no process was stopped."
        : `Server startup failed: ${e.code || "ERROR"}`,
    );
    process.exitCode = 1;
    await server.close();
  }
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await server.close();
      process.exit(0);
    });
}
