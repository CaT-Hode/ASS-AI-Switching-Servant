import React, { useEffect, useState } from "react";
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
} from "lucide-react";
import { Modal } from "./editors.jsx";
import {
  ConnectionPill,
  ConnectionStatus,
  ConnectionService,
} from "./connections.jsx";
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

function AccountCard({ account: a, client, state, act, busy, run }) {
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
      </header>
      <p
        className={
          "account-status" + (warning ? " warning" : a.ready ? " ready" : "")
        }
      >
        <i aria-hidden="true" />
        {a.message}
      </p>
      {a.expiresAt && (
        <small className="account-expiry">
          令牌到期：{new Date(a.expiresAt).toLocaleString()}
        </small>
      )}
      {a.kind === "api" && (
        <label className="field account-model">
          模型
          <select
            aria-label={a.label + " 使用模型"}
            value={chosen}
            disabled={!models.length || !!busy}
            onChange={(e) =>
              act("client-model", () =>
                api.call("client-model", client.id, a.id, e.target.value),
              )
            }
          >
            {!models.length && <option value="">没有兼容模型</option>}
            {models.map((m) => (
              <option key={m.model} value={m.model}>
                {m.name} · {m.protocol}
              </option>
            ))}
          </select>
        </label>
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
          {selected ? "已选择" : "选择"}
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
            disabled={
              !client.executable ||
              !!busy ||
              (a.kind === "api" &&
                (!models.length ||
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
}) {
  const [selected, setSelected] = useState(initialClient),
    [adding, setAdding] = useState(false),
    [candidates, setCandidates] = useState(null),
    [notice, setNotice] = useState("");
  const client =
    state.harnesses.clients.find((c) => c.id === selected) ||
    state.harnesses.clients[0];
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
              className={"client-entry" + (c.id === selected ? " active" : "")}
            >
              <button
                className="client-select"
                aria-pressed={c.id === selected}
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
                    {c.executable ? "已找到客户端" : "未检测到安装"}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
              <ConnectionPill client={c} {...{ state, busy, onManage }} />
            </div>
          ))}
        </nav>
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
              {client.oauth && (
                <button
                  className="button primary"
                  onClick={() => setAdding(true)}
                >
                  <Plus size={14} />
                  添加授权账户
                </button>
              )}
            </div>
          </header>
          <ConnectionStatus {...{ client, state }} />
          <div className="client-account-grid">
            {client.accounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                {...{ client, state, act, busy, run }}
              />
            ))}
            {!client.accounts.length && (
              <div className="empty">
                <KeyRound size={23} />
                <p>
                  未检测到本机凭据。可登录原生客户端、添加授权账户或配置 API
                  供应商。
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
                  "launcher-state " + (client.launcher?.ready ? "ready" : "")
                }
              >
                {client.launcher?.ready && <Check size={14} />}
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
      </div>
      <ConnectionService {...{ state, busy, onManage }} />
      {adding && (
        <AccountForm
          client={client}
          onClose={() => setAdding(false)}
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
