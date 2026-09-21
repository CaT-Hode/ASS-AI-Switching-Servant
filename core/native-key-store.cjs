const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomic } = require("./config.cjs");
const { OFFICIAL_SERVICES } = require("./official-services.cjs");
class NativeKeyStore {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, "native-accounts.json");
    this.crypto = safeStorage;
    this.accounts = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : [];
  }
  public() {
    return this.accounts.map(({ secret, ...a }) => ({
      ...a,
      hasKey: !!secret,
    }));
  }
  read(id) {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) throw Error("账户不存在");
    return this.crypto.decryptString(Buffer.from(account.secret, "base64"));
  }
  save(input) {
    if (!OFFICIAL_SERVICES.some((s) => s.id === input.vendorId && s.nativeKey))
      throw Error("此服务应使用供应商 API 账户");
    if (!input.label?.trim()) throw Error("请输入账户名称");
    const previous = this.accounts.find((a) => a.id === input.id);
    if (input.id && !previous) throw Error("账户不存在");
    if (!this.crypto.isEncryptionAvailable()) throw Error("系统凭据加密不可用");
    const secret = input.apiKey?.trim()
      ? this.crypto.encryptString(input.apiKey.trim()).toString("base64")
      : previous?.secret;
    if (!secret) throw Error("请输入 API Key");
    const value = {
      id: previous?.id || crypto.randomBytes(12).toString("hex"),
      vendorId: input.vendorId,
      label: input.label.trim().slice(0, 80),
      secret,
      updatedAt: new Date().toISOString(),
    };
    const accounts = this.accounts
      .filter((a) => a.id !== value.id)
      .concat(value);
    atomic(this.file, JSON.stringify(accounts, null, 2));
    this.accounts = accounts;
    return value.id;
  }
  remove(id) {
    const accounts = this.accounts.filter((a) => a.id !== id);
    atomic(this.file, JSON.stringify(accounts, null, 2));
    this.accounts = accounts;
  }
}
module.exports = { NativeKeyStore };
