const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { atomic } = require("./config.cjs");
const { nativeProbe, modelKey } = require("./model-inspection.cjs");
const ORDER = ["openai-responses", "anthropic", "openai-chat"];
function identity(p, m) {
  return createHash("sha256").update(JSON.stringify([p.id, p.baseUrl, p.apiKey,
    p.network, Object.entries(p.extraHeaders || {}).sort(), m.model])).digest("hex");
}
// Only a completed native stream establishes support. An HTTP error on its
// own (particularly 400, quota, auth and 5xx) does not disprove a protocol.
class ProtocolNegotiation {
  constructor({ dataDir, crypto, getProviders, fetcher, onChange = () => {}, now = Date.now }) {
    Object.assign(this, { crypto, getProviders, fetcher, onChange, now });
    this.file = path.join(dataDir, "protocols.enc.json");
    this.records = {}; this.jobs = new Map(); this.error = "";
    try {
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > 8 * 1024 * 1024) throw Error();
        const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (saved.version !== 1) throw Error();
        this.records = JSON.parse(crypto.decryptString(Buffer.from(saved.encrypted, "base64")));
        if (!this.records || typeof this.records !== "object" || Array.isArray(this.records)) throw Error();
      }
    } catch { this.records = {}; this.error = "协议检测记录无法读取，未覆盖原文件"; }
  }
  get(p, m) {
    const r = this.records[modelKey(p.id, m.model)];
    return r?.fingerprint === identity(p, m) ? r : null;
  }
  save() {
    if (this.error) throw Error(this.error);
    if (!this.crypto.isEncryptionAvailable()) throw Error("系统凭据加密不可用，未保存协议检测");
    const valid = new Set(this.getProviders().flatMap(p => p.models.map(m => modelKey(p.id, m.model))));
    for (const key of Object.keys(this.records)) if (!valid.has(key)) delete this.records[key];
    atomic(this.file, JSON.stringify({ version: 1, encrypted: this.crypto.encryptString(JSON.stringify(this.records)).toString("base64") }));
  }
  record(p, m, report) {
    const live = this.getProviders().find(v => v.id === p.id), model = live?.models.find(v => v.model === m.model);
    if (!model || identity(live, model) !== identity(p, m)) return false;
    const record = this.get(p, m) || { fingerprint: identity(p, m), protocols: {} };
    for (const [protocol, result] of Object.entries(report.protocols || {})) {
      if (!ORDER.includes(protocol)) continue;
      const old = record.protocols[protocol];
      const status = result.status === "passed" ? "passed" : result.unsupported ? "unsupported" : "unknown";
      record.protocols[protocol] = { status: status === "unknown" && old?.status === "passed" ? "passed" : status,
        time: report.time, ms: result.ms, httpStatus: result.httpStatus,
        lastStatus: status, lastSuccess: status === "passed" ? report.time : old?.lastSuccess,
        ...(status === "unknown" ? { message: "暂未确认；网络、权限、限流或请求参数可能影响检测" } : {}) };
    }
    record.time = report.time;
    this.records[modelKey(p.id, m.model)] = record;
    this.save(); this.onChange(); return true;
  }
  select(p, m, harness) {
    const r = this.get(p, m), order = harness === "claude" ? ["anthropic", "openai-responses", "openai-chat"] : ORDER;
    return order.find(protocol => r?.protocols[protocol]?.status === "passed") || m.wireApi;
  }
  providers(harness) {
    return this.getProviders().map(p => ({ ...p, models: p.models.map(m => ({ ...m, wireApi: this.select(p, m, harness) })) }));
  }
  public() {
    return Object.fromEntries(this.getProviders().flatMap(p => p.models.flatMap(m => {
      const r = this.get(p, m);
      return r ? [[modelKey(p.id, m.model), { time: r.time, protocols: r.protocols, efforts: {}, tools: { status: "unknown" } }]] : [];
    })));
  }
  async ensure(p, m, { force = false, signal } = {}) {
    if (!p.enabled || !p.apiKey || !m.enabled) return;
    const key = modelKey(p.id, m.model), fp = identity(p, m), jobKey = key + fp;
    if (this.jobs.has(jobKey)) return this.jobs.get(jobKey);
    const job = (async () => {
      const report = { time: new Date(this.now()).toISOString(), protocols: {} };
      // Both native protocols are always checked. Chat is a compatibility
      // fallback, not a reason to skip the Responses / Messages probes.
      for (const protocol of ORDER) {
        signal?.throwIfAborted();
        const r = this.get(p, m), last = r?.protocols[protocol];
        if (protocol === "openai-chat" && ["openai-responses", "anthropic"].some(k =>
          (report.protocols[k] || r?.protocols[k])?.status === "passed")) break;
        const ttl = last?.lastStatus === "unknown" ? 5 * 60000 : 24 * 3600000;
        if (!force && last && this.now() - Date.parse(last.time) < ttl) continue;
        const result = await nativeProbe(p, m, protocol, this.fetcher, { signal });
        signal?.throwIfAborted();
        report.protocols[protocol] = result;
        this.record(p, m, { time: new Date(this.now()).toISOString(), protocols: { [protocol]: result } });
        // A credential may be accepted by one protocol but not another. Only
        // rate limiting suppresses further probes; do not hammer the provider.
        if (result.httpStatus === 429) break;
      }
      return this.get(p, m);
    })();
    this.jobs.set(jobKey, job);
    try { return await job; } finally { this.jobs.delete(jobKey); this.onChange(); }
  }
  async ensureProviders(providers, options) {
    const rows = providers.flatMap(p => p.models.map(m => [p, m]));
    // Small bounded requests, no context-limit stress tests or burst fan-out.
    let next = 0;
    await Promise.all([0, 1].map(async () => { while (next < rows.length) {
      const [p, m] = rows[next++]; await this.ensure(p, m, options);
    } }));
  }
}
module.exports = { ProtocolNegotiation, identity };
