const crypto = require("node:crypto");
const { endpoint, EFFORTS, PROTOCOLS } = require("./models.cjs");
const { convertRequest, sseMessages } = require("./adapters.cjs");
const modelKey = (provider, model) => JSON.stringify([provider, model]);
const strings = (value) =>
  Array.isArray(value)
    ? value.filter((x) => typeof x === "string" && x.length < 100).slice(0, 30)
    : [];
const positive = (...values) =>
  values.find((v) => Number.isSafeInteger(v) && v > 0) ?? null;
function declaredCapabilities(raw) {
  const parameters = strings(raw.supported_parameters);
  const levels = raw.supported_reasoning_levels || raw.reasoning_efforts;
  const efforts = (Array.isArray(levels) ? levels : [])
    .map((v) => (typeof v === "string" ? v : v?.effort))
    .filter((v) => EFFORTS.includes(v));
  const input = strings(
    raw.input_modalities || raw.architecture?.input_modalities,
  );
  return {
    contextWindow: positive(
      raw.context_length,
      raw.context_window,
      raw.contextWindow,
      raw.limits?.context,
    ),
    maxOutputTokens: positive(
      raw.max_output_tokens,
      raw.max_output_length,
      raw.top_provider?.max_completion_tokens,
      raw.limits?.output,
    ),
    efforts,
    inputModalities: input,
    outputModalities: strings(
      raw.output_modalities || raw.architecture?.output_modalities,
    ),
    tools:
      typeof raw.supports_tools === "boolean"
        ? raw.supports_tools
        : parameters.includes("tools")
          ? true
          : null,
    reasoning:
      typeof raw.supports_reasoning === "boolean"
        ? raw.supports_reasoning
        : efforts.length || parameters.some((v) => /reasoning/.test(v))
          ? true
          : null,
    vision: input.length ? input.includes("image") : null,
    supportedParameters: parameters,
  };
}
function headersFor(provider, protocol) {
  return {
    ...provider.extraHeaders,
    ...(protocol === "anthropic"
      ? { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" }
      : { authorization: "Bearer " + provider.apiKey }),
  };
}
async function limitedText(response, limit = 2 * 1024 * 1024) {
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks).toString("utf8");
      size += value.length;
      if (size > limit) throw Error("接口响应超过检测大小限制");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function discoverModels(provider, fetchUpstream, signal) {
  if (!provider.apiKey) throw Error("请先填写供应商 API Key");
  const url = endpoint(provider.baseUrl, "openai-responses").replace(
    /\/responses$/,
    "/models",
  );
  const response = await fetchUpstream(
    url,
    {
      method: "GET",
      headers: headersFor(provider, provider.wireApi),
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(20000),
      ]),
    },
    provider.network,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      "模型目录接口返回 HTTP " +
        response.status +
        "；该供应商可能未开放 /models",
    );
  }
  let body;
  try {
    body = JSON.parse(await limitedText(response));
  } catch {
    throw Error("模型目录未返回有效且大小受限的 JSON");
  }
  const list = Array.isArray(body) ? body : body.data || body.models;
  if (!Array.isArray(list)) throw Error("模型目录格式无法识别");
  const seen = new Set();
  const models = list.slice(0, 2000).flatMap((raw) => {
    if (typeof raw === "string") raw = { id: raw };
    const id = raw?.id || raw?.model;
    if (typeof id !== "string" || !id || id.length > 250 || seen.has(id))
      return [];
    seen.add(id);
    return [
      {
        model: id,
        displayName: typeof raw.name === "string" ? raw.name.slice(0, 120) : id,
        declared: declaredCapabilities(raw),
      },
    ];
  });
  return {
    time: new Date().toISOString(),
    source: "供应商 /models 声明（未实测）",
    models,
    truncated: list.length > 2000 || !!body.has_more,
  };
}
async function inspectStream(stream, protocol, nonce) {
  let terminal = false,
    incomplete = false,
    text = false,
    reasoningObserved = false,
    tokens = 0,
    bytes = 0;
  const calls = new Map();
  const addResponse = (r) => {
    tokens = Math.max(
      tokens,
      r?.usage?.output_tokens_details?.reasoning_tokens || 0,
    );
    for (const item of r?.output || []) {
      if (
        item.type === "message" &&
        item.content?.some((v) => v.type === "output_text" && v.text)
      )
        text = true;
      if (item.type === "reasoning") reasoningObserved = true;
      if (item.type === "function_call")
        calls.set(item.id || item.call_id, {
          name: item.name,
          args: item.arguments,
        });
    }
  };
  for await (const event of sseMessages(stream)) {
    bytes += JSON.stringify(event).length;
    if (bytes > 2 * 1024 * 1024) throw Error("检测响应过大");
    if (event.error || ["error", "response.failed"].includes(event.type))
      throw Error("上游错误事件");
    if (protocol === "openai-responses") {
      if (event.type === "response.output_text.delta" && event.delta)
        text = true;
      if (/reasoning.*delta/.test(event.type)) reasoningObserved = true;
      if (["response.completed", "response.incomplete"].includes(event.type)) {
        terminal = true;
        incomplete = event.type === "response.incomplete";
        addResponse(event.response);
      }
      if (event.type === "response.output_item.done")
        addResponse({ output: [event.item] });
    } else if (protocol === "anthropic") {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block?.type === "tool_use")
          calls.set(event.index, {
            name: block.name,
            args: Object.keys(block.input || {}).length
              ? JSON.stringify(block.input)
              : "",
          });
        if (block?.type === "text" && block.text) text = true;
      }
      if (event.delta?.type === "input_json_delta" && calls.has(event.index))
        calls.get(event.index).args += event.delta.partial_json || "";
      if (event.delta?.type === "text_delta" && event.delta.text) text = true;
      if (event.delta?.type === "thinking_delta") reasoningObserved = true;
      if (event.type === "message_delta")
        incomplete = event.delta?.stop_reason === "max_tokens";
      if (event.type === "message_stop") terminal = true;
    } else {
      const c = event.choices?.[0],
        d = c?.delta;
      if (d?.content) text = true;
      if (d?.reasoning_content || d?.reasoning) reasoningObserved = true;
      tokens = Math.max(
        tokens,
        event.usage?.completion_tokens_details?.reasoning_tokens || 0,
      );
      for (const tool of d?.tool_calls || []) {
        const item = calls.get(tool.index) || { name: "", args: "" };
        if (tool.function?.name) item.name = tool.function.name;
        item.args += tool.function?.arguments || "";
        calls.set(tool.index, item);
      }
      if (c?.finish_reason) {
        terminal = true;
        incomplete = c.finish_reason === "length";
      }
    }
  }
  const toolObserved = [...calls.values()].some((c) => {
    try {
      return c.name === "ass_probe_echo" && JSON.parse(c.args).marker === nonce;
    } catch {
      return false;
    }
  });
  return {
    completed: terminal && !incomplete,
    text,
    toolObserved,
    reasoningObserved: reasoningObserved || tokens > 0,
    reasoningTokens: tokens,
    incomplete,
  };
}
async function nativeProbe(
  provider,
  model,
  protocol,
  fetchUpstream,
  { effort, tool = false, signal } = {},
) {
  const nonce = crypto.randomBytes(8).toString("hex"),
    started = Date.now();
  const body = {
    model: model.model,
    stream: true,
    store: false,
    max_output_tokens: 512,
    instructions:
      "This is a capability check. Reply briefly. Do not perform any external actions.",
    input: tool
      ? `Call ass_probe_echo once with marker ${nonce}.`
      : "What is 19 times 23? Reply only with the result.",
    ...(effort ? { reasoning: { effort } } : {}),
    ...(tool
      ? {
          tools: [
            {
              type: "function",
              name: "ass_probe_echo",
              description:
                "Return the supplied marker. This tool is never executed.",
              parameters: {
                type: "object",
                properties: { marker: { type: "string" } },
                required: ["marker"],
                additionalProperties: false,
              },
            },
          ],
          tool_choice: { type: "function", name: "ass_probe_echo" },
        }
      : {}),
  };
  try {
    const request =
      protocol === "openai-responses"
        ? body
        : convertRequest(body, model, protocol);
    const response = await fetchUpstream(
      endpoint(provider.baseUrl, protocol),
      {
        method: "POST",
        headers: {
          ...headersFor(provider, protocol),
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(request),
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.any([
          ...(signal ? [signal] : []),
          AbortSignal.timeout(20000),
        ]),
      },
      provider.network,
    );
    if (!response.ok) {
      const raw = await limitedText(response, 128 * 1024).catch(() => "");
      return {
        status: "rejected",
        httpStatus: response.status,
        effortError:
          [400, 422].includes(response.status) &&
          /reasoning|effort|output_config/i.test(raw),
        message: "HTTP " + response.status,
        ms: Date.now() - started,
      };
    }
    const observed = await inspectStream(response.body, protocol, nonce);
    return {
      ...observed,
      status:
        observed.completed && (observed.text || observed.toolObserved)
          ? "passed"
          : "unknown",
      httpStatus: response.status,
      ms: Date.now() - started,
    };
  } catch {
    return {
      status: "unknown",
      message: signal?.aborted
        ? "检测已取消"
        : "超时、网络失败或不完整流；不能据此判定能力",
      ms: Date.now() - started,
    };
  }
}
async function probeCapabilities(
  provider,
  model,
  fetchUpstream,
  { signal, progress = () => {} } = {},
) {
  const report = {
    time: new Date().toISOString(),
    providerId: provider.id,
    model: model.model,
    protocols: {},
    efforts: {},
    tools: { status: "unknown" },
    requestCount: 0,
  };
  const run = async (protocol, options, message) => {
    signal?.throwIfAborted();
    progress(message);
    report.requestCount++;
    return nativeProbe(provider, model, protocol, fetchUpstream, {
      ...options,
      signal,
    });
  };
  try {
    let working;
    for (const protocol of [
      model.wireApi,
      ...PROTOCOLS.filter((p) => p !== model.wireApi),
    ]) {
      const result = await run(protocol, {}, "验证 " + protocol);
      report.protocols[protocol] = result;
      if (result.status === "passed") {
        working = protocol;
        break;
      }
      if (![400, 404, 405, 415, 422].includes(result.httpStatus)) break;
    }
    if (!working) return report;
    const tool = await run(working, { tool: true }, "验证工具调用");
    report.tools = {
      ...tool,
      status: tool.toolObserved && tool.completed ? "observed" : "unknown",
    };
    if (
      !tool.httpStatus ||
      tool.httpStatus >= 500 ||
      [401, 403, 429].includes(tool.httpStatus)
    )
      return report;
    const control = await run(
      working,
      { effort: "ass_invalid_effort" },
      "验证思维参数的非法值对照",
    );
    report.invalidEffortControl = {
      status: control.status,
      httpStatus: control.httpStatus,
      rejectedByValidator: control.effortError === true,
    };
    if (
      !control.httpStatus ||
      control.httpStatus >= 500 ||
      [401, 403, 429].includes(control.httpStatus)
    )
      return report;
    for (const effort of model.efforts) {
      const result = await run(working, { effort }, "验证思维强度 " + effort);
      report.efforts[effort] = {
        ...result,
        status:
          result.status === "passed"
            ? control.effortError
              ? "validated"
              : "accepted-unverified"
            : result.effortError
              ? "rejected"
              : "unknown",
      };
      if (
        !result.httpStatus ||
        result.httpStatus >= 500 ||
        [401, 403, 429].includes(result.httpStatus)
      )
        break;
    }
    return report;
  } catch {
    report.cancelled = true;
    return report;
  }
}
module.exports = {
  modelKey,
  declaredCapabilities,
  discoverModels,
  inspectStream,
  nativeProbe,
  probeCapabilities,
};
