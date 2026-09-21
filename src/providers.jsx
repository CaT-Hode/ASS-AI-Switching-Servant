import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  Search,
  ChevronRight,
  Settings2,
  Wallet,
  Trash2,
  ScanSearch,
  Check,
  Layers,
  UserRound,
  RefreshCw,
} from "lucide-react";
import { Modal, ModelEditor, ProviderEditor } from "./editors.jsx";
import { ActionMenu } from "./menus.jsx";
import {
  modelKey,
  ModelCheckButton,
  ModelCapabilityDialog,
  ProviderModelCatalog,
} from "./model-inspection.jsx";
import "./providers.css";
const api = window.ass;
const protocols = {
  "openai-responses": "Responses",
  "openai-chat": "Chat Completions",
  anthropic: "Anthropic Messages",
};
const number = (value) =>
  value != null && value !== "" && Number.isFinite(Number(value))
    ? Number(value).toLocaleString("zh-CN")
    : "未知";
function balanceText(balance) {
  if (!balance) return "余额待查询";
  if (!balance.ok) return balance.message || "余额查询失败";
  return (balance.rows || [balance])
    .map((r) => `${r.label || ""} ${number(r.value)} ${r.unit || ""}`)
    .join(" · ");
}
function capabilityText(state, p, m) {
  const d =
    state.providerModels?.[p.id]?.models.find((item) => item.model === m.model)
      ?.declared || m.declared;
  const report = state.capabilities?.[modelKey(p.id, m.model)];
  if (report) return "已有能力实测";
  const parts = [];
  if (d?.tools != null)
    parts.push("工具" + (d.tools ? "声明支持" : "声明不支持"));
  if (d?.vision != null)
    parts.push("视觉" + (d.vision ? "声明支持" : "声明不支持"));
  return parts.join(" · ") || "工具 / 视觉未检测";
}
function ProviderActions({ p, act, busy, onSelect, onEdit }) {
  return (
    <ActionMenu
      label={p.name + " 更多操作"}
      disabled={!!busy}
      items={[
        onSelect && { label: "查看模型", icon: Layers, action: onSelect },
        !p.readOnly &&
          p.id !== "official" && {
            label: "编辑供应商",
            icon: Settings2,
            action: onEdit,
          },
        !p.readOnly &&
          p.id !== "official" && {
            label: "查询余额",
            icon: Wallet,
            action: () =>
              act("balance-" + p.id, () => api.call("balance", p.id)),
          },
        !p.readOnly &&
          p.id !== "official" && {
            label: p.enabled === false ? "启用供应商" : "停用供应商",
            action: () =>
              act("provider-enable", () =>
                api.call("save-provider", {
                  ...p,
                  enabled: p.enabled === false,
                }),
              ),
          },
        !p.readOnly &&
          p.id !== "official" && {
            label: "移除供应商",
            icon: Trash2,
            danger: true,
            action: () =>
              act("delete-provider", () => api.call("delete-provider", p.id)),
          },
      ]}
    />
  );
}
function SourceCard({
  p,
  state,
  act,
  busy,
  onSelect,
  onEdit,
  buttonRef,
  draftCount,
}) {
  const readonly = p.readOnly,
    official = p.id === "official";
  return (
    <article className="supplier-card" aria-label={p.name + " 供应商"}>
      <button
        ref={buttonRef}
        type="button"
        className="supplier-open"
        aria-label={"查看 " + p.name + " 的模型"}
        onClick={onSelect}
      />
      <header>
        <span className="supplier-symbol">
          {p.kind === "native" || official ? (
            <UserRound size={23} />
          ) : (
            p.name.slice(0, 1).toUpperCase()
          )}
        </span>
        <div className="supplier-title">
          <h2>{p.name}</h2>
          <span title={p.baseUrl || p.catalogSource}>
            {p.baseUrl
              ? new URL(p.baseUrl).host
              : p.catalogSource || "原生客户端目录"}
          </span>
        </div>
        <span className="tag">
          {official
            ? "订阅 OAuth"
            : readonly
              ? "原生目录"
              : state.officialProviderIds[p.id]
                ? "官方 API"
                : "自定义 API"}
        </span>
        <ProviderActions {...{ p, act, busy, onSelect, onEdit }} />
      </header>
      <div className="supplier-meta">
        <span>{p.models.length} 个模型</span>
        <span
          className={
            p.enabled === false || (readonly && !p.models.length)
              ? "muted"
              : "success"
          }
        >
          {p.enabled === false
            ? "已停用"
            : readonly
              ? p.models.length
                ? "本机已读取"
                : "未读取到模型"
              : "已启用"}
        </span>
        <span>
          {readonly || official
            ? p.accountCount
              ? `${p.accountCount} 个已有账户`
              : "本机目录"
            : balanceText(state.balances[p.id])}
        </span>
      </div>
      <div className="supplier-summary">
        <span>
          {[
            ...new Set(
              p.models.map(
                (m) => protocols[m.wireApi] || m.wireApi || "原生协议",
              ),
            ),
          ].join(" · ") || "协议待配置"}
        </span>
        <span>
          最大上下文{" "}
          {number(
            p.models.length
              ? Math.max(...p.models.map((m) => m.contextWindow || 0)) || null
              : null,
          )}
        </span>
      </div>
      <div className="supplier-model-tags">
        {p.models.slice(0, 3).map((m) => (
          <span key={m.model} title={m.model}>
            {m.displayName || m.model}
          </span>
        ))}
        {p.models.length > 3 && <span>+{p.models.length - 3}</span>}
        {!p.models.length && (
          <p className="supplier-empty">
            {readonly ? "尚未读取到模型目录" : "尚未配置模型"}
          </p>
        )}
      </div>
      <footer>
        <span className="supplier-link">
          管理模型 <ChevronRight size={14} />
        </span>
        <span>
          {draftCount
            ? `${draftCount} 项未保存`
            : readonly
              ? "只读"
              : official
                ? "Responses"
                : p.network === "direct"
                  ? "直接连接"
                  : "系统代理 / CA"}
        </span>
      </footer>
    </article>
  );
}
function InlineModel({
  p,
  model,
  draft,
  change,
  discard,
  state,
  act,
  busy,
  onAdvanced,
  onInspect,
}) {
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const value = draft?.value || model,
    dirty = !!draft,
    disabled = saving || !!busy;
  const update = (key, next) => {
    setError("");
    setMessage("");
    change(key, next);
  };
  async function save(e) {
    e.preventDefault();
    if (!dirty || disabled) return;
    setSaving(true);
    setError("");
    try {
      await api.call(
        "save-model",
        p.id,
        {
          ...value,
          contextSource:
            value.contextWindow !== model.contextWindow
              ? "手动配置"
              : value.contextSource,
        },
        model.model,
        draft.original,
      );
      discard();
      setMessage("已保存");
    } catch (e) {
      setError(
        e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
      );
    } finally {
      setSaving(false);
    }
  }
  const diagnostic = state.diagnostics[modelKey(p.id, model.model)];
  return (
    <form
      className={"inline-model" + (dirty ? " dirty" : "")}
      aria-label={model.model + " 行内配置"}
      onSubmit={save}
    >
      <div className="inline-model-fields">
        <label>
          模型 ID
          <input
            aria-label={model.model + " 模型 ID"}
            required
            maxLength={250}
            value={value.model}
            onChange={(e) => update("model", e.target.value)}
            disabled={disabled}
          />
        </label>
        <label>
          显示名称
          <input
            aria-label={model.model + " 显示名称"}
            required
            maxLength={250}
            value={value.displayName}
            onChange={(e) => update("displayName", e.target.value)}
            disabled={disabled}
          />
        </label>
        <label>
          接口类型
          <select
            aria-label={model.model + " 接口类型"}
            title={
              p.id === "official" ? "官方订阅接口固定为 Responses" : undefined
            }
            value={value.wireApi}
            onChange={(e) => update("wireApi", e.target.value)}
            disabled={disabled}
          >
            {Object.entries(protocols)
              .filter(
                ([id]) => p.id !== "official" || id === "openai-responses",
              )
              .map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label>
          上下文长度
          <input
            aria-label={model.model + " 上下文长度"}
            type="number"
            min={4096}
            max={10000000}
            step={1}
            required
            value={value.contextWindow}
            onChange={(e) =>
              update(
                "contextWindow",
                e.target.value === "" ? "" : Number(e.target.value),
              )
            }
            disabled={disabled}
          />
        </label>
        <label>
          默认思维强度
          <select
            aria-label={model.model + " 默认思维强度"}
            value={value.defaultEffort}
            onChange={(e) => update("defaultEffort", e.target.value)}
            disabled={disabled}
          >
            {value.efforts.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      </div>
      <footer>
        <div className="inline-model-meta">
          <label className="check-field small">
            <input
              type="checkbox"
              aria-label={model.model + " 启用"}
              checked={value.enabled !== false}
              onChange={(e) => update("enabled", e.target.checked)}
              disabled={disabled}
            />
            启用
          </label>
          <span>{value.efforts.join(" · ")}</span>
          <span
            className={
              diagnostic ? (diagnostic.ok ? "success" : "danger") : "muted"
            }
          >
            {diagnostic
              ? `${diagnostic.ok ? "连接通过" : "连接失败"} · ${Math.round(diagnostic.ms)} ms`
              : capabilityText(state, p, model)}
          </span>
        </div>
        <div className="actions">
          {dirty ? (
            <>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  discard();
                  setError("");
                }}
                disabled={disabled}
              >
                取消
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={disabled}
              >
                <Check size={14} />
                {saving ? "保存中…" : "保存"}
              </button>
            </>
          ) : (
            <>
              <ModelCheckButton provider={p} {...{ model, state, act, busy }} />
              <ActionMenu
                label={model.model + " 模型操作"}
                text="模型操作"
                items={[
                  { label: "详细设置", icon: Settings2, action: onAdvanced },
                  { label: "能力详情", icon: ScanSearch, action: onInspect },
                  {
                    label: "删除模型",
                    icon: Trash2,
                    danger: true,
                    action: () =>
                      act("delete-model", () =>
                        api.call("delete-model", p.id, model.model, model),
                      ),
                  },
                ]}
                disabled={disabled}
              />
            </>
          )}
        </div>
      </footer>
      {error && (
        <p className="inline-model-error" role="alert">
          {error}
        </p>
      )}
      {message && !dirty && (
        <span className="inline-model-saved" role="status">
          {message}
        </span>
      )}
    </form>
  );
}
export function Providers({
  state,
  providers,
  act,
  busy,
  activeProvider,
  onOpenProvider,
  onBack,
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [modelSearch, setModelSearch] = useState(""),
    [editor, setEditor] = useState(null),
    [providerEditor, setProviderEditor] = useState(null),
    [inspection, setInspection] = useState(null),
    [directory, setDirectory] = useState(null),
    [drafts, setDrafts] = useState({});
  const gallerySearch = useRef(null),
    cardButtons = useRef(new Map());
  const all = state.modelSources || providers;
  const matches = all.filter(
    (p) =>
      (filter === "all" ||
        (filter === "native"
          ? p.readOnly || p.id === "official"
          : !p.readOnly && p.id !== "official")) &&
      `${p.name} ${p.models.map((m) => m.model + " " + m.displayName).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const p = all.find((p) => p.id === activeProvider);
  const sideOpen = !!(editor || inspection || directory || providerEditor);
  const revision = state.modelDirectoryRevisions?.[p?.id] || 0;
  useEffect(() => {
    if (p && (p.readOnly || p.hasKey || p.id === "official"))
      api.call("models-discover", p.id).catch(() => {});
  }, [p?.id, p?.hasKey, p?.readOnly, revision]);
  const boundClients =
    p && !p.readOnly
      ? state.harnesses.clients.filter((c) =>
          c.accounts.some((a) => a.providerId === p.id),
        )
      : [];
  const directoryProvider = all.find((p) => p.id === directory);
  function select(p) {
    onOpenProvider(p.id);
    setModelSearch("");
  }
  function editDraft(m, key, value) {
    const id = modelKey(p.id, m.model);
    setDrafts((old) => ({
      ...old,
      [id]: {
        original: old[id]?.original || m,
        value: { ...(old[id]?.value || m), [key]: value },
      },
    }));
  }
  function discard(m) {
    const id = modelKey(p.id, m.model);
    setDrafts((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
  }
  return (
    <>
      <section className="provider-gallery" aria-label="供应商卡片">
        <div className="inventory-toolbar">
          <label className="search">
            <Search size={16} />
            <input
              ref={gallerySearch}
              aria-label="搜索供应商或模型"
              placeholder="搜索供应商或模型"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="来源筛选"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">全部来源</option>
            <option value="api">API 供应商</option>
            <option value="native">订阅 / 原生目录</option>
          </select>
          <span>
            {all.reduce((n, p) => n + p.models.length, 0)} 个模型 · {all.length}{" "}
            个来源
          </span>
          <button
            className="button primary"
            onClick={() => setProviderEditor({})}
          >
            <Plus size={15} />
            添加供应商
          </button>
        </div>
        <div className="supplier-grid">
          {matches.map((source) => (
            <SourceCard
              key={source.id}
              p={source}
              {...{ state, act, busy }}
              onSelect={() => select(source)}
              buttonRef={(button) => {
                if (button) cardButtons.current.set(source.id, button);
                else cardButtons.current.delete(source.id);
              }}
              draftCount={
                source.models.filter(
                  (m) => drafts[modelKey(source.id, m.model)],
                ).length
              }
              onEdit={() => setProviderEditor({ provider: source })}
            />
          ))}
        </div>
        {!matches.length && (
          <div className="empty">
            <Layers size={25} />
            <p>{all.length ? "没有匹配的供应商或模型" : "还没有模型来源"}</p>
            <button className="button" onClick={() => setProviderEditor({})}>
              添加供应商
            </button>
          </div>
        )}
      </section>
      {p && (
        <Modal
          title={p.name + " · 模型"}
          description={p.baseUrl || p.catalogSource || "原生客户端目录"}
          className={"provider-model-dialog" + (sideOpen ? " side-open" : "")}
          onClose={onBack}
          fallbackFocus={() =>
            cardButtons.current.get(p.id) || gallerySearch.current
          }
        >
          <div className="provider-dialog-toolbar">
            <span className="tag">
              {p.readOnly
                ? "只读目录"
                : p.enabled === false
                  ? "已停用"
                  : "已启用"}
            </span>
            {!p.readOnly && p.id !== "official" && (
              <>
                <button
                  className="button"
                  onClick={() => setProviderEditor({ provider: p })}
                  disabled={!!busy}
                >
                  <Settings2 size={15} />
                  供应商设置
                </button>
                <ProviderActions
                  {...{ p, act, busy }}
                  onEdit={() => setProviderEditor({ provider: p })}
                />
              </>
            )}
          </div>
          <section
            className="configured-models"
            aria-label={p.name + " 模型配置"}
          >
            <div className="section-heading">
              <div>
                <h2>
                  {p.readOnly ? "原生客户端模型" : "已配置模型"}
                  <span className="count">{p.models.length}</span>
                </h2>
                {p.readOnly && (
                  <p className="catalog-caption">{p.catalogSource}</p>
                )}
              </div>
              <div className="actions">
                <label className="search">
                  <Search size={15} />
                  <input
                    aria-label="搜索已配置模型"
                    placeholder="搜索模型"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                  />
                </label>
                {p.readOnly && (
                  <button
                    className="button"
                    disabled={!!state.modelDirectoryJobs[p.id]}
                    onClick={() =>
                      act("native-catalog", () =>
                        api.call("models-discover", p.id, true),
                      )
                    }
                  >
                    <RefreshCw
                      size={14}
                      className={
                        state.modelDirectoryJobs[p.id] ? "spin" : undefined
                      }
                    />
                    刷新目录
                  </button>
                )}
                {!p.readOnly && (
                  <>
                    <button
                      className="button"
                      onClick={() => setDirectory(p.id)}
                    >
                      <Search size={14} />
                      发现模型
                    </button>
                    {p.id !== "official" && (
                      <button
                        className="button primary"
                        onClick={() => setEditor({ provider: p, model: null })}
                      >
                        <Plus size={14} />
                        手动添加
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            {!!boundClients.length && (
              <div className="client-model-selections">
                {boundClients.map((c) => {
                  const a = c.accounts.find((a) => a.providerId === p.id),
                    saved = c.modelSelections[a.id],
                    chosen = a.models.some((m) => m.model === saved)
                      ? saved
                      : a.models[0]?.model || "";
                  return (
                    <label key={c.id}>
                      {c.name} 启动模型
                      <select
                        aria-label={c.name + " 启动模型"}
                        value={chosen}
                        disabled={!!busy || !a.models.length}
                        onChange={(e) =>
                          act("client-model", () =>
                            api.call(
                              "client-model",
                              c.id,
                              a.id,
                              e.target.value,
                            ),
                          )
                        }
                      >
                        {!a.models.length && (
                          <option value="">没有兼容模型</option>
                        )}
                        {a.models.map((m) => (
                          <option key={m.model} value={m.model}>
                            {m.name || m.model}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            )}
            {!p.readOnly && (
              <p className="catalog-caption catalog-state" role="status">
                {state.modelDirectoryJobs[p.id]
                  ? "正在读取供应商模型目录…"
                  : state.providerModels[p.id]?.error
                    ? "模型目录读取失败，可在“发现模型”中重试。"
                    : state.providerModels[p.id]
                      ? `已读取 ${state.providerModels[p.id].models.length} 个可用模型，可在“发现模型”中添加。`
                      : p.hasKey || p.id === "official"
                        ? "尚未读取目录"
                        : "填写 API Key 后自动读取模型目录"}
              </p>
            )}
            {p.readOnly &&
              (p.catalogError || state.modelDirectoryJobs[p.id]) && (
                <p className="catalog-caption" role="status">
                  {state.modelDirectoryJobs[p.id]
                    ? "正在读取原生账户模型目录…"
                    : p.catalogError}
                </p>
              )}
            {!p.models.length && (
              <p className="supplier-empty">
                {p.readOnly
                  ? "没有可读取的本机目录，请在原生客户端查看可用模型。"
                  : "从“发现模型”中添加，或手动配置模型。"}
              </p>
            )}
            {!!p.models.length &&
              !p.models.some((m) =>
                `${m.model} ${m.displayName}`
                  .toLowerCase()
                  .includes(modelSearch.toLowerCase()),
              ) && <p className="supplier-empty">没有匹配的模型</p>}
            {p.models
              .filter((m) =>
                `${m.model} ${m.displayName}`
                  .toLowerCase()
                  .includes(modelSearch.toLowerCase()),
              )
              .map((m) =>
                p.readOnly ? (
                  <div
                    className="native-model-row"
                    key={(m.nativeProvider || "") + "::" + m.model}
                  >
                    <div>
                      <strong>{m.displayName || m.model}</strong>
                      <small>
                        {m.nativeProvider ? m.nativeProvider + " / " : ""}
                        {m.model}
                      </small>
                    </div>
                    <span>
                      {protocols[m.wireApi] || m.wireApi || "原生协议"}
                    </span>
                    <span>上下文 {number(m.contextWindow)}</span>
                    <span>{m.efforts?.join(" · ") || "思维档位未声明"}</span>
                  </div>
                ) : (
                  <InlineModel
                    key={modelKey(p.id, m.model)}
                    p={p}
                    model={m}
                    draft={drafts[modelKey(p.id, m.model)]}
                    change={(k, v) => editDraft(m, k, v)}
                    discard={() => discard(m)}
                    {...{ state, act, busy }}
                    onAdvanced={() => setEditor({ provider: p, model: m })}
                    onInspect={() => setInspection({ provider: p, model: m })}
                  />
                ),
              )}
          </section>
        </Modal>
      )}
      {directoryProvider && (
        <Modal
          title={directoryProvider.name + " · 发现模型"}
          className="provider-side-dialog"
          onClose={() => setDirectory(null)}
        >
          <ProviderModelCatalog
            key={directoryProvider.id}
            provider={directoryProvider}
            {...{ state, act, busy }}
          />
        </Modal>
      )}
      {editor && (
        <ModelEditor
          {...editor}
          className="provider-side-dialog"
          onClose={() => setEditor(null)}
          onSave={(m) =>
            api.call(
              "save-model",
              editor.provider.id,
              m,
              editor.model?.model,
              editor.model || undefined,
            )
          }
        />
      )}
      {inspection && (
        <ModelCapabilityDialog
          {...inspection}
          {...{ state, act, busy }}
          className="provider-side-dialog"
          onClose={() => setInspection(null)}
        />
      )}
      {providerEditor && (
        <ProviderEditor
          presets={state.providerPresets}
          balancePresets={state.balancePresets}
          provider={providerEditor.provider}
          className={p ? "provider-side-dialog" : undefined}
          onClose={() => setProviderEditor(null)}
          onSave={(m) => api.call("save-provider", m)}
        />
      )}
    </>
  );
}
