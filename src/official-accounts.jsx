import React, { useState } from "react";
import {
  Search,
  Plus,
  KeyRound,
  UserRound,
  ExternalLink,
  ShieldCheck,
  ChevronRight,
  RefreshCw,
  Settings2,
  Trash2,
  Copy,
  Wallet,
  Globe,
  Check,
  LogIn,
} from "lucide-react";
import { Modal, ProviderEditor } from "./editors.jsx";
import { AccountForm } from "./clients.jsx";
import "./official-accounts.css";
const api = window.ass;
function NativeKeyForm({ service, account, onClose }) {
  const [label, setLabel] = useState(account?.label || service.name),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={account ? "编辑原生 API 账户" : "添加原生 API 账户"}
      description={service.name + " · 仅保存凭据，不接入通用模型路由"}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.call("native-key-save", {
              id: account?.id,
              vendorId: service.id,
              label,
              apiKey: key,
            });
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          账户名称
          <input
            required
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="field">
          API Key
          <input
            type="password"
            autoComplete="off"
            required={!account}
            placeholder={account ? "留空保留已保存的 Key" : ""}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <p className="hint">
          Windows
          加密保存，前端不读取已保存的密钥。需要使用时可主动复制到原生客户端。
        </p>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            保存账户
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function authRows(state, service) {
  if (!service.oauth) return [];
  return state.harnesses.clients.flatMap((client) =>
    client.accounts
      .filter(
        (a) =>
          a.kind === "auth" &&
          ((service.oauth.harness !== "pi" &&
            client.id === service.oauth.harness) ||
            (client.id === "pi" &&
              (a.oauthProvider === service.oauth.pi ||
                a.providers?.includes(service.oauth.pi)))),
      )
      .map((a) => ({ ...a, client })),
  );
}
export function OfficialAccounts({
  state,
  act,
  busy,
  openClient,
  openProvider,
}) {
  const [selected, setSelected] = useState("openai"),
    [search, setSearch] = useState(""),
    [onlySaved, setOnlySaved] = useState(false),
    [editor, setEditor] = useState(null),
    [native, setNative] = useState(null),
    [addingAuth, setAddingAuth] = useState(false),
    [notice, setNotice] = useState("");
  const services = state.officialServices,
    service = services.find((s) => s.id === selected) || services[0];
  const providers = state.providers.filter(
      (p) => state.officialProviderIds[p.id] === service.id,
    ),
    nativeAccounts = state.nativeAccounts.filter(
      (a) => a.vendorId === service.id,
    ),
    oauth = authRows(state, service);
  const count = (s) =>
    state.providers.filter((p) => state.officialProviderIds[p.id] === s.id)
      .length +
    state.nativeAccounts.filter((a) => a.vendorId === s.id).length +
    authRows(state, s).length;
  const shown = services.filter(
    (s) =>
      (!onlySaved || count(s)) &&
      (s.name + " " + s.id + " " + s.profiles.map((p) => p.name).join(" "))
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const client = state.harnesses.clients.find(
    (c) => c.id === service.oauth?.harness,
  );
  const authAvailable =
    client &&
    (client.id !== "pi" ||
      state.harnesses.piOAuthProviders.some((p) => p.id === service.oauth.pi));
  const auth = state.openRouterAuth,
    authorizing = ["waiting", "exchanging"].includes(auth.status);
  const open = (target) =>
    act("official-open", () => api.call("official-open", service.id, target));
  const unknownCount = state.providers.filter(
    (p) => !state.officialProviderIds[p.id],
  ).length;
  const chooseAccount = (c, id) =>
    act("account-select", async () => {
      await api.call("account-select", c.id, id);
      openClient(c.id);
    });
  return (
    <>
      <div className="accounts-banner">
        <ShieldCheck size={23} />
        <div>
          <strong>凭据统一管理，授权方式各自独立</strong>
          <p>
            API 按供应商额度计费；订阅 OAuth
            由原生客户端登录和刷新。保存凭据不代表连接已通过。
          </p>
        </div>
        <span className="tag">{services.length} 组官方服务</span>
      </div>
      <div className="official-layout">
        <aside className="official-directory">
          <label className="search">
            <Search size={15} />
            <input
              aria-label="搜索官方服务"
              placeholder="搜索服务"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="check-field small">
            <input
              type="checkbox"
              checked={onlySaved}
              onChange={(e) => setOnlySaved(e.target.checked)}
            />
            只看已添加
          </label>
          <nav aria-label="官方服务列表">
            {shown.map((s) => (
              <button
                key={s.id}
                aria-current={service.id === s.id ? "page" : undefined}
                className={service.id === s.id ? "active" : ""}
                onClick={() => {
                  setSelected(s.id);
                  setNotice("");
                }}
              >
                <span className="official-monogram">{s.name[0]}</span>
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.category} · {count(s)} 个账户
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </nav>
          {!shown.length && (
            <p className="hint">
              没有匹配的服务。可清除筛选，或添加自定义 API。
            </p>
          )}
          <button className="button" onClick={() => setEditor({})}>
            <Plus size={14} />
            自定义 API 账户
          </button>
          {unknownCount > 0 && (
            <small className="hint">
              {unknownCount} 个中转 /
              自定义供应商保留在“供应商与模型”，不会标为官方。
            </small>
          )}
        </aside>
        <section
          className="official-detail"
          aria-label={service.name + " 账户详情"}
        >
          <header className="official-heading">
            <div>
              <span className="eyebrow">OFFICIAL ACCOUNTS</span>
              <h2>{service.name}</h2>
              <p>
                {service.note ||
                  "添加多套官方 API 凭据，并分别配置模型与余额接口。"}
              </p>
            </div>
            <div className="actions">
              <button className="button" onClick={() => open("console")}>
                <ExternalLink size={14} />
                官方控制台
              </button>
              <button className="text-button" onClick={() => open("docs")}>
                授权文档
                <ExternalLink size={13} />
              </button>
            </div>
          </header>
          <div className="account-methods">
            {service.profiles.length > 0 && (
              <span>
                <KeyRound size={14} />
                API Key · 加密保存
              </span>
            )}
            {service.oauth && (
              <span>
                <UserRound size={14} />
                原生 OAuth · 独立目录
              </span>
            )}
            {service.pkce && (
              <span>
                <Globe size={14} />
                PKCE → API Key
              </span>
            )}
            {service.nativeKey && (
              <span>
                <KeyRound size={14} />
                原生客户端 Key
              </span>
            )}
            {service.externalOAuth && (
              <span className="muted">原生 OAuth · 客户端外部管理</span>
            )}
          </div>
          {service.profiles.length > 0 && (
            <section className="official-section">
              <div className="section-heading">
                <h3>
                  API 账户 <span className="count">{providers.length}</span>
                </h3>
                <span className="muted tiny">
                  可保存多套凭据，与模型路由共用
                </span>
              </div>
              <div className="api-profile-choices">
                {service.profiles.map((preset) => (
                  <button
                    className="button"
                    key={preset.id}
                    onClick={() => setEditor({ preset })}
                  >
                    <Plus size={14} />
                    {preset.name}
                  </button>
                ))}
              </div>
              {!providers.length ? (
                <div className="account-empty">
                  <KeyRound size={24} />
                  <strong>还没有 API 账户</strong>
                  <p>
                    从上方选择 API
                    产品或地区。保存后可发现模型，再使用模型右侧的闪电检测。
                  </p>
                </div>
              ) : (
                <div className="official-account-list">
                  {providers.map((p) => (
                    <article className="official-account" key={p.id}>
                      <div className="official-account-title">
                        <KeyRound size={17} />
                        <div>
                          <strong>{p.name}</strong>
                          <small>{p.baseUrl}</small>
                        </div>
                        <span className={"tag " + (p.hasKey ? "good" : "")}>
                          {!p.enabled
                            ? "已停用"
                            : p.hasKey
                              ? "Key 已保存"
                              : "未填写 Key"}
                        </span>
                      </div>
                      <div className="official-account-meta">
                        <span>
                          {p.models.length} 个模型 ·{" "}
                          {p.network === "direct"
                            ? "直接连接"
                            : "系统代理 / CA"}
                        </span>
                        <div className="actions">
                          <button
                            className="text-button"
                            onClick={() => setEditor({ provider: p })}
                          >
                            <Settings2 size={14} />
                            编辑凭据
                          </button>
                          <button
                            className="text-button"
                            onClick={() => openProvider(p.id)}
                          >
                            管理模型
                            <ChevronRight size={14} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={"移除账户 " + p.name}
                            disabled={!!busy}
                            onClick={() =>
                              act("remove-account", () =>
                                api.call("delete-provider", p.id),
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="account-balance">
                        <Wallet size={14} />
                        <span>
                          {state.balances[p.id]?.ok
                            ? state.balances[p.id].rows
                                ?.map(
                                  (r) =>
                                    `${r.label || ""} ${r.value} ${r.unit}`,
                                )
                                .join(" · ") ||
                              `${state.balances[p.id].value} ${state.balances[p.id].unit}`
                            : state.balances[p.id]?.message ||
                              "余额 / 用量尚未查询；无公开接口时请使用控制台"}
                        </span>
                        <button
                          className="text-button"
                          disabled={!!busy}
                          onClick={() =>
                            act("balance-" + p.id, () =>
                              api.call("balance", p.id),
                            )
                          }
                        >
                          查询
                        </button>
                      </div>
                      <div className="account-client-links">
                        <span>选择到客户端</span>
                        {state.harnesses.clients
                          .filter((c) =>
                            c.accounts.some(
                              (a) => a.id === "api:" + p.id && a.ready,
                            ),
                          )
                          .map((c) => (
                            <button
                              key={c.id}
                              className="text-button"
                              disabled={!!busy}
                              onClick={() => chooseAccount(c, "api:" + p.id)}
                            >
                              {c.name}
                              <ChevronRight size={12} />
                            </button>
                          ))}
                        {!p.models.length && (
                          <small className="muted">先添加兼容模型</small>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          {service.pkce && (
            <section className="pkce-panel">
              <Globe size={22} />
              <div>
                <h3>通过 OpenRouter 浏览器授权</h3>
                <p>
                  由官网确认权限与额度，通过 PKCE 换取独立 API Key。5
                  分钟内完成，可随时取消。
                </p>
                {auth.status !== "idle" && (
                  <p
                    role="status"
                    className={auth.status === "failed" ? "danger" : "muted"}
                  >
                    {auth.message}
                  </p>
                )}
              </div>
              <button
                className="button"
                disabled={!!busy}
                onClick={() =>
                  act("openrouter-auth", () =>
                    api.call(
                      authorizing
                        ? "openrouter-auth-cancel"
                        : "openrouter-auth-start",
                    ),
                  )
                }
              >
                {authorizing ? "取消授权" : "浏览器授权"}
              </button>
            </section>
          )}
          {service.oauth && (
            <section className="official-section">
              <div className="section-heading">
                <h3>
                  订阅 / OAuth 账户{" "}
                  <span className="count">{oauth.length}</span>
                </h3>
                <div className="actions">
                  <button
                    className="icon-button"
                    aria-label="刷新授权状态"
                    onClick={() =>
                      act("client-refresh", () => api.call("client-refresh"))
                    }
                  >
                    <RefreshCw size={15} />
                  </button>
                  <button
                    className="button"
                    disabled={!authAvailable}
                    onClick={() => setAddingAuth(true)}
                  >
                    <Plus size={14} />
                    添加授权账户
                  </button>
                </div>
              </div>
              {!authAvailable && (
                <p className="hint">
                  请先安装并识别支持 {service.oauth.pi} 的
                  pi；未确认兼容时不会创建看似可用的授权入口。
                </p>
              )}
              {!oauth.length && (
                <p className="account-empty compact">
                  创建独立账户后，从原生客户端完成登录。ASS 不读取浏览器
                  Cookie。
                </p>
              )}
              {oauth.map((a) => (
                <article className="official-account" key={a.client.id + a.id}>
                  <div className="official-account-title">
                    <UserRound size={18} />
                    <div>
                      <strong>{a.label}</strong>
                      <small>
                        {a.client.name} · {a.message}
                      </small>
                    </div>
                    {a.client.selected === a.id && (
                      <span className="tag good">
                        <Check size={12} />
                        已选择
                      </span>
                    )}
                  </div>
                  <div className="official-account-meta">
                    <span>独立原生凭据，不改变已运行会话</span>
                    <div className="actions">
                      <button
                        className="text-button"
                        disabled={!a.client.executable || !!busy}
                        onClick={() =>
                          act("auth-login", async () => {
                            const r = await api.call(
                              "client-launch",
                              a.client.id,
                              a.id,
                              "login",
                            );
                            setNotice(r?.message || "");
                            return r;
                          })
                        }
                      >
                        <LogIn size={14} />
                        登录授权
                      </button>
                      <button
                        className="button"
                        disabled={!!busy}
                        onClick={() => chooseAccount(a.client, a.id)}
                      >
                        选择 / 启动
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {service.oauth.pi && (
                <button
                  className="text-button"
                  onClick={() => openClient("pi")}
                >
                  查看兼容授权并导入到 pi
                  <ChevronRight size={14} />
                </button>
              )}
            </section>
          )}
          {service.nativeKey && (
            <section className="official-section">
              <div className="section-heading">
                <h3>
                  原生 API Key{" "}
                  <span className="count">{nativeAccounts.length}</span>
                </h3>
                <button className="button" onClick={() => setNative({})}>
                  <Plus size={14} />
                  添加 Key
                </button>
              </div>
              {!nativeAccounts.length && (
                <p className="account-empty compact">
                  为 Cursor 原生客户端加密保管多套 Key；此处不会将其发送到
                  OpenAI 或其他上游。
                </p>
              )}
              {nativeAccounts.map((a) => (
                <article className="official-account" key={a.id}>
                  <div className="official-account-title">
                    <KeyRound size={17} />
                    <div>
                      <strong>{a.label}</strong>
                      <small>Key 已加密 · 仅原生客户端使用</small>
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      className="text-button"
                      onClick={() => setNative(a)}
                    >
                      <Settings2 size={14} />
                      编辑
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        act("copy-key", async () => {
                          const r = await api.call("native-key-copy", a.id);
                          setNotice(r.message);
                          return r;
                        })
                      }
                    >
                      <Copy size={14} />
                      复制 Key
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() =>
                        act("remove-key", () =>
                          api.call("native-key-remove", a.id),
                        )
                      }
                    >
                      <Trash2 size={14} />
                      移除
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}
          {service.externalOAuth && (
            <div className="external-auth-note">
              <UserRound size={18} />
              <div>
                <strong>此服务的原生 OAuth 仍由原生客户端管理</strong>
                <p>
                  本版本不提供其 OAuth
                  多账户快照、切换或向其他客户端移植。可管理上方的 API
                  凭据；原生登录请按官方文档操作。
                </p>
              </div>
            </div>
          )}
          {notice && (
            <p role="status" className="client-notice">
              {notice}
            </p>
          )}
          <p className="hint official-footnote">
            官方归类按已知 API
            域名匹配，不按供应商自定义名称猜测。移除本机账户不会撤销官网凭据；授权有效性与额度以供应商为准。
          </p>
        </section>
      </div>
      {editor && (
        <ProviderEditor
          provider={editor.provider}
          initialPreset={editor.preset}
          presets={state.providerPresets}
          balancePresets={state.balancePresets}
          onClose={() => setEditor(null)}
          onSave={(p) => api.call("save-provider", p)}
        />
      )}
      {native && (
        <NativeKeyForm
          service={service}
          account={native.id ? native : null}
          onClose={() => setNative(null)}
        />
      )}
      {addingAuth && (
        <AccountForm
          client={client}
          initialProvider={client.id === "pi" ? service.oauth.pi : ""}
          onClose={() => setAddingAuth(false)}
          onSave={(label, provider) =>
            api.call("account-add", client.id, label, provider)
          }
        />
      )}
    </>
  );
}
