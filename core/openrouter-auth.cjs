const http = require("node:http");
const crypto = require("node:crypto");
// OpenRouter's documented PKCE grant returns an API key, not subscription tokens.
class OpenRouterAuth {
  constructor({
    fetchUpstream,
    openExternal,
    saveKey,
    onChange = () => {},
    timeout = 300000,
  }) {
    Object.assign(this, {
      fetchUpstream,
      openExternal,
      saveKey,
      onChange,
      timeout,
    });
    this.state = { status: "idle" };
    this.job = null;
  }
  update(state) {
    this.state = state;
    this.onChange();
  }
  cancel() {
    if (!this.job) return;
    this.job.controller.abort();
    this.finish(this.job, {
      status: "cancelled",
      message: "授权已取消；未保存新凭据。",
    });
  }
  finish(job, state) {
    if (this.job !== job) return;
    clearTimeout(job.timer);
    job.server.close();
    job.server.closeAllConnections();
    this.job = null;
    this.update(state);
  }
  async start(label) {
    if (this.job) throw Error("已有 OpenRouter 授权正在等待浏览器确认");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const callbackPath =
      "/ass-callback/" + crypto.randomBytes(24).toString("hex");
    const job = {
      controller: new AbortController(),
      used: false,
      server: null,
    };
    this.job = job;
    job.server = http.createServer(async (req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      );
      res.setHeader("Referrer-Policy", "no-referrer");
      const url = new URL(req.url, "http://localhost");
      if (
        req.headers.host !== job.host ||
        url.pathname !== callbackPath ||
        req.method !== "GET" ||
        job.used ||
        this.job !== job
      ) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      if (!code || code.length > 4096 || url.searchParams.has("error")) {
        res.writeHead(400);
        res.end("Authorization was not completed. Return to ASS to retry.");
        this.finish(job, {
          status: "failed",
          message: "浏览器未返回有效授权码；未保存凭据。",
        });
        return;
      }
      job.used = true;
      res.end(
        "<!doctype html><meta charset=utf-8><title>ASS</title><h1>AI Switch Servant</h1><p>Authorization received. Return to ASS to check the result. You can close this tab.</p>",
      );
      this.update({ status: "exchanging", message: "正在安全换取 API Key…" });
      try {
        const response = await this.fetchUpstream(
          "https://openrouter.ai/api/v1/auth/keys",
          {
            method: "POST",
            redirect: "error",
            credentials: "omit",
            headers: { "content-type": "application/json" },
            signal: AbortSignal.any([
              job.controller.signal,
              AbortSignal.timeout(30000),
            ]),
            body: JSON.stringify({
              code,
              code_verifier: verifier,
              code_challenge_method: "S256",
            }),
          },
          "system",
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw Error("授权换取失败：HTTP " + response.status);
        }
        const result = await response.json();
        if (
          typeof result.key !== "string" ||
          !result.key ||
          result.key.length > 8192
        )
          throw Error("授权接口没有返回有效 API Key");
        job.controller.signal.throwIfAborted();
        const providerId = this.saveKey(
          result.key,
          String(label || "OpenRouter 浏览器授权")
            .trim()
            .slice(0, 80),
        );
        this.finish(job, {
          status: "complete",
          message: "API Key 已加密保存，请添加模型后使用。",
          providerId,
        });
      } catch (error) {
        this.finish(job, {
          status: "failed",
          message: /^授权/.test(error.message)
            ? error.message
            : "授权换取或本机保存失败，请重试。未显示任何凭据。",
        });
      }
    });
    job.server.requestTimeout = 10000;
    job.server.headersTimeout = 10000;
    try {
      await new Promise((resolve, reject) => {
        job.server.once("error", reject);
        job.server.listen(0, "127.0.0.1", resolve);
      });
      job.host = "localhost:" + job.server.address().port;
      const url = new URL("https://openrouter.ai/auth");
      url.searchParams.set("callback_url", "http://" + job.host + callbackPath);
      url.searchParams.set(
        "code_challenge",
        crypto.createHash("sha256").update(verifier).digest("base64url"),
      );
      url.searchParams.set("code_challenge_method", "S256");
      job.timer = setTimeout(() => {
        job.controller.abort();
        this.finish(job, {
          status: "failed",
          message: "授权等待超时，请重新开始。",
        });
      }, this.timeout);
      job.timer.unref();
      this.update({
        status: "waiting",
        message: "请在浏览器中核对额度与权限，完成 OpenRouter 授权。",
      });
      await this.openExternal(url.href);
    } catch {
      this.finish(job, {
        status: "failed",
        message: "无法启动本机回调或打开浏览器，请使用手动 API Key。",
      });
    }
    return this.state;
  }
}
module.exports = { OpenRouterAuth };
