const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { atomic } = require("./config.cjs");
const { modelKey } = require("./model-inspection.cjs");

function officialIdentity(auth) {
  const bearer = auth?.authorization;
  if (!bearer) return null;
  let claims = {};
  try {
    if (bearer.length <= 32768)
      claims = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url"));
  } catch {}
  const user =
    claims?.sub || claims?.["https://api.openai.com/auth"]?.chatgpt_user_id;
  // Tokens may refresh within an account. Unknown identities fail closed on rotation.
  return [
    auth["chatgpt-account-id"] || "",
    typeof user === "string" ? user : bearer,
  ];
}

function diagnosticFingerprint(context) {
  if (!context?.model) return null;
  const { provider, model, auth } = context;
  if (!provider) return null;
  const identity =
    provider.id === "official" ? officialIdentity(auth) : provider.apiKey;
  return createHash("sha256")
    .update(
      JSON.stringify([
        1,
        provider.id,
        provider.baseUrl,
        provider.network || "system",
        identity,
        Object.entries(provider.extraHeaders || {}).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        model.model,
        model.wireApi,
        model.efforts,
        provider.id === "official" ? "low" : model.defaultEffort || "medium",
      ]),
    )
    .digest("hex");
}

function failureMessage(message) {
  const status = /^HTTP (\d{3})(?:\b|；)/.exec(String(message));
  if (status) return `HTTP ${status[1]}；请检查该模型的凭据、协议和网络出口`;
  if (message === "未收到完整结束事件") return message;
  if (message === "请求超时（90 秒）") return message;
  if (message === "未找到 ChatGPT 登录，请先在 Codex 登录") return message;
  return "连接失败，请检查模型配置或网络";
}

function normalizeResult(result) {
  if (
    !result ||
    result.cancelled ||
    typeof result.ok !== "boolean" ||
    typeof result.providerId !== "string" ||
    !result.providerId ||
    result.providerId.length > 250 ||
    typeof result.model !== "string" ||
    !result.model ||
    result.model.length > 250 ||
    typeof result.time !== "string" ||
    !Number.isFinite(Date.parse(result.time)) ||
    !Number.isFinite(result.ms) ||
    result.ms < 0
  )
    return null;
  return {
    providerId: result.providerId,
    model: result.model,
    ok: result.ok,
    ms: result.ms,
    time: new Date(result.time).toISOString(),
    message: result.ok
      ? "HTTP 200 · response.completed"
      : failureMessage(result.message),
  };
}

class DiagnosticHistory {
  constructor({ dataDir, crypto, getContext, write = atomic }) {
    this.file = path.join(dataDir, "diagnostics.enc.json");
    this.crypto = crypto;
    this.getContext = getContext;
    this.write = write;
    this.entries = new Map();
    this.error = "";
    try {
      if (!fs.existsSync(this.file)) return;
      if (fs.statSync(this.file).size > 16 * 1024 * 1024)
        throw Error("oversized");
      const stored = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (stored.version !== 1 || typeof stored.encrypted !== "string")
        throw Error("version");
      const entries = JSON.parse(
        crypto.decryptString(Buffer.from(stored.encrypted, "base64")),
      );
      if (!Array.isArray(entries) || entries.length > 5000)
        throw Error("invalid");
      for (const entry of entries) {
        const result = normalizeResult(entry?.result);
        if (result && /^[a-f0-9]{64}$/.test(entry.fingerprint)) {
          const key = modelKey(result.providerId, result.model);
          if (
            !this.entries.has(key) ||
            this.entries.get(key).result.time < result.time
          )
            this.entries.set(key, { fingerprint: entry.fingerprint, result });
        }
      }
    } catch {
      this.error = "上次连接测试记录无法读取，请重新测试；其他配置不受影响。";
    }
  }
  fingerprint(id, model) {
    return diagnosticFingerprint(this.getContext(id, model));
  }
  reconcile() {
    let changed = false;
    for (const [key, entry] of this.entries) {
      if (
        entry.fingerprint !==
        this.fingerprint(entry.result.providerId, entry.result.model)
      ) {
        this.entries.delete(key);
        changed = true;
      }
    }
    if (changed) this.save();
  }
  save() {
    try {
      if (!this.crypto.isEncryptionAvailable())
        throw Error("encryption unavailable");
      const entries = [...this.entries.values()].map(
        ({ fingerprint, result }) => ({ fingerprint, result }),
      );
      this.write(
        this.file,
        JSON.stringify({
          version: 1,
          encrypted: this.crypto
            .encryptString(JSON.stringify(entries))
            .toString("base64"),
        }),
      );
      for (const entry of this.entries.values()) delete entry.saveError;
      this.error = "";
      return true;
    } catch {
      this.error =
        "连接测试记录保存失败，本次变更未持久化；请检查磁盘或 Windows 凭据加密。";
      return false;
    }
  }
  record(input, fingerprint) {
    const result = normalizeResult(input);
    if (
      !result ||
      !fingerprint ||
      fingerprint !== this.fingerprint(result.providerId, result.model)
    )
      return false;
    const key = modelKey(result.providerId, result.model);
    const previous = this.entries.get(key);
    if (previous && previous.result.time > result.time) return false;
    this.entries.set(key, { fingerprint, result });
    // Bound the file while keeping the most recent completed test per model.
    if (this.entries.size > 5000) {
      const oldest = [...this.entries].sort((a, b) =>
        a[1].result.time.localeCompare(b[1].result.time),
      )[0];
      this.entries.delete(oldest[0]);
    }
    if (!this.save() && this.entries.has(key))
      this.entries.get(key).saveError = "本次结果未保存";
    return true;
  }
  public() {
    this.reconcile();
    return Object.fromEntries(
      [...this.entries].map(([key, entry]) => [
        key,
        {
          ...entry.result,
          ...(entry.saveError ? { saveError: entry.saveError } : {}),
        },
      ]),
    );
  }
}
module.exports = { DiagnosticHistory, diagnosticFingerprint, failureMessage };
