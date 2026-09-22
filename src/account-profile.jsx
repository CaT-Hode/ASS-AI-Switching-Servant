import React from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
const api = window.ass;
const plans = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  max: "Max",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
  pro5x: "Pro 5×",
  pro20x: "Pro 20×",
};
function valueOf(field) {
  if (field.kind === "date")
    return new Date(field.value).toLocaleString("zh-CN", { hour12: false });
  return field.value + (field.unit ? " " + field.unit : "");
}
function Facts({ fields }) {
  return (
    <dl className="account-profile-facts">
      {fields.map((f) => (
        <div key={f.id}>
          <dt>{f.label}</dt>
          <dd
            title={valueOf(f)}
            className={f.kind === "amount" ? "profile-amount" : undefined}
          >
            {valueOf(f)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function AccountProfile({ account, client, state, act, busy }) {
  const p = account.profile;
  if (!p) return null;
  const get = (id) => p.fields.find((f) => f.id === id)?.value;
  const email = get("email"),
    name = get("name") || get("keyLabel"),
    plan = get("plan");
  const priority = (f) =>
    f.id === "remaining" || f.id.startsWith("balance-")
      ? 0
      : ["limit", "usageDaily", "usageMonthly", "available"].includes(f.id)
        ? 1
        : f.kind === "amount"
          ? 2
          : 3;
  const facts = p.fields
    .filter(
      (f) =>
        f.kind !== "quota" &&
        !["email", "name", "keyLabel", "plan", "scopes"].includes(f.id),
    )
    .sort((a, b) => priority(a) - priority(b));
  const scopes = p.fields.filter((f) => f.id === "scopes");
  const more = [...facts.slice(6), ...scopes];
  return (
    <section className="account-profile" aria-label="账户资料">
      {(email || name || plan) && (
        <div className="account-identity">
          <div>
            {email && <strong title={email}>{email}</strong>}
            {name && <span title={name}>{name}</span>}
          </div>
          {plan && (
            <span
              className="account-plan"
              title="账户套餐"
            >
              {plans[plan.toLowerCase()] || plan}
            </span>
          )}
        </div>
      )}
      <Facts fields={facts.slice(0, 6)} />
      {p.fields.some((f) => f.kind === "quota") && (
        <div className="account-quotas">
          {p.fields
            .filter((f) => f.kind === "quota")
            .map((f) => (
              <div
                className={
                  "account-quota" +
                  (f.status === "rate-limited" ? " limited" : "")
                }
                key={f.id}
              >
                <div>
                  <strong>{f.label}</strong>
                  <span>剩余 {Number(f.remainingPercent.toFixed(1))}%</span>
                </div>
                <progress
                  aria-label={f.label + " 已用比例"}
                  value={Math.min(100, f.usedPercent)}
                  max={100}
                />
                <small>
                  已用 {Number(f.usedPercent.toFixed(1))}%
                  {f.status === "rate-limited" ? " · 已达上限" : ""}
                  {f.resetsAt && (
                    <>
                      {" "}
                      ·{" "}
                      {new Date(f.resetsAt).toLocaleString("zh-CN", {
                        hour12: false,
                      })}{" "}
                      重置
                    </>
                  )}
                </small>
              </div>
            ))}
        </div>
      )}
      {more.length > 0 && (
        <details className="account-profile-more">
          <summary>更多资料</summary>
          <Facts fields={more} />
        </details>
      )}
      <div className="account-profile-source">
        <details>
          <summary>
            资料来源
            {p.stale ? " · 已过时" : ""}
          </summary>
          {p.updatedAt && (
            <time dateTime={p.updatedAt}>
              {p.remote || account.kind === "api"
                ? "上次成功查询"
                : "凭据文件更新"}
              ：
              {new Date(p.updatedAt).toLocaleString("zh-CN", { hour12: false })}
            </time>
          )}
          {p.credentialUpdatedAt && (
            <time dateTime={p.credentialUpdatedAt}>
              凭据文件更新：
              {new Date(p.credentialUpdatedAt).toLocaleString("zh-CN", {
                hour12: false,
              })}
            </time>
          )}
          {p.metadataUpdatedAt && (
            <time dateTime={p.metadataUpdatedAt}>
              身份缓存更新：
              {new Date(p.metadataUpdatedAt).toLocaleString("zh-CN", {
                hour12: false,
              })}
            </time>
          )}
          {p.note && <p>{p.note}</p>}
          <div className="account-profile-docs">
            {p.docs.map(
              (id) =>
                state.accountDocs?.[id] && (
                  <button
                    key={id}
                    className="text-button"
                    onClick={() =>
                      act("account-doc", () => api.call("account-info-doc", id))
                    }
                  >
                    {state.accountDocs[id].label}
                    <ExternalLink size={11} />
                  </button>
                ),
            )}
          </div>
        </details>
        {p.consoleService && (
          <button
            className="text-button"
            onClick={() =>
              act("official-open", () =>
                api.call("official-open", p.consoleService, "console"),
              )
            }
          >
            控制台
            <ExternalLink size={12} />
          </button>
        )}
        {p.canRefresh && (
          <button
            className="icon-button"
            title="刷新账户资料（不发送模型请求）"
            aria-label={account.label + " 刷新账户资料"}
            disabled={!!busy || p.refreshing}
            onClick={() =>
              act("account-info-" + account.id, () =>
                api.call("account-info", client.id, account.id),
              )
            }
          >
            <RefreshCw
              size={13}
              className={
                busy === "account-info-" + account.id ? "spin" : undefined
              }
            />
          </button>
        )}
      </div>
      {p.error && (
        <p className="account-profile-error" role="alert">
          {p.error}
          {p.updatedAt ? "；保留上次成功资料" : ""}
        </p>
      )}
    </section>
  );
}
