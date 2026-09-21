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
      (f) => !["email", "name", "keyLabel", "plan", "scopes"].includes(f.id),
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
              title="本地登录记录中的套餐，未联网核验"
            >
              {plans[plan.toLowerCase()] || plan}
            </span>
          )}
        </div>
      )}
      <Facts fields={facts.slice(0, 6)} />
      {more.length > 0 && (
        <details className="account-profile-more">
          <summary>更多资料</summary>
          <Facts fields={more} />
        </details>
      )}
      <div className="account-profile-source">
        <details>
          <summary>
            {p.source}
            {p.stale ? " · 已过时" : ""}
          </summary>
          {p.updatedAt && (
            <time dateTime={p.updatedAt}>
              {account.kind === "api" ? "上次成功查询" : "凭据文件更新"}：
              {new Date(p.updatedAt).toLocaleString("zh-CN", { hour12: false })}
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
          {account.kind !== "api" && (
            <p>本地声明不等于当前权益；令牌到期也不代表订阅到期。</p>
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
