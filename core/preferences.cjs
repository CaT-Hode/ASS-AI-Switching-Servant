const fs = require("node:fs");
const path = require("node:path");
const { atomic } = require("./config.cjs");
const defaults = {
  view: "overview",
  client: "codex",
  provider: "official",
  officialService: "openai",
  providerOrder: [],
  quotaAccounts: {},
};
class Preferences {
  constructor(dataDir) {
    this.file = path.join(dataDir, "preferences.json");
    this.state = { ...defaults };
    try {
      this.state = this.validate(
        JSON.parse(fs.readFileSync(this.file, "utf8")),
      );
    } catch {}
  }
  validate(input) {
    const next = { ...this.state };
    for (const key of ["view", "client", "provider", "officialService"]) {
      const value = input[key];
      if (
        typeof value !== "string" ||
        value.length > 160 ||
        /[\x00-\x1f]/.test(value)
      )
        continue;
      if (
        key === "view" &&
        ![
          "overview",
          "providers",
          "clients",
          "accounts",
          "diagnostics",
          "updates",
        ].includes(value)
      )
        continue;
      if (
        key === "client" &&
        !["codex", "claude", "opencode", "pi", "dsh", "cursor"].includes(value)
      )
        continue;
      next[key] = key === "view" && value === "accounts" ? "clients" : value;
    }
    if (Array.isArray(input.providerOrder)) {
      if (
        input.providerOrder.length > 5000 ||
        input.providerOrder.some(
          (id) =>
            typeof id !== "string" ||
            !id ||
            id.length > 250 ||
            /[\x00-\x1f]/.test(id),
        )
      )
        throw Error("供应商排序格式无效");
      next.providerOrder = [...new Set(input.providerOrder)];
    }
    if (
      input.quotaAccounts &&
      typeof input.quotaAccounts === "object" &&
      !Array.isArray(input.quotaAccounts)
    ) {
      next.quotaAccounts = {
        ...next.quotaAccounts,
        ...Object.fromEntries(
          Object.entries(input.quotaAccounts)
            .filter(
              ([id, value]) =>
                id.length <= 250 &&
                typeof value === "string" &&
                value.length <= 250 &&
                !/[\x00-\x1f]/.test(id + value),
            )
            .slice(0, 5000),
        ),
      };
    }
    return next;
  }
  update(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw Error("界面配置格式无效");
    const next = this.validate(input);
    atomic(this.file, JSON.stringify(next, null, 2));
    this.state = next;
    return next;
  }
}
module.exports = { Preferences };
