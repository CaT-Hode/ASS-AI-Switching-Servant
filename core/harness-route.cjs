const crypto = require("node:crypto");
const { endpoint } = require("./models.cjs");
const { sseMessages } = require("./adapters.cjs");
const { once } = require("node:events");
function authorized(value, token) {
  const a = Buffer.from(value || ""),
    b = Buffer.from(token || "");
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function harnessRoute(url, body, state) {
  // Claude's base URL is process-wide. Namespaced model IDs allow /model to
  // select any injected Messages model without changing the logged-in account.
  if (/^\/models\/v1\/messages(?:\/count_tokens)?(?:\?[^#]*)?$/.test(url)) {
    const split = typeof body.model === "string" ? body.model.indexOf("::") : -1;
    if (split < 1) throw Object.assign(new Error("请选择完整的供应商::模型 ID"), { status: 400 });
    const provider = body.model.slice(0, split);
    body.model = body.model.slice(split + 2);
    url = url.replace("/models/", "/harness/" + provider + "/");
  }
  const match =
    /^\/harness\/([\w-]+)\/v1\/(responses(?:\/compact)?|messages(?:\/count_tokens)?|chat\/completions)(?:\?[^#]*)?$/.exec(
      url,
    );
  if (!match) throw Object.assign(new Error("未知客户端路由"), { status: 404 });
  const p = state.providers.find((p) => p.id === match[1] && p.enabled),
    m = p?.models.find((m) => m.enabled && m.model === body.model);
  if (!p || !m)
    throw Object.assign(new Error("该账户或模型未启用"), { status: 404 });
  if (!p.apiKey)
    throw Object.assign(new Error("该账户缺少 API Key"), { status: 401 });
  const protocol = match[2].startsWith("messages")
    ? "anthropic"
    : match[2] === "chat/completions"
      ? "openai-chat"
      : "openai-responses";
  if (protocol !== m.wireApi)
    throw Object.assign(
      new Error("客户端协议与所选模型不一致，请重新选择兼容模型"),
      { status: 400 },
    );
  const suffix = match[2].endsWith("/count_tokens")
    ? "/count_tokens"
    : match[2].endsWith("/compact")
      ? "/compact"
      : "";
  return {
    p,
    m,
    protocol,
    url: endpoint(p.baseUrl, protocol, suffix),
    stream: body.stream === true && !suffix,
  };
}
async function forwardHarness(router, req, res) {
  const began = Date.now(),
    controller = new AbortController();
  let route, timer;
  const write = async (value) => {
    if (!res.write(value))
      await Promise.race([
        once(res, "drain"),
        once(res, "close").then(() => {
          throw new Error("客户端已断开");
        }),
      ]);
  };
  try {
    const credential =
      req.headers["x-api-key"] ||
      req.headers.authorization?.replace(/^Bearer /i, "");
    if (!authorized(credential, router.clientToken))
      throw Object.assign(
        new Error("客户端路由凭据已失效，请从 ASS 重新启动客户端"),
        { status: 401 },
      );
    if (req.method !== "POST")
      throw Object.assign(new Error("仅支持 POST"), { status: 405 });
    let size = 0;
    const chunks = [];
    for await (const b of req) {
      size += b.length;
      if (size > 128 * 1024 * 1024)
        throw Object.assign(new Error("请求过大"), { status: 413 });
      chunks.push(b);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw Object.assign(new Error("请求 JSON 无效"), { status: 400 });
    }
    route = harnessRoute(req.url, body, router.getState(router.requests.get(req)?.client));
    const { p, m, protocol } = route;
    const headers = {
      ...p.extraHeaders,
      "content-type": "application/json",
      accept: route.stream ? "text/event-stream" : "application/json",
    };
    if (protocol === "anthropic") {
      headers["x-api-key"] = p.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      if (req.headers["anthropic-beta"])
        headers["anthropic-beta"] = req.headers["anthropic-beta"];
    } else headers.authorization = "Bearer " + p.apiKey;
    router.active++;
    router.controllers.add(controller);
    timer = setTimeout(() => controller.abort(), 300000);
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    const response = await router.fetch(
      route.url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
      },
      p.network,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(
        new Error(
          "上游返回 HTTP " + response.status + "；请检查账户、模型和协议",
        ),
        { status: response.status },
      );
    }
    if (route.stream) {
      res.writeHead(response.status, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      res.flushHeaders();
      let terminal = false;
      for await (const event of sseMessages(response.body)) {
        if (
          event.type === "error" ||
          event.type === "response.failed" ||
          event.error
        )
          throw new Error("上游返回错误事件");
        if (
          (protocol === "anthropic" && event.type === "message_stop") ||
          (protocol === "openai-chat" &&
            (event.done || event.choices?.some((c) => c.finish_reason))) ||
          (protocol === "openai-responses" &&
            ["response.completed", "response.incomplete"].includes(event.type))
        )
          terminal = true;
        if (event.done) await write("data: [DONE]\n\n");
        else
          await write(
            (event.type ? "event: " + event.type + "\n" : "") +
              "data: " +
              JSON.stringify(event) +
              "\n\n",
          );
      }
      if (!terminal) throw new Error("上游流提前结束");
    } else {
      const text = await response.text();
      try {
        JSON.parse(text);
      } catch {
        throw new Error("上游未返回有效 JSON");
      }
      res.writeHead(response.status, { "content-type": "application/json" });
      await write(text);
    }
    res.end();
    router.log({
      time: new Date().toISOString(),
      source: p.name,
      model: m.model,
      status: response.status,
      ms: Date.now() - began,
      ok: true,
    });
  } catch (error) {
    // Never put raw provider error bodies or parser excerpts into logs.
    const message =
      error instanceof SyntaxError
        ? "上游返回无效流数据"
        : controller.signal.aborted
          ? "请求取消或超时"
          : error.message;
    if (!res.headersSent) {
      res.writeHead(error.status || 502, {
        "content-type": "application/json",
      });
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "api_error", message },
        }),
      );
    } else if (!res.destroyed) {
      res.end(
        "event: error\ndata: " +
          JSON.stringify({
            type: "error",
            error: { type: "api_error", message: "上游流中断" },
          }) +
          "\n\n",
      );
    }
    router.log({
      time: new Date().toISOString(),
      source: route?.p.name || "客户端",
      model: route?.m.model || "",
      status: error.status || 502,
      ms: Date.now() - began,
      ok: false,
      error: message.slice(0, 300),
    });
  } finally {
    clearTimeout(timer);
    if (router.controllers.delete(controller)) router.active--;
  }
}
module.exports = { harnessRoute, authorized, forwardHarness };
