const http = require("node:http");
const { once } = require("node:events");
const { endpoint, normalizeEffort } = require("./models.cjs");
const { convertRequest, translateStream } = require("./adapters.cjs");
const { SseMonitor } = require("./sse-monitor.cjs");
const { forwardHarness } = require("./harness-route.cjs");
const crypto = require("node:crypto");
const forwarded = [
  "authorization",
  "chatgpt-account-id",
  "openai-beta",
  "session_id",
  "conversation_id",
  "originator",
  "x-codex-turn-metadata",
  "x-codex-turn-state",
  "x-openai-subagent",
  "x-openai-parent-request-id",
];
const pickHeaders = (h) =>
  Object.fromEntries(forwarded.filter((k) => h[k]).map((k) => [k, h[k]]));
async function write(res, data) {
  if (!res.write(data)) await once(res, "drain");
}
function routeFor(body, state, suffix = "") {
  if (typeof body.model !== "string" || !body.model)
    throw Object.assign(new Error("请求缺少 model"), { status: 400 });
  const split = body.model.indexOf("::");
  if (split < 0)
    return {
      source: "OpenAI 官方",
      url: "https://chatgpt.com/backend-api/codex/responses" + suffix,
      protocol: "openai-responses",
      network: "system",
      body,
      official: true,
    };
  const p = state.providers.find(
    (p) => p.id === body.model.slice(0, split) && p.enabled,
  );
  const m = p?.models.find(
    (m) => m.model === body.model.slice(split + 2) && m.enabled,
  );
  if (!m)
    throw Object.assign(
      new Error("供应商或模型未启用；请在 AI Switch Servant 检查配置"),
      { status: 404 },
    );
  if (!p.apiKey)
    throw Object.assign(new Error("供应商缺少 API Key"), { status: 401 });
  if (suffix && m.wireApi !== "openai-responses")
    throw Object.assign(
      new Error("该协议不支持服务端 compact，请使用完整历史或客户端压缩"),
      { status: 400 },
    );
  const updated = { ...body, model: m.model };
  if (updated.reasoning?.effort)
    updated.reasoning = {
      ...updated.reasoning,
      effort: normalizeEffort(updated.reasoning.effort),
    };
  else
    updated.reasoning = {
      ...(updated.reasoning || {}),
      effort: normalizeEffort(m.defaultEffort),
    };
  return {
    source: p.name,
    url: endpoint(p.baseUrl, m.wireApi, suffix),
    protocol: m.wireApi,
    network: p.network,
    provider: p,
    model: m,
    body: updated,
    official: false,
  };
}
class Router {
  constructor({ getState, fetchUpstream, log = () => {} }) {
    this.getState = getState;
    this.fetch = fetchUpstream;
    this.log = log;
    this.server = null;
    this.controllers = new Set();
    this.active = 0;
    this.port = 25819;
    this.clientToken = crypto.randomBytes(32).toString("hex");
  }
  async start(port = this.port) {
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw Error("无效本机端口");
    if (!this.server) this.port = port;
    if (this.server) return;
    const server = http.createServer((q, s) => this.handle(q, s));
    server.requestTimeout = 300000;
    server.headersTimeout = 60000;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, "127.0.0.1", resolve);
    });
    this.server = server;
  }
  async stop() {
    if (!this.server) return;
    for (const c of this.controllers) c.abort();
    const s = this.server;
    this.server = null;
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  async handle(req, res) {
    const began = Date.now();
    let route;
    const controller = new AbortController();
    let timer;
    let success = false;
    try {
      const expected = `127.0.0.1:${this.port}`;
      if (
        req.headers.origin ||
        req.headers["sec-fetch-site"] === "cross-site" ||
        (req.headers.host !== expected &&
          req.headers.host !== `localhost:${this.port}`)
      )
        throw Object.assign(new Error("仅允许本机应用请求"), { status: 403 });
      if (req.url.startsWith("/harness/")) {
        await forwardHarness(this, req, res);
        return;
      }
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ service: "ass", version: 1, active: this.active }),
        );
        return;
      }
      const match = /^\/v1\/responses(\/compact)?$/.exec(req.url);
      if (req.method !== "POST" || !match)
        throw Object.assign(
          new Error("此路由仅支持 POST /v1/responses 或 /compact"),
          { status: 404 },
        );
      if (!/^Bearer\s+\S+$/i.test(req.headers.authorization || ""))
        throw Object.assign(new Error("需要 Codex 登录凭据"), { status: 401 });
      let size = 0;
      const chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > 128 * 1024 * 1024)
          throw Object.assign(new Error("请求超过 128 MiB"), { status: 413 });
        chunks.push(c);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw Object.assign(new Error("请求不是有效 JSON"), { status: 400 });
      }
      route = routeFor(body, this.getState(), match[1] || "");
      const headers = route.official
        ? pickHeaders(req.headers)
        : { ...route.provider.extraHeaders };
      headers["content-type"] = "application/json";
      headers.accept = "text/event-stream";
      if (!route.official) {
        if (route.protocol === "anthropic") {
          headers["x-api-key"] = route.provider.apiKey;
          headers["anthropic-version"] = "2023-06-01";
        } else headers.authorization = "Bearer " + route.provider.apiKey;
      }
      const request =
        route.protocol === "openai-responses"
          ? route.body
          : convertRequest(route.body, route.model, route.protocol);
      this.active++;
      this.controllers.add(controller);
      timer = setTimeout(() => controller.abort(), 300000);
      res.on("close", () => {
        if (!res.writableFinished) controller.abort();
      });
      const response = await this.fetch(
        route.url,
        {
          method: "POST",
          headers,
          body: JSON.stringify(request),
          signal: controller.signal,
          redirect: "error",
          credentials: "omit",
        },
        route.network,
      );
      if (!response.ok) {
        const raw = (await response.text()).slice(0, 4000);
        let message = "上游返回 HTTP " + response.status;
        try {
          const parsed = JSON.parse(raw);
          message = String(
            parsed.error?.message || parsed.detail || message,
          ).slice(0, 500);
        } catch {
          if (raw.includes("<html")) message += "（HTML 网关错误页）";
        }
        for (const key of [
          route.provider?.apiKey,
          req.headers.authorization?.replace(/^Bearer /i, ""),
        ].filter(Boolean))
          message = message.split(key).join("[REDACTED]");
        throw Object.assign(new Error(message), { status: response.status });
      }
      if (route.protocol === "openai-responses") {
        let contentType = response.headers.get("content-type");
        const streaming = body.stream !== false && !match[1];
        const reader = response.body.getReader();
        const monitor = streaming ? new SseMonitor() : null;
        try {
          let first;
          if (
            streaming &&
            (!contentType || !contentType.includes("text/event-stream"))
          ) {
            // Some trusted enterprise gateways omit Content-Type. Verify bytes, never accept HTML/JSON as SSE.
            const chunks = [];
            let length = 0;
            let sample = "";
            while (length < 16384) {
              const next = await reader.read();
              if (next.done) break;
              chunks.push(Buffer.from(next.value));
              length += next.value.length;
              sample = Buffer.concat(chunks).toString("utf8");
              if (sample.includes("\n")) break;
            }
            if (!/^\s*(?:event:|data:|:)/.test(sample))
              throw Object.assign(
                new Error("上游未返回 SSE 流，请检查模型协议设置"),
                { status: 502 },
              );
            first = Buffer.concat(chunks);
            contentType = "text/event-stream";
          }
          res.writeHead(response.status, {
            "content-type": contentType || "application/json",
            "cache-control": "no-cache",
            "x-ass-provider": route.official ? "official" : route.provider.id,
          });
          res.flushHeaders();
          if (first) {
            monitor?.feed(first);
            await write(res, first);
          }
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              monitor?.feed(null, true);
              break;
            }
            monitor?.feed(value);
            await write(res, Buffer.from(value));
          }
        } finally {
          reader.releaseLock();
        }
      } else if (body.stream === false) {
        let final;
        for await (const event of translateStream(
          response.body,
          route.protocol,
          body.model,
        ))
          if (
            event.response?.status === "completed" ||
            event.response?.status === "incomplete"
          )
            final = event.response;
        res.writeHead(200, { "content-type": "application/json" });
        res.write(JSON.stringify(final));
      } else {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        res.flushHeaders();
        for await (const event of translateStream(
          response.body,
          route.protocol,
          body.model,
        ))
          await write(
            res,
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
      }
      res.end();
      success = true;
      this.log({
        time: new Date().toISOString(),
        source: route.source,
        model: body.model,
        status: response.status,
        ms: Date.now() - began,
        ok: true,
      });
    } catch (error) {
      let message = controller.signal.aborted
        ? "请求已取消或超过 5 分钟"
        : error instanceof SyntaxError
          ? "请求或上游流中的 JSON 数据无效"
          : error.message;
      for (const secret of [
        route?.provider?.apiKey,
        req.headers.authorization?.replace(/^Bearer /i, ""),
      ].filter(Boolean))
        message = message.split(secret).join("[REDACTED]");
      if (res.headersSent) {
        if (!res.destroyed) {
          res.write(
            `event: error\ndata: ${JSON.stringify({ type: "error", error: { code: "stream_failed", message: "上游流中断，请重试" } })}\n\n`,
          );
          res.end();
        }
      } else {
        res.writeHead(error.status || 502, {
          "content-type": "application/json",
        });
        res.end(
          JSON.stringify({
            error: { code: error.code || "route_error", message },
          }),
        );
      }
      this.log({
        time: new Date().toISOString(),
        source: route?.source || "本地",
        model: route?.body.model || "",
        status: error.status || 502,
        ms: Date.now() - began,
        ok: false,
        error: message.slice(0, 500),
      });
    } finally {
      clearTimeout(timer);
      if (this.controllers.delete(controller)) this.active--;
    }
  }
}
module.exports = { Router, routeFor };
