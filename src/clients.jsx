import React, { useEffect, useRef, useState } from "react";
import {
  Terminal,
  KeyRound,
  UserRound,
  Plus,
  Folder,
  LogIn,
  LogOut,
  Check,
  RefreshCw,
  ChevronRight,
  Search,
  Settings2,
  Wallet,
  Unlink,
  ExternalLink,
} from "lucide-react";
import { Modal, ProviderEditor } from "./editors.jsx";
import {
  AddAccount,
  NativeKeyAccounts,
  NativeKeyForm,
} from "./account-dialogs.jsx";
import { ActionMenu } from "./menus.jsx";
import { AccountProfile } from "./account-profile.jsx";
import { ConnectionStatus, ConnectionService } from "./connections.jsx";
const api = window.ass;

export function AccountForm({ client, onClose, onSave, initialProvider = "" }) {
  const [label, setLabel] = useState(""),
    [provider, setProvider] = useState(initialProvider),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={"添加 " + client.name + " 授权账户"}
      description="使用独立凭据目录，不覆盖本机账户。"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(label, provider);
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
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如 个人账户 / 工作账户"
          />
        </label>
        {client.id === "pi" && (
          <label className="field">
            OAuth provider ID（可选）
            <input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="留空，在 pi 的 /login 中选择"
            />
          </label>
        )}
        <p className="hint">创建后点击“登录授权”，在原生客户端完成登录。</p>
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
            {busy ? "正在创建…" : "创建账户"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function AccountCard({
  account: a,
  client,
  state,
  act,
  busy,
  run,
  openProvider,
  editProvider,
}) {
  const selected = a.id === client.selected,
    models = a.models || [];
  const saved = client.modelSelections[a.id],
    chosen = models.some((m) => m.model === saved)
      ? saved
      : models[0]?.model || "";
  const warning = [
    "expired",
    "refresh-required",
    "unreadable",
    "incomplete",
    "external",
  ].includes(a.status);
  const provider = state.providers.find((p) => p.id === a.providerId);
  const service = state.officialServices.find(
    (s) => s.id === state.officialProviderIds[a.providerId],
  );
  const balance = state.balances[a.providerId];
  return (
    <article
      className={"client-account-card" + (selected ? " selected" : "")}
      aria-label={a.label + " 账户"}
    >
      <header>
        <span className="account-symbol">
          {a.kind === "api" || a.authType === "api" ? (
            <KeyRound size={18} />
          ) : (
            <UserRound size={18} />
          )}
        </span>
        <div className="account-card-title">
          <h3>{a.label}</h3>
          <span>{a.source || "ASS 供应商"}</span>
        </div>
        <span className="tag">{a.badge}</span>
        {provider && (
          <ActionMenu
            label={a.label + " 账户操作"}
            disabled={!!busy}
            items={[
              {
                label: "编辑凭据",
                icon: Settings2,
                action: () => editProvider(provider),
              },
              {
                label: "管理模型",
                icon: ChevronRight,
                action: () => openProvider(a.providerId),
              },
              {
                label: "查询余额",
                icon: Wallet,
                action: () =>
                  act("balance-" + a.providerId, () =>
                    api.call("balance", a.providerId),
                  ),
              },
              service && {
                label: "官方控制台",
                icon: ExternalLink,
                action: () =>
                  act("official-open", () =>
                    api.call("official-open", service.id, "console"),
                  ),
              },
              {
                label: "解除此客户端绑定",
                icon: Unlink,
                danger: true,
                action: () =>
                  act("account-unbind", () =>
                    api.call(
                      "account-bind-api",
                      client.id,
                      a.providerId,
                      false,
                    ),
                  ),
              },
            ]}
          />
        )}
      </header>
      <AccountProfile account={a} {...{ client, state, act, busy }} />
      <p
        className={
          "account-status" + (warning ? " warning" : a.ready ? " ready" : "")
        }
      >
        <i aria-hidden="true" />
        {a.profile?.remote && !a.profile.error && !a.profile.stale
          ? "已读取官方资料 · 模型连接需单独检测"
          : a.message}
      </p>
      {a.expiresAt && (
        <small className="account-expiry">
          令牌到期：{new Date(a.expiresAt).toLocaleString()}
        </small>
      )}
      {a.kind === "api" && (
        <div className="account-model-summary">
          <span>启动模型</span>
          <strong>{chosen || "没有兼容模型"}</strong>
          <button
            className="text-button"
            onClick={() => openProvider(a.providerId)}
          >
            管理模型
            <ChevronRight size={13} />
          </button>
        </div>
      )}
      {balance && (
        <p className="account-balance-summary">
          {balance.ok
            ? (balance.rows || [balance])
                .map((r) => `${r.label || ""} ${r.value} ${r.unit || ""}`)
                .join(" · ")
            : balance.message}
        </p>
      )}
      {a.kind !== "api" && (
        <details className="account-origin">
          <summary>凭据位置</summary>
          <code>{a.sourcePath}</code>
        </details>
      )}
      {a.kind === "native" && ["opencode", "dsh"].includes(client.id) && (
        <small className="account-expiry">供应商在原生客户端内选择</small>
      )}
      <footer>
        <button
          className={"text-button account-choice" + (selected ? " chosen" : "")}
          disabled={!!busy || selected}
          onClick={() =>
            act("account-select", () =>
              api.call("account-select", client.id, a.id),
            )
          }
        >
          {selected && <Check size={13} />}
          {selected ? "已选择" : "切换到此账户"}
        </button>
        <div className="actions">
          {a.kind !== "api" && a.authType !== "api" && (
            <>
              <button
                className="icon-button"
                title="登录授权"
                aria-label={a.label + " 登录授权"}
                disabled={!client.executable || !!busy}
                onClick={() => run(a, "login")}
              >
                <LogIn size={15} />
              </button>
              <button
                className="icon-button"
                title="退出授权"
                aria-label={a.label + " 退出授权"}
                disabled={!client.executable || !!busy}
                onClick={() => run(a, "logout")}
              >
                <LogOut size={15} />
              </button>
            </>
          )}
          <button
            className="button"
            title={
              client.launcher?.kind === "desktop"
                ? "独立账户启动需要 OpenCode CLI；可在右上角打开桌面端"
                : undefined
            }
            disabled={
              !client.executable ||
              !!busy ||
              (a.kind === "api" &&
                (!a.ready ||
                  !models.length ||
                  !state.connections.clients[client.id].enabled))
            }
            onClick={() => run(a, "launch", chosen)}
          >
            <Terminal size={14} />
            启动
          </button>
        </div>
      </footer>
    </article>
  );
}

export function Clients({
  state,
  act,
  busy,
  onManage,
  initialClient = "codex",
  onSelectClient,
  openProvider,
}) {
  const [selected, setSelected] = useState(initialClient),
    [adding, setAdding] = useState(false),
    [oauth, setOAuth] = useState(false),
    [editor, setEditor] = useState(null),
    [nativeKey, setNativeKey] = useState(null),
    [candidates, setCandidates] = useState(null),
    [notice, setNotice] = useState("");
  const client =
    state.harnesses.clients.find((c) => c.id === selected) ||
    state.harnesses.clients[0];
  const nativeService = state.officialServices.find(
    (s) =>
      s.nativeKey &&
      s.id === selected &&
      state.nativeAccounts.some((a) => a.vendorId === s.id),
  );
  const nativeServices = state.officialServices.filter(
    (s) => s.nativeKey && state.nativeAccounts.some((a) => a.vendorId === s.id),
  );
  const activeClient = nativeService?.id || client.id;
  const addButton = useRef(null);
  function closeAdding() {
    setAdding(false);
    requestAnimationFrame(() => addButton.current?.focus());
  }
  function closeOAuth() {
    setOAuth(false);
    requestAnimationFrame(() => addButton.current?.focus());
  }
  // Returning from a native login window refreshes status without running auth helpers.
  useEffect(() => {
    const refresh = () =>
      api
        .call("snapshot")
        .catch(() => setNotice("状态读取失败，请点击刷新状态。"));
    const tick = setInterval(() => {
      if (document.hasFocus()) refresh();
    }, 15000);
    window.addEventListener("focus", refresh);
    refresh();
    return () => {
      clearInterval(tick);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const run = (account, action, model) =>
    act("client-" + action, async () => {
      const r = await api.call(
        "client-launch",
        client.id,
        account.id,
        action,
        model,
      );
      if (r?.message) setNotice(r.message);
      return r;
    });
  const detect = () =>
    act("client-detect", async () => {
      const result = await api.call("client-detect", client.id);
      if (result.candidates.length > 1) setCandidates(result.candidates);
      else
        setNotice(
          result.candidates.length
            ? "已识别并选择客户端入口。"
            : "未找到客户端，请选择安装或源码目录。",
        );
    });
  return (
    <>
      {state.connections.error && (
        <p role="alert" className="error-box">
          {state.connections.error}
        </p>
      )}
      <div className="clients-layout">
        <nav className="client-list" aria-label="客户端列表">
          {state.harnesses.clients.map((c) => (
            <div
              key={c.id}
              className={
                "client-entry" + (c.id === activeClient ? " active" : "")
              }
            >
              <button
                className="client-select"
                aria-pressed={c.id === activeClient}
                onClick={() => {
                  setSelected(c.id);
                  onSelectClient?.(c.id);
                  setNotice("");
                  setCandidates(null);
                }}
              >
                <Terminal size={19} />
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {c.launcher?.kind === "desktop"
                      ? "已安装桌面端"
                      : c.executable
                        ? "已找到客户端"
                        : "未检测到安装"}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            </div>
          ))}
          {nativeServices.map((s) => (
            <div
              className={"client-entry" + (selected === s.id ? " active" : "")}
              key={s.id}
            >
              <button
                className="client-select"
                aria-pressed={selected === s.id}
                onClick={() => {
                  setSelected(s.id);
                  onSelectClient?.(s.id);
                  setNotice("");
                }}
              >
                <KeyRound size={19} />
                <span>
                  <strong>{s.name}</strong>
                  <small>原生 Key 保管</small>
                </span>
                <ChevronRight size={14} />
              </button>
            </div>
          ))}
          <button
            className="text-button native-key-add"
            onClick={() =>
              setNativeKey(state.officialServices.find((s) => s.nativeKey))
            }
          >
            <Plus size={14} />
            添加原生客户端 Key
          </button>
        </nav>
        {nativeService ? (
          <NativeKeyAccounts
            service={nativeService}
            accounts={state.nativeAccounts.filter(
              (a) => a.vendorId === nativeService.id,
            )}
            {...{ state, act, busy }}
          />
        ) : (
          <section
            className="client-panel"
            aria-label={client.name + " 账户管理"}
          >
            <header className="client-heading">
              <h2>
                {client.name}
                <span className="count">{client.accounts.length}</span>
              </h2>
              <div className="actions">
                {client.desktop && (
                  <button
                    className="icon-button"
                    title="打开 OpenCode Desktop"
                    aria-label="打开 OpenCode Desktop"
                    disabled={!!busy}
                    onClick={() =>
                      act("client-open-desktop", async () => {
                        const result = await api.call("client-open-desktop", client.id);
                        setNotice(result.message);
                      })
                    }
                  >
                    <ExternalLink size={16} />
                  </button>
                )}
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    act("client-refresh", () => api.call("client-refresh"))
                  }
                >
                  <RefreshCw size={14} />
                  刷新状态
                </button>
                {
                  <button
                    className="button primary"
                    ref={addButton}
                    onClick={() => setAdding(true)}
                  >
                    <Plus size={14} />
                    添加账户
                  </button>
                }
              </div>
            </header>
            <ConnectionStatus {...{ client, state, busy, onManage }} />
            <div className="client-account-grid">
              {client.accounts.map((a) => (
                <AccountCard
                  key={a.id}
                  account={a}
                  {...{ client, state, act, busy, run, openProvider }}
                  editProvider={setEditor}
                />
              ))}
              {!client.accounts.length && (
                <div className="empty">
                  <KeyRound size={23} />
                  <p>
                    没有已有账户。点击“添加账户”绑定 API 或创建原生授权账户。
                  </p>
                </div>
              )}
            </div>
            <details className="client-settings" key={client.id}>
              <summary>客户端路径与凭据目录</summary>
              <div className="client-location-actions" aria-label="客户端位置">
                <button className="button" disabled={!!busy} onClick={detect}>
                  <Search size={14} />
                  自动识别
                </button>
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    act("client-directory", () =>
                      api.call("client-executable", client.id, true),
                    )
                  }
                >
                  <Folder size={14} />
                  选择目录
                </button>
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    act("client-path", () =>
                      api.call("client-executable", client.id),
                    )
                  }
                >
                  选择文件
                </button>
              </div>
              <div className="client-location" role="status">
                <p
                  className={
                    "launcher-state " +
                    (client.launcher?.ready || client.launcher?.installed ? "ready" : "")
                  }
                >
                  {(client.launcher?.ready || client.launcher?.installed) && (
                    <Check size={14} />
                  )}
                  {client.launcher?.message || "未检测到安装"}
                </p>
                {client.launcher?.location && (
                  <p className="client-path mono">{client.launcher.location}</p>
                )}
                {client.launcher?.ready && (
                  <details className="launcher-command">
                    <summary>查看启动入口</summary>
                    <code>{client.launcher.command}</code>
                  </details>
                )}
              </div>
              <div className="section-heading">
                <h3>凭据检测位置</h3>
                <div className="actions">
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() =>
                      act("client-credentials", () =>
                        api.call("client-credentials", client.id),
                      )
                    }
                  >
                    指定凭据目录
                  </button>
                  {client.credentialHome && (
                    <button
                      className="text-button"
                      onClick={() =>
                        act("client-credentials", () =>
                          api.call("client-credentials", client.id, true),
                        )
                      }
                    >
                      恢复默认
                    </button>
                  )}
                </div>
              </div>
              <div className="credential-sources">
                {client.credentialSources.map((s) => (
                  <div key={s.file}>
                    <code>{s.file}</code>
                    <span>{s.message}</span>
                  </div>
                ))}
              </div>
            </details>
            <div className="client-workspace">
              <Folder size={15} />
              <span className="ellipsis" title={state.harnesses.workspace}>
                {state.harnesses.workspace || "ASS 独立工作目录"}
              </span>
              <button
                className="text-button"
                onClick={() =>
                  act("client-workspace", () => api.call("client-workspace"))
                }
              >
                选择工作目录
              </button>
            </div>
            {client.id === "pi" && (
              <details className="pi-import">
                <summary>
                  从其他客户端导入 OAuth{" "}
                  <span className="count">
                    {state.harnesses.oauthSources.length}
                  </span>
                </summary>
                <p className="hint">
                  {state.harnesses.piOAuthProviders.length
                    ? "本机 pi 支持：" +
                      state.harnesses.piOAuthProviders
                        .map((p) => p.name)
                        .join("、")
                    : "未确认本机 pi 的 OAuth 能力，请选择 pi 程序后刷新。"}
                </p>
                {state.harnesses.oauthSources.map((s) => (
                  <div className="oauth-source" key={s.id}>
                    <div>
                      <strong>{s.label}</strong>
                      <small>
                        {s.provider} ·{" "}
                        {s.expired ? "需客户端刷新" : "本地授权快照"}
                      </small>
                    </div>
                    <button
                      className="button"
                      disabled={!s.compatible || !!busy}
                      onClick={() =>
                        act("pi-import", () =>
                          api.call("pi-import-oauth", s.id, s.label + " → pi"),
                        )
                      }
                    >
                      {s.compatible ? "导入到 pi" : "未确认兼容"}
                    </button>
                  </div>
                ))}
                <p className="hint">
                  导入会新建独立账户，不覆盖来源。两端分别刷新令牌，可能使另一端失效。
                </p>
              </details>
            )}
            {notice && (
              <p className="client-notice" role="status">
                {notice}
              </p>
            )}
          </section>
        )}
      </div>
      <ConnectionService {...{ state, busy, onManage }} />
      {adding && (
        <AddAccount
          key={client.id}
          client={client}
          state={state}
          onClose={closeAdding}
          onOAuth={() => {
            setAdding(false);
            setOAuth(true);
          }}
        />
      )}
      {editor && (
        <ProviderEditor
          provider={editor}
          presets={state.providerPresets}
          balancePresets={state.balancePresets}
          onClose={() => setEditor(null)}
          onSave={(p) => api.call("save-provider", p)}
        />
      )}
      {nativeKey && (
        <NativeKeyForm service={nativeKey} onClose={() => setNativeKey(null)} />
      )}
      {oauth && (
        <AccountForm
          client={client}
          onClose={closeOAuth}
          onSave={async (label, provider) => {
            await api.call("account-add", client.id, label, provider);
            await act("account-refresh", () => api.call("snapshot"));
          }}
        />
      )}
      {candidates && (
        <Modal
          title="选择识别到的客户端"
          description="选择要使用的位置。"
          onClose={() => setCandidates(null)}
        >
          <div className="launcher-candidates">
            {candidates.map((candidate) => (
              <button
                className="account-row"
                key={candidate.location}
                disabled={!!busy}
                onClick={() =>
                  act("client-location", async () => {
                    await api.call(
                      "client-location",
                      client.id,
                      candidate.location,
                    );
                    setCandidates(null);
                    setNotice("已选择客户端入口。");
                  })
                }
              >
                <Folder size={18} />
                <span className="account-content">
                  <strong>{candidate.message}</strong>
                  <small>{candidate.location}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
