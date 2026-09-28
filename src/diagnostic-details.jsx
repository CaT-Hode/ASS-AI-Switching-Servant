import React from "react";
const timing = (ms) => Number.isFinite(ms) ? ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s` : "—";
const protocol = { "openai-responses": "Responses", "openai-chat": "Chat Completions", anthropic: "Messages" };
export function DiagnosticDetails({ result: r }) {
  return <div className="diagnostic-details">
    {r.stale && <small className="diagnostic-stale">配置已变化或目录待恢复 · 保留上次结果</small>}
    {r.supplierSaveFailed && <small className="diagnostic-stale">供应商保存失败，可检查磁盘后重新检测。</small>}
    <dl className="diagnostic-measurements">
      <div title="发出检测请求至收到 HTTP 响应头；包含路由处理和上游等待"><dt>响应头</dt><dd>{timing(r.headersMs)}</dd></div>
      <div title="发出请求至第一个正文文本事件；不将握手、思考事件视为正文"><dt>首字延迟</dt><dd>{timing(r.firstTextMs)}</dd></div>
      <div title="检测请求开始至完整响应结束或失败"><dt>总耗时</dt><dd>{timing(r.ms)}</dd></div>
      <div><dt>HTTP</dt><dd>{r.httpStatus || "—"}</dd></div>
    </dl>
    <details className="diagnostic-extra"><summary>测试详情</summary>
      <dl className="diagnostic-measurements">
        <div><dt>上游协议</dt><dd>{protocol[r.protocol] || "—"}</dd></div>
        <div><dt>路径</dt><dd>{r.route === "native" ? "原生直连" : r.route === "router" ? "ASS 路由" : "—"}</dd></div>
        <div><dt>首事件</dt><dd>{timing(r.firstEventMs)}</dd></div>
        <div><dt>流接收</dt><dd>{timing(r.streamMs)}</dd></div>
        <div><dt>事件数</dt><dd>{r.eventCount ?? "—"}</dd></div>
        <div title="解析后的 SSE 事件 UTF-8 大小，不包含 HTTP 或 SSE 帧头"><dt>事件数据</dt><dd>{Number.isFinite(r.responseBytes) ? `${(r.responseBytes / 1024).toFixed(1)} KiB` : "—"}</dd></div>
        <div><dt>输入 / 输出 token</dt><dd>{r.inputTokens ?? "—"} / {r.outputTokens ?? "—"}</dd></div>
        <div><dt>结束阶段</dt><dd>{{ connect: "建立连接", headers: "响应头", stream: "流接收", complete: "完整结束" }[r.phase] || "—"}</dd></div>
      </dl>
    </details>
  </div>;
}
