import React, { useState } from "react";
import { Search, KeyRound, Plus, ChevronRight, Globe } from "lucide-react";
import { Modal, ProviderEditor } from "./editors.jsx";
const api = window.ass;
export function NativeKeyForm({ service, account, onClose }) {
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

export function AddAccount({ client, state, onClose, onOAuth }) {
  const [search, setSearch] = useState(""),
    [creating, setCreating] = useState(false),
    [editor, setEditor] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const candidates = client.availableApiAccounts.filter((a) =>
    a.label.toLowerCase().includes(search.toLowerCase()),
  );
  const services = state.officialServices.filter((s) =>
    s.profiles.some((p) => client.id !== "claude" || p.wireApi === "anthropic"),
  );
  async function bind(providerId) {
    setBusy(true);
    setError("");
    try {
      await api.call("account-bind-api", client.id, providerId);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const auth = state.openRouterAuth,
    authorizing = ["waiting", "exchanging"].includes(auth.status);
  if (editor)
    return (
      <ProviderEditor
        provider={editor.provider}
        initialPreset={editor.preset}
        presets={state.providerPresets}
        balancePresets={state.balancePresets}
        onClose={() => setEditor(null)}
        onSave={async (p) => {
          await api.call("account-save-api", client.id, p);
          onClose();
        }}
      />
    );
  return (
    <Modal title={"添加 " + client.name + " 账户"} onClose={onClose}>
      <div className="account-add-actions">
        {client.oauth && (
          <button className="button" onClick={onOAuth}>
            <Plus size={15} />
            原生授权账户
          </button>
        )}
        <button
          className={"button" + (creating ? " primary" : "")}
          onClick={() => setCreating(!creating)}
        >
          <KeyRound size={15} />
          新建 API 账户
        </button>
      </div>
      {!creating ? (
        <>
          <label className="search">
            <Search size={15} />
            <input
              aria-label="搜索已有 API 账户"
              placeholder="搜索已有供应商"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="account-bind-list">
            {candidates.map((a) => (
              <button
                className="account-row"
                key={a.id}
                disabled={busy}
                onClick={() => bind(a.providerId)}
              >
                <KeyRound size={18} />
                <span className="account-content">
                  <strong>{a.label}</strong>
                  <small>
                    {a.models.length} 个兼容模型 · {a.message}
                  </small>
                </span>
                <span>添加</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          {!candidates.length && (
            <p className="catalog-empty">
              {search ? "没有匹配的账户。" : "没有可添加的已有 API 账户。"}
            </p>
          )}
        </>
      ) : (
        <>
          <button className="button" onClick={() => setEditor({})}>
            <Plus size={15} />
            自定义 API
          </button>
          <div className="account-preset-list">
            {services.map((s) => (
              <section key={s.id}>
                <h3>{s.name}</h3>
                <div>
                  {s.profiles
                    .filter(
                      (p) =>
                        client.id !== "claude" || p.wireApi === "anthropic",
                    )
                    .map((p) => (
                      <button
                        className="button"
                        key={p.id}
                        onClick={() => setEditor({ preset: p })}
                      >
                        {p.name}
                        <ChevronRight size={13} />
                      </button>
                    ))}
                </div>
              </section>
            ))}
          </div>
          {client.id !== "claude" && (
            <div className="account-pkce">
              <Globe size={18} />
              <span>OpenRouter 浏览器授权</span>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api.call(
                      authorizing
                        ? "openrouter-auth-cancel"
                        : "openrouter-auth-start",
                      undefined,
                      client.id,
                    );
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {authorizing ? "取消授权" : "开始授权"}
              </button>
              {auth.status !== "idle" && <p role="status">{auth.message}</p>}
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </Modal>
  );
}
export function NativeKeyAccounts({ service, accounts, state, act, busy }) {
  const [editor, setEditor] = useState(null),
    [notice, setNotice] = useState("");
  return (
    <section className="client-panel" aria-label={service.name + " 账户管理"}>
      <header className="client-heading">
        <h2>
          {service.name}
          <span className="count">{accounts.length}</span>
        </h2>
        <button className="button primary" onClick={() => setEditor({})}>
          <Plus size={14} />
          添加账户
        </button>
      </header>
      <p className="hint">
        仅保管原生客户端 Key，不注入通用路由；OAuth 仍在原生客户端管理。
      </p>
      <div className="client-account-grid">
        {accounts.map((a) => (
          <article
            className="client-account-card"
            key={a.id}
            aria-label={a.label + " 账户"}
          >
            <header>
              <span className="account-symbol">
                <KeyRound size={18} />
              </span>
              <div className="account-card-title">
                <h3>{a.label}</h3>
                <span>Key 已加密保存</span>
              </div>
              <span className="tag">原生 API</span>
            </header>
            <footer>
              <button className="text-button" onClick={() => setEditor(a)}>
                编辑凭据
              </button>
              <button
                className="button"
                disabled={!!busy}
                onClick={() =>
                  act("copy-key", async () => {
                    const r = await api.call("native-key-copy", a.id);
                    setNotice(r.message);
                    return r;
                  })
                }
              >
                复制 Key
              </button>
              <button
                className="text-button danger"
                disabled={!!busy}
                onClick={() =>
                  act("remove-key", () => api.call("native-key-remove", a.id))
                }
              >
                移除
              </button>
            </footer>
          </article>
        ))}
      </div>
      {notice && (
        <p role="status" className="client-notice">
          {notice}
        </p>
      )}
      {editor && (
        <NativeKeyForm
          service={service}
          account={editor.id ? editor : null}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}
