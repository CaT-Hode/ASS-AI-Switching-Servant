const fs = require("node:fs");
const path = require("node:path");
const { atomic } = require("./config.cjs");
const {
  parseImport,
  normalizeProvider,
  normalizeModel,
  makeCatalog,
} = require("./models.cjs");
class Store {
  constructor(dataDir, codexDir, crypto) {
    this.dataDir = dataDir;
    this.codexDir = codexDir;
    this.crypto = crypto;
    this.file = path.join(dataDir, "settings.json");
    this.state = { providers: [], officialOverrides: {}, autoStart: false };
    this.officialModels = [];
    this.readCatalog();
    if (fs.existsSync(this.file)) {
      const persisted = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.state = {
        ...this.state,
        ...persisted,
        providers: persisted.providers.map((p) => ({
          ...p,
          ...JSON.parse(crypto.decryptString(Buffer.from(p.secrets, "base64"))),
          secrets: undefined,
        })),
      };
    }
    this.writeCatalog();
  }
  readCatalog() {
    try {
      const c = JSON.parse(
        fs.readFileSync(path.join(this.codexDir, "models_cache.json"), "utf8"),
      );
      this.officialModels = c.models.filter(
        (m) => m.slug && !m.slug.includes("::"),
      );
    } catch {
      this.officialModels = [
        {
          slug: "gpt-6-astra",
          display_name: "GPT-6-Astra",
          context_window: 272000,
        },
      ];
    }
  }
  save() {
    if (!this.crypto.isEncryptionAvailable())
      throw new Error("Windows 凭据加密不可用，未保存");
    const providers = this.state.providers.map(
      ({ apiKey, extraHeaders, ...p }) => ({
        ...p,
        secrets: this.crypto
          .encryptString(JSON.stringify({ apiKey, extraHeaders }))
          .toString("base64"),
      }),
    );
    atomic(this.file, JSON.stringify({ ...this.state, providers }, null, 2));
    this.writeCatalog();
  }
  writeCatalog() {
    atomic(
      path.join(this.dataDir, "catalog.json"),
      JSON.stringify(
        makeCatalog(
          this.officialModels,
          this.state.providers,
          this.state.officialOverrides,
        ),
        null,
        2,
      ),
    );
  }
  public() {
    return {
      ...this.state,
      providers: this.state.providers.map(({ apiKey, extraHeaders, ...p }) => ({
        ...p,
        hasKey: !!apiKey,
        headerCount: Object.keys(extraHeaders || {}).length,
      })),
      officialModels: this.officialModels.map((m) => ({
        ...normalizeModel(
          this.state.officialOverrides[m.slug] || {
            model: m.slug,
            displayName: m.display_name,
          },
          { id: "official", name: "OpenAI 官方", wireApi: "openai-responses" },
          this.officialModels,
        ),
        official: true,
      })),
    };
  }
  import(raw) {
    const incoming = parseImport(raw, this.officialModels);
    const merged = [...this.state.providers];
    for (const p of incoming) {
      const index = merged.findIndex((x) => x.id === p.id);
      if (index < 0) merged.push(p);
      else {
        if (!p.apiKey) {
          if (
            new URL(p.baseUrl).origin !== new URL(merged[index].baseUrl).origin
          )
            throw new Error(
              "导入文件更改了已有供应商域名但未提供新 Key，已拒绝复用旧凭据",
            );
          p.apiKey = merged[index].apiKey;
        }
        merged[index] = p;
      }
    }
    const previous = this.state.providers;
    this.state.providers = merged;
    try {
      this.save();
    } catch (error) {
      this.state.providers = previous;
      throw error;
    }
    return {
      providers: incoming.length,
      models: incoming.reduce((a, p) => a + p.models.length, 0),
    };
  }
  updateProvider(input) {
    const existing = this.state.providers.find((p) => p.id === input.id);
    if (
      existing &&
      new URL(existing.baseUrl).origin !==
        new URL(input.baseUrl || existing.baseUrl).origin &&
      !input.apiKey
    )
      throw new Error(
        "更改供应商域名后请重新填写 API Key，避免旧密钥发送到新站点",
      );
    const provider = normalizeProvider(
      {
        ...existing,
        ...input,
        apiKey: input.apiKey || existing?.apiKey || "",
        extraHeaders: input.extraHeaders ?? existing?.extraHeaders ?? {},
      },
      this.officialModels,
    );
    const index = this.state.providers.findIndex((p) => p.id === provider.id);
    if (index < 0) this.state.providers.push(provider);
    else this.state.providers[index] = provider;
    this.save();
    return provider.id;
  }
  model(providerId, input, originalName) {
    if (providerId === "official") {
      const model = normalizeModel(
        input,
        { id: "official", name: "OpenAI 官方" },
        this.officialModels,
      );
      this.state.officialOverrides[model.model] = model;
    } else {
      const p = this.state.providers.find((p) => p.id === providerId);
      if (!p) throw new Error("供应商不存在");
      const model = normalizeModel(input, p, this.officialModels);
      const idx = p.models.findIndex(
        (m) => m.model === (originalName || model.model),
      );
      if (p.models.some((m, i) => m.model === model.model && i !== idx))
        throw new Error("模型名称重复");
      if (idx < 0) p.models.push(model);
      else p.models[idx] = model;
    }
    this.save();
  }
}
module.exports = { Store };
