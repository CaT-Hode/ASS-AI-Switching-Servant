const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { NativeFields, document, read, hash } = require("./native-fields.cjs");
const { nativeLocations } = require("./credential-status.cjs");
const { endpoint } = require("./models.cjs");
const DIRECT = ["opencode", "pi", "dsh"];
const APIS = {
  "openai-responses": "openai-responses",
  "openai-chat": "openai-completions",
  anthropic: "anthropic-messages",
};
const NPMS = {
  "openai-responses": "@ai-sdk/openai",
  "openai-chat": "@ai-sdk/openai-compatible",
  anthropic: "@ai-sdk/anthropic",
};
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const providerId = (p, protocol) =>
  "ass-" +
  createHash("sha256").update(p.id).digest("hex").slice(0, 16) +
  "-" +
  {
    "openai-responses": "responses",
    "openai-chat": "chat",
    anthropic: "messages",
  }[protocol];
// pi interprets commands/environment variables even in auth.json API keys.
const piLiteral = (value) =>
  String(value)
    .replaceAll("$", () => "$$")
    .replace(/^!/, "$!");

function locations(harness, manager) {
  const env = manager.nativeEnv,
    home = manager.nativeHome;
  const dir = nativeLocations(
    harness,
    home,
    env,
    manager.state.credentialHomes[harness],
  )[0];
  if (harness === "opencode") {
    const configDir = path.join(
      env.XDG_CONFIG_HOME || path.join(home, ".config"),
      "opencode",
    );
    const candidates = ["opencode.jsonc", "opencode.json", "config.json"].map(
      (f) => path.join(configDir, f),
    );
    const config = env.OPENCODE_CONFIG
      ? path.resolve(env.OPENCODE_CONFIG)
      : candidates.find((f) => fs.existsSync(f)) || candidates[0];
    return { dir, config, auth: path.join(dir, "auth.json") };
  }
  if (harness === "pi")
    return {
      dir,
      config: path.join(dir, "models.json"),
      auth: path.join(dir, "auth.json"),
      settings: path.join(dir, "settings.json"),
    };
  if (harness === "dsh")
    return {
      dir,
      config: path.join(dir, "settings.yaml"),
      auth: path.join(dir, ".credentials.yaml"),
    };
  throw Error("此客户端不使用原生 API 配置接入");
}
function baseUrl(harness, p, wire) {
  const url = endpoint(p.baseUrl, wire).replace(
    /\/(?:responses|chat\/completions|messages)$/,
    "",
  );
  // Anthropic's own SDK appends /v1/messages; the AI SDK appends /messages.
  return wire === "anthropic" && harness !== "opencode"
    ? url.replace(/\/v1$/, "")
    : url;
}
function reasoning(model) {
  return Object.fromEntries(
    LEVELS.map((level) => [
      level,
      model.efforts.includes(level) ? level : null,
    ]),
  );
}
function compose(harness, manager, selection) {
  const target = locations(harness, manager),
    fields = [];
  const field = (file, format, keys, value, extra = {}) =>
    fields.push({ harness, file, format, path: keys, value, ...extra });
  const client = manager.snapshot().clients.find((c) => c.id === harness);
  const available = client.accounts.filter((a) => a.kind === "api" && a.ready);
  const selectedId = selection?.account || client.selected;
  let selected;
  for (const account of available) {
    const p = manager
      .getState()
      .providers.find((p) => p.id === account.providerId);
    const grouped = Map.groupBy(
      p.models.filter((m) => m.enabled),
      (m) => m.wireApi,
    );
    for (const [wire, models] of grouped) {
      if (!APIS[wire]) throw Error("原生接入不支持此模型协议");
      const id = providerId(p, wire),
        base = baseUrl(harness, p, wire);
      const headers = p.extraHeaders || {};
      if (harness === "opencode") {
        const value = {
          name: p.name,
          npm: NPMS[wire],
          options: { baseURL: base, headers },
          models: Object.fromEntries(
            models.map((m) => [
              m.model,
              {
                name: m.displayName,
                limit: { context: m.contextWindow, output: m.maxOutputTokens },
                reasoning: m.efforts.length > 0,
                ...(wire === "anthropic"
                  ? {}
                  : {
                      options: { reasoningEffort: m.defaultEffort },
                      variants: Object.fromEntries(
                        m.efforts.map((e) => [e, { reasoningEffort: e }]),
                      ),
                    }),
              },
            ]),
          ),
        };
        // OpenCode substitutes these anywhere in config, not just API key fields.
        if (/\{(?:env|file):/.test(JSON.stringify(value)))
          throw Error(
            "原生 OpenCode 配置不接受导入值中的 env/file 插值，请先改为字面值",
          );
        field(target.config, "jsonc", ["provider", id], value);
        field(
          target.auth,
          "json",
          [id],
          { type: "api", key: p.apiKey },
          { credentialProvider: id },
        );
      } else if (harness === "pi") {
        field(target.config, "json", ["providers", id], {
          baseUrl: base,
          api: APIS[wire],
          headers: Object.fromEntries(
            Object.entries(headers).map(([k, v]) => [k, piLiteral(v)]),
          ),
          models: models.map((m) => ({
            id: m.model,
            name: m.displayName,
            contextWindow: m.contextWindow,
            maxTokens: m.maxOutputTokens,
            input: ["text"],
            reasoning: m.efforts.length > 0,
            thinkingLevelMap: reasoning(m),
          })),
        });
        field(
          target.auth,
          "json",
          [id],
          { type: "api_key", key: piLiteral(p.apiKey) },
          { credentialProvider: id },
        );
      } else {
        field(target.config, "yaml", ["llm-pi-ai", "providers", id], {
          displayName: p.name,
          baseURL: base,
          api: APIS[wire],
          headers,
          models: models.map((m) => ({
            id: m.model,
            name: m.displayName,
            contextWindow: m.contextWindow,
            maxTokens: m.maxOutputTokens,
            input: ["text"],
            reasoningEfforts: Object.fromEntries(
              m.efforts.filter((e) => LEVELS.includes(e)).map((e) => [e, e]),
            ),
          })),
        });
        field(
          target.auth,
          "yaml",
          ["records", "llm-pi-ai/" + id],
          { kind: "api-key", key: p.apiKey },
          { credentialProvider: id },
        );
      }
      if (account.id === selectedId) {
        const name =
          selection?.model ||
          client.modelSelections[account.id] ||
          account.models[0]?.model;
        const m = models.find((m) => m.model === name);
        if (m) selected = { id, model: m };
      }
    }
  }
  if (harness === "dsh" && fields.length) {
    const credentials = document(read(target.auth), "yaml").data;
    if (credentials.version !== undefined && credentials.version !== 1)
      throw Error("DSH 凭据格式不是 version: 1，请先用 DSH 完成升级");
    // Structural marker is deliberately retained on disconnect, so newly added
    // native records remain readable even if ASS originally created the file.
    if (credentials.version !== 1)
      field(target.auth, "yaml", ["version"], 1, { retain: true });
  }
  if (selected) {
    const { id, model: m } = selected;
    if (harness !== "opencode" && !LEVELS.includes(m.defaultEffort))
      throw Error(
        `${harness} 原生思维档位最高为 max；请修改所选模型的默认档位`,
      );
    if (harness === "opencode")
      field(target.config, "jsonc", ["model"], id + "/" + m.model, {
        replace: true,
      });
    if (harness === "pi") {
      field(target.settings, "json", ["defaultProvider"], id, {
        replace: true,
      });
      field(target.settings, "json", ["defaultModel"], m.model, {
        replace: true,
      });
      field(
        target.settings,
        "json",
        ["defaultThinkingLevel"],
        m.defaultEffort,
        { replace: true },
      );
      field(
        target.settings,
        "json",
        ["modelThinkingLevels", id + "/" + m.model],
        m.defaultEffort,
      );
    }
    if (harness === "dsh") {
      for (const [key, value] of Object.entries({
        provider: id,
        model: m.model,
        reasoningEffort: m.defaultEffort,
      }))
        field(target.config, "yaml", ["agent-default-model", key], value, {
          replace: true,
        });
    }
  }
  return { target, fields, selected };
}

class NativeConfig {
  constructor(dataDir, crypto, manager) {
    this.fields = new NativeFields(dataDir, crypto);
    this.manager = manager;
    this.errors = {};
    this.activated = new Set(this.fields.entries.map((e) => e.harness));
  }
  isDirect(id) {
    return DIRECT.includes(id);
  }
  list(ids) {
    return [
      ...new Set(
        this.fields.entries
          .filter((e) => ids.includes(e.harness))
          .map((e) => e.file),
      ),
    ];
  }
  owns(id, file, provider) {
    return this.fields.owns(id, file, provider);
  }
  desired(id, selection) {
    const plan = compose(id, this.manager, selection);
    // Keep a structural marker owned across subsequent syncs.
    for (const e of this.fields.entries.filter(
      (e) => e.harness === id && e.retain,
    )) {
      if (
        Object.values(plan.target).includes(e.file) &&
        !plan.fields.some(
          (d) =>
            d.file === e.file &&
            JSON.stringify(d.path) === JSON.stringify(e.path),
        )
      )
        plan.fields.push({ ...e, value: e.after.value });
    }
    return plan;
  }
  preflight(ids, enabled) {
    for (const id of ids.filter((id) => this.isDirect(id))) {
      if (this.fields.state.pending) {
        this.fields.recoveryCheck();
        continue;
      }
      this.fields.plan(
        id,
        enabled ? this.desired(id).fields : this.retained(id),
      );
    }
  }
  retained(id) {
    return this.fields.entries
      .filter((e) => e.harness === id && e.retain)
      .map((e) => ({ ...e, value: e.after.value }));
  }
  sync(id, selection) {
    if (!this.isDirect(id)) return;
    try {
      this.fields.recover();
      const plan = this.desired(id, selection);
      this.fields.apply(id, plan.fields);
      this.activated.add(id);
      delete this.errors[id];
      return plan;
    } catch (error) {
      this.errors[id] = error.message;
      throw error;
    }
  }
  restore(ids) {
    for (const id of ids.filter((id) => this.isDirect(id))) {
      this.fields.apply(id, this.retained(id));
      // Retained structural markers are no longer owned and contain no secret.
      this.fields.save({
        entries: this.fields.entries.filter((e) => e.harness !== id),
        pending: null,
      });
      delete this.errors[id];
      this.activated.delete(id);
    }
  }
  fingerprint(ids, enabled) {
    return hash(
      JSON.stringify(
        ids
          .filter((id) => this.isDirect(id))
          .map((id) => [
            this.fields.fingerprint(id),
            enabled
              ? this.desired(id).fields.map((e) => [e, read(e.file)])
              : null,
          ]),
      ),
    );
  }
  status(id, enabled = false) {
    const files = this.list([id]);
    if (!this.isDirect(id)) return {};
    let error = this.fields.error || this.errors[id] || "",
      pending = !!this.fields.state.pending;
    if (enabled && !pending && !error) {
      try {
        pending =
          this.fields.plan(id, this.desired(id).fields).files.length > 0;
      } catch (e) {
        error = e.message;
      }
    }
    return { mode: "native", files, error, pending };
  }
}
module.exports = {
  NativeConfig,
  compose,
  locations,
  providerId,
  DIRECT,
  piLiteral,
  baseUrl,
};
