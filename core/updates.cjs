const fs = require("node:fs");
const path = require("node:path");
const { atomic } = require("./config.cjs");
const REPOSITORY = "CaT-Hode/ASS-AI-Switching-Servant";
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const ERROR_INTERVAL = 15 * 60 * 1000;

function version(value) {
  if (typeof value !== "string" || value.length > 100) return null;
  const m =
    /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      value,
    );
  if (!m) return null;
  const numbers = m.slice(1, 4).map(Number),
    pre = m[4]?.split(".") || [];
  if (
    numbers.some((n) => !Number.isSafeInteger(n)) ||
    pre.some((p) => /^\d+$/.test(p) && p.length > 1 && p.startsWith("0"))
  )
    return null;
  return { numbers, pre, text: value.replace(/^v/, "") };
}
function compareVersions(a, b) {
  const aa = version(a),
    bb = version(b);
  if (!aa || !bb) throw Error("无法识别版本号");
  for (let i = 0; i < 3; i++)
    if (aa.numbers[i] !== bb.numbers[i])
      return aa.numbers[i] > bb.numbers[i] ? 1 : -1;
  if (!aa.pre.length || !bb.pre.length)
    return aa.pre.length === bb.pre.length ? 0 : aa.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(aa.pre.length, bb.pre.length); i++) {
    const x = aa.pre[i],
      y = bb.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    if (xn !== yn) return xn ? -1 : 1;
    if (xn && x.length !== y.length) return x.length > y.length ? 1 : -1;
    return x > y ? 1 : -1;
  }
  return 0;
}
function safeRelease(raw) {
  if (!raw || raw.draft !== false || !version(raw.tag_name)) return null;
  const tag = raw.tag_name,
    v = version(tag),
    page = `${RELEASES_URL}/tag/${encodeURIComponent(tag)}`;
  if (raw.html_url !== page) return null;
  const assets = Array.isArray(raw.assets) ? raw.assets.slice(0, 100) : [];
  const findAsset = (names) => {
    const found = assets.find(
      (a) =>
        names.includes(a?.name) &&
        a.state === "uploaded" &&
        Number.isSafeInteger(a.size) &&
        a.size > 0 &&
        a.size <= 2 * 1024 ** 3 &&
        a.browser_download_url ===
          `${RELEASES_URL}/download/${encodeURIComponent(tag)}/${encodeURIComponent(a.name)}`,
    );
    return found
      ? {
          name: found.name,
          url: found.browser_download_url,
          size: found.size,
          sha256: /^sha256:[a-f0-9]{64}$/.test(found.digest || "")
            ? found.digest.slice(7)
            : "",
        }
      : null;
  };
  return {
    tag,
    version: v.text,
    prerelease: raw.prerelease === true || !!v.pre.length,
    url: page,
    name: typeof raw.name === "string" ? raw.name.slice(0, 160) : "ASS " + tag,
    notes: typeof raw.body === "string" ? raw.body.slice(0, 6000) : "",
    publishedAt: Number.isFinite(Date.parse(raw.published_at))
      ? new Date(raw.published_at).toISOString()
      : "",
    download: findAsset([
      `ASS-v${v.text}-win32-x64.zip`,
      `AI-Switch-Servant-v${v.text}-win32-x64.zip`,
    ]),
    checksum: findAsset(["SHA256SUMS.txt"]),
  };
}
function pickRelease(releases, includePreview) {
  return (
    releases
      .filter((r) => includePreview || !r.prerelease)
      .sort((a, b) => compareVersions(b.version, a.version))[0] || null
  );
}
async function limitedJson(response) {
  if (!response.body) throw Error("empty response");
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) throw Error("oversized response");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
class UpdateChecker {
  constructor({
    dataDir,
    currentVersion,
    fetchRelease,
    onChange = () => {},
    now = Date.now,
    timers = globalThis,
  }) {
    if (!version(currentVersion)) throw Error("无效应用版本");
    Object.assign(this, {
      currentVersion,
      fetchRelease,
      onChange,
      now,
      timers,
    });
    this.file = path.join(dataDir, "updates.json");
    this.settings = {
      automatic: true,
      includePreview:
        version(currentVersion).numbers[0] === 0 ||
        !!version(currentVersion).pre.length,
      dismissedTag: "",
    };
    this.releases = [];
    this.etag = "";
    this.lastCheckedAt = 0;
    this.nextAutomaticAt = 0;
    this.retryAt = 0;
    this.status = "idle";
    this.message = "尚未检查更新";
    this.pending = null;
    this.controller = null;
    this.timer = null;
    this.generation = 0;
    try {
      if (fs.statSync(this.file).size > 2 * 1024 * 1024)
        throw Error("oversized cache");
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const key of ["automatic", "includePreview"])
        if (typeof saved[key] === "boolean") this.settings[key] = saved[key];
      if (version(saved.dismissedTag))
        this.settings.dismissedTag = saved.dismissedTag;
      for (const key of ["lastCheckedAt", "nextAutomaticAt", "retryAt"])
        if (
          Number.isSafeInteger(saved[key]) &&
          saved[key] >= 0 &&
          saved[key] <= 8640000000000000
        )
          this[key] =
            key === "retryAt"
              ? saved[key]
              : Math.min(saved[key], now() + 24 * 60 * 60 * 1000);
      // Re-validate even local cached metadata before offering an external URL.
      if (Array.isArray(saved.releases))
        this.releases = saved.releases
          .slice(0, 100)
          .map(safeRelease)
          .filter(Boolean);
      if (
        typeof saved.etag === "string" &&
        /^[\x20-\x7e]{1,200}$/.test(saved.etag) &&
        this.releases.length
      )
        this.etag = saved.etag;
      if (this.lastCheckedAt) {
        this.status = "cached";
        this.message = "显示上次检查结果";
      }
    } catch {}
  }
  snapshot() {
    const latest = pickRelease(this.releases, this.settings.includePreview);
    const available =
      !!latest && compareVersions(latest.version, this.currentVersion) > 0;
    return {
      ...this.settings,
      currentVersion: this.currentVersion,
      status: this.status,
      message: this.message,
      latest,
      available,
      notify: available && latest.tag !== this.settings.dismissedTag,
      lastCheckedAt: this.lastCheckedAt,
      nextAutomaticAt: this.nextAutomaticAt,
      retryAt: this.retryAt,
      releasesUrl: RELEASES_URL,
    };
  }
  persist() {
    // Store only public, bounded release metadata; no provider settings or credentials.
    const releases = this.releases.map((r) => ({
      tag_name: r.tag,
      html_url: r.url,
      draft: false,
      prerelease: r.prerelease,
      name: r.name,
      body: r.notes,
      published_at: r.publishedAt,
      assets: [r.download, r.checksum].filter(Boolean).map((a) => ({
        name: a.name,
        browser_download_url: a.url,
        state: "uploaded",
        size: a.size,
        digest: a.sha256 ? "sha256:" + a.sha256 : "",
      })),
    }));
    atomic(
      this.file,
      JSON.stringify({
        ...this.settings,
        lastCheckedAt: this.lastCheckedAt,
        nextAutomaticAt: this.nextAutomaticAt,
        retryAt: this.retryAt,
        etag: this.etag,
        releases,
      }),
    );
  }
  preferences(input) {
    const previous = { ...this.settings };
    for (const key of ["automatic", "includePreview"])
      if (typeof input?.[key] === "boolean") this.settings[key] = input[key];
    try {
      this.persist();
    } catch {
      this.settings = previous;
      throw Error("更新偏好无法保存，请检查应用数据目录权限");
    }
    if (previous.automatic && !this.settings.automatic) {
      this.generation++;
      this.controller?.abort();
      this.status = this.lastCheckedAt ? "cached" : "idle";
      this.message = "已关闭自动检查，仍可手动检查";
    }
    this.onChange();
    return this.snapshot();
  }
  dismiss() {
    this.settings.dismissedTag = this.snapshot().latest?.tag || "";
    this.persist();
    this.onChange();
  }
  openUrl(kind) {
    const latest = this.snapshot().latest;
    if (kind === "releases") return RELEASES_URL;
    if (kind === "release" && latest) return latest.url;
    if (kind === "download" && this.snapshot().available && latest.download)
      return latest.download.url;
    if (kind === "checksum" && latest?.checksum) return latest.checksum.url;
    throw Error("尚无可用的发布文件，请先检查更新");
  }
  check({ manual = false } = {}) {
    if (this.pending) return this.pending;
    const now = this.now();
    if (!manual && (!this.settings.automatic || now < this.nextAutomaticAt))
      return Promise.resolve(this.snapshot());
    if (now < this.retryAt) {
      this.status = "error";
      this.message = "GitHub 暂时限流，请在显示的重试时间后检查";
      this.onChange();
      return Promise.resolve(this.snapshot());
    }
    this.pending = this.performCheck().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async performCheck() {
    const generation = this.generation;
    this.controller = new AbortController();
    this.status = "checking";
    this.message = "正在检查 ASS 新版本…";
    this.onChange();
    try {
      const response = await this.fetchRelease(API_URL, {
        method: "GET",
        headers: {
          accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          ...(this.etag ? { "If-None-Match": this.etag } : {}),
        },
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.any([
          this.controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (generation !== this.generation) {
        await response.body?.cancel();
        return this.snapshot();
      }
      if ([403, 429].includes(response.status)) {
        const retry = response.headers.get("retry-after"),
          reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
        const after = /^\d+$/.test(retry || "")
          ? this.now() + Number(retry) * 1000
          : Date.parse(retry);
        this.retryAt = Math.max(
          this.now() + ERROR_INTERVAL,
          Number.isFinite(after) ? after : 0,
          Number.isFinite(reset) ? reset : 0,
        );
        await response.body?.cancel();
        throw Error("limited");
      }
      if (response.status === 304) {
        if (!this.etag || !this.releases.length) throw Error("cache missing");
      } else {
        if (!response.ok) {
          await response.body?.cancel();
          throw Error("http");
        }
        const body = await limitedJson(response);
        if (!Array.isArray(body)) throw Error("format");
        if (generation !== this.generation) return this.snapshot();
        const releases = body.slice(0, 100).map(safeRelease).filter(Boolean);
        if (body.length && !releases.length) throw Error("No valid releases");
        this.releases = releases;
        const etag = response.headers.get("etag") || "";
        this.etag =
          this.releases.length && /^[\x20-\x7e]{1,200}$/.test(etag) ? etag : "";
      }
      this.lastCheckedAt = this.now();
      this.nextAutomaticAt = this.now() + CHECK_INTERVAL;
      this.retryAt = 0;
      this.status = "checked";
      this.message = this.snapshot().available
        ? "发现 ASS 新版本"
        : this.snapshot().latest
          ? "此更新渠道没有比当前版本更新的发布"
          : "此更新渠道暂无发布版本";
    } catch {
      if (generation !== this.generation) return this.snapshot();
      this.status = "error";
      this.nextAutomaticAt = Math.max(
        this.now() + ERROR_INTERVAL,
        this.retryAt,
      );
      this.message =
        this.retryAt > this.now()
          ? "GitHub 暂时限流，已推迟检查；不影响模型路由"
          : "无法检查更新，请确认网络或系统代理；模型路由不受影响";
    }
    try {
      this.persist();
    } catch {
      this.message += "（结果未能写入本机缓存）";
    }
    this.onChange();
    return this.snapshot();
  }
  start() {
    if (this.timer) return;
    const tick = () => {
      this.timer = this.timers.setTimeout(tick, 60000);
      this.timer.unref?.();
      void this.check();
    };
    this.timer = this.timers.setTimeout(tick, 10000);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.generation++;
    this.controller?.abort();
  }
}
module.exports = {
  UpdateChecker,
  version,
  compareVersions,
  safeRelease,
  pickRelease,
  API_URL,
  RELEASES_URL,
  CHECK_INTERVAL,
  ERROR_INTERVAL,
};
