import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Network,
  LayoutGrid,
  Boxes,
  Activity,
  ShieldCheck,
  Upload,
  Plug,
  Unplug,
  Square,
  Play,
  Plus,
  Check,
  ChevronRight,
  Settings2,
  Search,
  X,
  Wallet,
  RefreshCw,
  ArrowUpRight,
  Download,
  Folder,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Loader2,
  KeyRound,
  SlidersHorizontal,
} from "lucide-react";
import "./style.css";
import "./controls.css";
import "./polish.css";
import "./clients.css";
import { Clients } from "./clients.jsx";
import { ConnectionDialog } from "./connections.jsx";
import { OfficialAccounts } from "./official-accounts.jsx";
import { Updates, UpdateBanner } from "./updates.jsx";
import { ModelEditor, ProviderEditor } from "./editors.jsx";
import {
  modelKey,
  ModelActions,
  ModelCheckButton,
  ModelCapabilityDialog,
  ProviderModelsDialog,
} from "./model-inspection.jsx";
const api = window.ass;
const efforts = ["low", "medium", "high", "xhigh", "max", "ultra"];
const protocols = {
  "openai-responses": "Responses",
  "openai-chat": "Chat Completions",
  anthropic: "Anthropic Messages",
};
const date = (value) =>
  new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
const format = (value) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
function Button({
  children,
  primary = false,
  icon: Icon,
  busy = false,
  ...props
}) {
  return (
    <button
      className={"button" + (primary ? " primary" : "")}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy ? (
        <Loader2 className="spin" size={16} />
      ) : Icon ? (
        <Icon size={16} />
      ) : null}
      {children}
    </button>
  );
}
function Tag({ good, children }) {
  return (
    <span className={"tag " + (good ? "good" : "")}>
      {good && <Check size={12} />} {children}
    </span>
  );
}
function ProviderIcon({ p }) {
  return (
    <span
      className={"provider-icon " + (p.id === "official" ? "official" : "")}
    >
      <span>
        {p.id === "official" ? (
          <Network size={23} />
        ) : (
          p.name.slice(0, 1).toUpperCase()
        )}
      </span>
    </span>
  );
}
function RequestTable({ rows }) {
  return (
    <div className="request-table">
      <div className="table-head request-row">
        <span>时间</span>
        <span>模型</span>
        <span>来源</span>
        <span>状态</span>
        <span>耗时</span>
      </div>
      {!rows.length ? (
        <div className="empty">
          <Activity size={26} />
          <p>等待第一个请求</p>
          <small>连接检测或 Codex 请求会显示在这里，不记录对话内容。</small>
        </div>
      ) : (
        rows.slice(0, 8).map((r, i) => (
          <div className="request-row" key={r.time + i}>
            <span className="muted mono">{date(r.time)}</span>
            <span className="ellipsis" title={r.model}>
              {r.model.split("::").at(-1)}
            </span>
            <span className="muted">{r.source}</span>
            <span className={r.ok ? "success" : "danger"} title={r.error}>
              {r.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{" "}
              {r.ok ? "成功" : r.status}
            </span>
            <span className="muted mono">{(r.ms / 1000).toFixed(2)} s</span>
          </div>
        ))
      )}
    </div>
  );
}
function Overview({ state, providers, act, busy, setView }) {
  return (
    <>
      <div className="overview-grid">
        <section>
          <div className="section-heading">
            <h2>模型来源</h2>
            <button
              className="text-button"
              onClick={() => setView("providers")}
            >
              管理模型 <ChevronRight size={14} />
            </button>
          </div>
          <div className="source-table">
            <div className="source-row table-head">
              <span>来源</span>
              <span>协议</span>
              <span>模型</span>
              <span>操作</span>
            </div>
            {providers.map((p) => (
              <div className="source-row" key={p.id}>
                <div className="source-name">
                  <ProviderIcon p={p} />
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {
                        p.models.filter(
                          (m) => state.diagnostics[modelKey(p.id, m.model)]?.ok,
                        ).length
                      }{" "}
                      / {p.models.length} 个模型连接已验证
                    </small>
                  </div>
                </div>
                <span className="muted">
                  {new Set(p.models.map((m) => m.wireApi)).size > 1
                    ? "混合协议"
                    : protocols[p.models[0]?.wireApi] ||
                      protocols[p.wireApi] ||
                      "Responses"}
                </span>
                <span className="muted">{p.models.length} 个模型</span>
                <Button
                  icon={ChevronRight}
                  onClick={() => setView("providers")}
                >
                  查看模型
                </Button>
              </div>
            ))}
          </div>
        </section>
        <aside className="security-panel">
          <h2>安全连接</h2>
          <div className="trust">
            <ShieldCheck size={43} />
            <div>
              <h3>Windows 系统证书</h3>
              <p>使用系统信任的 CA，保留 TLS 校验。</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>ChatGPT 登录</dt>
              <dd className={state.authReady ? "success" : "muted"}>
                {state.authReady ? (
                  <>
                    <CheckCircle2 size={15} /> 已检测
                  </>
                ) : (
                  "未检测"
                )}
              </dd>
            </div>
            <div>
              <dt>凭据存储</dt>
              <dd>
                {state.encrypted ? (
                  <>
                    <CheckCircle2 size={15} /> Windows 加密
                  </>
                ) : (
                  "加密不可用"
                )}
              </dd>
            </div>
            <div>
              <dt>窗口关闭后</dt>
              <dd>
                <CheckCircle2 size={15} /> 托盘运行
              </dd>
            </div>
          </dl>
          <label className="check-field small">
            <input
              type="checkbox"
              checked={state.autoStart}
              onChange={(e) =>
                act("auto", () => api.call("autostart", e.target.checked))
              }
            />
            登录 Windows 时启动
          </label>
        </aside>
      </div>
      <section className="recent-section">
        <div className="section-heading">
          <h2>最近请求</h2>
          <span className="muted tiny">仅记录模型、状态与耗时</span>
        </div>
        <RequestTable rows={state.recent} />
      </section>
      <footer className="page-footer">
        ASS · 模型随你切，账户由你管。模型设置修改后，重启 Codex 刷新目录。
      </footer>
    </>
  );
}
function Providers({
  state,
  providers,
  act,
  busy,
  initialProvider = "official",
}) {
  const [selected, setSelected] = useState(initialProvider),
    [search, setSearch] = useState(""),
    [editor, setEditor] = useState(null),
    [inspection, setInspection] = useState(null),
    [discovering, setDiscovering] = useState(false),
    [providerEditor, setProviderEditor] = useState(false);
  const p = providers.find((p) => p.id === selected) || providers[0];
  const balance = state.balances[p.id];
  return (
    <>
      <div className="provider-toolbar">
        <div className="provider-tabs">
          {providers.map((p) => (
            <button
              key={p.id}
              className={p.id === selected ? "active" : ""}
              onClick={() => setSelected(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <Button icon={Plus} onClick={() => setProviderEditor("new")}>
          添加供应商
        </Button>
      </div>
      <div className="provider-detail">
        <div>
          <div className="detail-title">
            <ProviderIcon p={p} />
            <h2>{p.name}</h2>
            <Tag good={p.id === "official" || p.hasKey}>
              {p.id === "official"
                ? "ChatGPT 登录"
                : p.hasKey
                  ? "密钥已加密"
                  : "待填写密钥"}
            </Tag>
          </div>
          <p className="muted mono">{p.baseUrl}</p>
        </div>
        <div className="actions">
          {p.id !== "official" && (
            <Button icon={Settings2} onClick={() => setProviderEditor("edit")}>
              供应商设置
            </Button>
          )}
          {p.id !== "official" && (
            <Button icon={Search} onClick={() => setDiscovering(true)}>
              发现模型与能力
            </Button>
          )}
        </div>
      </div>
      {p.id !== "official" && (
        <div className="balance-strip">
          <div>
            <Wallet size={19} />
            <span>账户余额</span>
            <strong>
              {balance?.ok
                ? (balance.rows || [balance])
                    .map((r) => `${r.label || ""} ${format(r.value)} ${r.unit}`)
                    .join(" · ")
                : p.balance?.preset === "auto"
                  ? "自动识别 · 尚未查询"
                  : p.balance?.path
                    ? "尚未查询"
                    : "待配置余额接口"}
            </strong>
            {balance?.time && (
              <small className="muted">{date(balance.time)} 更新</small>
            )}
          </div>
          <Button
            icon={RefreshCw}
            busy={busy === "balance-" + p.id}
            onClick={() =>
              p.balance?.preset === "auto" || p.balance?.path
                ? act("balance-" + p.id, () => api.call("balance", p.id))
                : setProviderEditor("edit")
            }
          >
            {p.balance?.preset === "auto" || p.balance?.path
              ? "查询余额"
              : "配置接口"}
          </Button>
          {balance && !balance.ok && (
            <p className="danger">{balance.message}</p>
          )}
        </div>
      )}
      <div className="section-heading">
        <h2>
          模型配置 <span className="count">{p.models.length}</span>
        </h2>
        <div className="actions">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="搜索模型"
              placeholder="搜索模型"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {p.id !== "official" && (
            <Button icon={Plus} onClick={() => setEditor({ model: null })}>
              添加模型
            </Button>
          )}
        </div>
      </div>
      <div className="models-table">
        <div className="model-row table-head">
          <span>模型名称</span>
          <span>接口类型</span>
          <span>上下文</span>
          <span>思维强度</span>
          <span />
        </div>
        {p.models
          .filter((m) =>
            (m.model + " " + m.displayName)
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((m) => (
            <div className="model-row" key={m.model}>
              <button
                className="model-name model-name-button"
                aria-label={"配置模型 " + m.model}
                onClick={() => setEditor({ model: m })}
              >
                <strong>{m.displayName}</strong>
                <small>
                  {m.enabled === false ? "已停用 · " : ""}
                  {m.model}
                </small>
                {state.diagnostics[modelKey(p.id, m.model)] && (
                  <small
                    className={
                      state.diagnostics[modelKey(p.id, m.model)].ok
                        ? "success"
                        : "danger"
                    }
                  >
                    {state.diagnostics[modelKey(p.id, m.model)].ok
                      ? "连接通过"
                      : "连接失败"}{" "}
                    ·{" "}
                    {Math.round(state.diagnostics[modelKey(p.id, m.model)].ms)}{" "}
                    ms
                  </small>
                )}
              </button>
              <span className="muted">{protocols[m.wireApi]}</span>
              <span>
                <strong className="mono">{format(m.contextWindow)}</strong>
                <small className="muted">tokens</small>
              </span>
              <span className="model-efforts">
                {m.efforts.map((e) => (
                  <i key={e} className={e === m.defaultEffort ? "default" : ""}>
                    {e}
                  </i>
                ))}
              </span>
              <ModelActions
                provider={p}
                model={m}
                {...{ state, act, busy }}
                onEdit={() => setEditor({ model: m })}
                onInspect={() => setInspection(m)}
              />
            </div>
          ))}
      </div>
      <p className="hint">
        点击模型名称编辑；右侧闪电仅检测该模型。选中的强度进入 Codex
        菜单；蓝色强度是默认值。上下文默认值可单独覆盖。
      </p>
      {p.id !== "official" && (
        <button
          className="text-button danger"
          onClick={() => act("delete", () => api.call("delete-provider", p.id))}
        >
          移除此供应商
        </button>
      )}
      {editor && (
        <ModelEditor
          provider={p}
          model={editor.model}
          onClose={() => setEditor(null)}
          onSave={(m) => api.call("save-model", p.id, m, editor.model?.model)}
        />
      )}{" "}
      {inspection && (
        <ModelCapabilityDialog
          provider={p}
          model={inspection}
          {...{ state, act, busy }}
          onClose={() => setInspection(null)}
        />
      )}
      {discovering && (
        <ProviderModelsDialog
          provider={p}
          {...{ state, act, busy }}
          onClose={() => setDiscovering(false)}
        />
      )}
      {providerEditor && (
        <ProviderEditor
          presets={state.providerPresets}
          balancePresets={state.balancePresets}
          provider={providerEditor === "edit" ? p : null}
          onClose={() => setProviderEditor(false)}
          onSave={(m) => api.call("save-provider", m)}
        />
      )}
    </>
  );
}
function Diagnostics({ state, providers, act, busy }) {
  return (
    <>
      <div className="info-box">
        <ShieldCheck size={25} />
        <div>
          <strong>系统 CA + 完整流式响应检测</strong>
          <small>
            每次检测发送一条简短请求，验证登录、TLS、模型协议和
            response.completed。会产生少量模型用量。
          </small>
        </div>
      </div>
      <div className="diagnostic-list">
        {providers.flatMap((p) =>
          p.models.map((m) => {
            const d = state.diagnostics[modelKey(p.id, m.model)];
            return (
              <div className="diagnostic" key={modelKey(p.id, m.model)}>
                <ProviderIcon p={p} />
                <div className="diagnostic-content">
                  <h3>
                    {p.name} / {m.displayName}
                  </h3>
                  <p className={d && !d.ok ? "danger" : "muted"}>
                    {d?.message || "尚未执行连接检测"}
                  </p>
                  {d && (
                    <small>
                      {d.model} · {(d.ms / 1000).toFixed(2)} s · {date(d.time)}
                    </small>
                  )}
                </div>
                <ModelCheckButton
                  provider={p}
                  model={m}
                  {...{ state, act, busy }}
                />
              </div>
            );
          }),
        )}
      </div>
      <div className="diagnostic-settings">
        <h2>本机状态</h2>
        <dl>
          <div>
            <dt>路由入口</dt>
            <dd className="mono">http://127.0.0.1:{state.service.port}/clients/codex/v1</dd>
          </div>
          <div>
            <dt>Codex 接入</dt>
            <dd>{state.codex.attached ? "已接入 ASS" : "未接入"}</dd>
          </div>
          <div>
            <dt>TLS 校验</dt>
            <dd>已开启 · Chromium 系统网络栈</dd>
          </div>
          <div>
            <dt>数据目录</dt>
            <dd className="ellipsis" title={state.dataDir}>
              {state.dataDir}
            </dd>
          </div>
        </dl>
        <div className="actions">
          <Button
            icon={Folder}
            onClick={() => act("data", () => api.call("open-data"))}
          >
            打开数据目录
          </Button>
          <Button
            icon={Download}
            onClick={() => act("export", () => api.call("export"))}
          >
            导出配置（无密钥）
          </Button>
        </div>
      </div>
      <section className="recent-section">
        <h2>最近请求</h2>
        <RequestTable rows={state.recent} />
      </section>
    </>
  );
}
function App() {
  const [state, setState] = useState(null),
    [view, setView] = useState("overview"),
    [clientTarget, setClientTarget] = useState("codex"),
    [providerTarget, setProviderTarget] = useState("official"),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState(null);
  const [connectionRequest, setConnectionRequest] = useState(null);
  useEffect(() => api?.onManage((request) => {
    setView("clients");
    setConnectionRequest((previous) => previous || request);
  }), []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);
  useEffect(() => {
    if (!api) return;
    api
      .call("snapshot")
      .then(setState)
      .catch((e) => setToast({ error: true, message: e.message }));
    return api.subscribe(setState);
  }, []);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(null), 7000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  async function act(key, fn, success) {
    setBusy(key);
    try {
      const r = await fn();
      if (r?.ok === false) setToast({ error: true, message: r.message });
      else if (success) setToast({ message: success });
      else if (key === "import" && r)
        setToast({
          message: `已导入 ${r.providers} 个供应商、${r.models} 个模型`,
        });
      setState(await api.call("snapshot"));
      return r;
    } catch (e) {
      setToast({
        error: true,
        message: e.message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      });
    } finally {
      setBusy("");
    }
  }
  if (!api)
    return (
      <div className="loading">
        <Monitor size={32} />
        <h2>请从 ASS 桌面应用打开</h2>
        <p>此界面通过本机桌面通道管理路由，不提供网页管理入口。</p>
      </div>
    );
  if (!state)
    return (
      <div className="loading">
        <Loader2 className="spin" />
        <p>正在加载本机路由…</p>
      </div>
    );
  const providers = [
    {
      id: "official",
      name: "OpenAI 官方",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      models: state.officialModels,
    },
    ...state.providers,
  ];
  const title = {
    overview: "路由总览",
    providers: "供应商与模型",
    clients: "客户端与账户",
    accounts: "官方账户中心",
    diagnostics: "连接诊断",
    updates: "关于 ASS",
  }[view];
  const desc = {
    overview: "ASS，让模型切换更顺手。",
    providers: "独立配置协议、上下文窗口与思维强度。",
    clients: "切换 API 与授权账户，启动独立客户端。",
    accounts: "管理官方 API 凭据与订阅授权，清晰区分账户和计费。",
    diagnostics: "从本机证书到完整响应，确认每一条连接。",
    updates: "检查新版，掌握更新节奏。",
  }[view];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="./ass-logo.png" alt="ASS 菊花标志" />
          <div>
            <strong>ASS</strong>
            <small>模型随你切</small>
          </div>
        </div>
        <div className="nav-label">工作空间</div>
        <nav aria-label="主导航">
          {[
            ["overview", LayoutGrid, "路由总览"],
            ["providers", Boxes, "供应商与模型"],
            ["accounts", KeyRound, "官方账户中心"],
            ["clients", Monitor, "客户端与账户"],
            ["diagnostics", Activity, "连接诊断"],
            ["updates", Download, "关于 ASS"],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <Icon size={21} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Monitor size={18} />
          <span>本地运行 · 仅此设备</span>
        </div>
        <button
          className="version version-button"
          aria-label="查看 ASS 版本与更新"
          onClick={() => setView("updates")}
        >
          {state.updates.available && <span className="update-dot" />}v
          {state.version}
          {state.updates.available ? " · 发现新版" : " · 检查更新"}
        </button>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <h1>{title}</h1>
            <p>{desc}</p>
          </div>
          <div className="actions">
            <Button
              icon={Upload}
              busy={busy === "import"}
              onClick={() => act("import", () => api.call("import"))}
            >
              导入配置
            </Button>
          </div>
        </header>
        {state.startupError && (
          <div className="error-box">{state.startupError}</div>
        )}
        <div
          className={
            "status-strip " + (!state.service.running ? "stopped" : "")
          }
        >
          <span className="status-dot" />
          <strong>
            {state.service.running ? "路由服务已就绪" : "路由服务已停止"}
          </strong>
          <span className="service-caption">
            {state.service.running
              ? "HTTP · 本机安全路由"
              : "当前请求无法经由 ASS 转发"}
          </span>
          <span className="mono endpoint">127.0.0.1:{state.service.port}</span>
          <Button
            icon={Settings2}
            onClick={() => setView("clients")}
          >
            管理客户端接入
          </Button>
        </div>
        {view !== "updates" && (
          <UpdateBanner
            updates={state.updates}
            act={act}
            onView={() => setView("updates")}
          />
        )}
        {view === "overview" ? (
          <Overview {...{ state, providers, act, busy, setView }} />
        ) : view === "providers" ? (
          <Providers
            {...{ state, providers, act, busy }}
            initialProvider={providerTarget}
          />
        ) : view === "accounts" ? (
          <OfficialAccounts
            {...{ state, act, busy }}
            openClient={(id) => {
              setClientTarget(id);
              setView("clients");
            }}
            openProvider={(id) => {
              setProviderTarget(id);
              setView("providers");
            }}
          />
        ) : view === "clients" ? (
          <Clients {...{ state, act, busy }} onManage={setConnectionRequest} initialClient={clientTarget} />
        ) : view === "updates" ? (
          <Updates {...{ state, act, busy }} />
        ) : (
          <Diagnostics {...{ state, providers, act, busy }} />
        )}
      </main>
      {connectionRequest && <ConnectionDialog request={connectionRequest}
        onClose={() => setConnectionRequest(null)} onComplete={(message) => {
          setToast({ message });
          api.call("snapshot").then(setState).catch(() => {});
        }} />}
      {toast && (
        <div role="status" className={"toast " + (toast.error ? "error" : "")}>
          {toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="关闭通知">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
