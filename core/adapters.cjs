const crypto = require("node:crypto");
function textOf(content) {
  return typeof content === "string"
    ? content
    : (content || [])
        .filter((c) => ["input_text", "output_text", "text"].includes(c.type))
        .map((c) => c.text || "")
        .join("\n");
}
function inputMessages(body, kind) {
  const input =
    typeof body.input === "string"
      ? [{ role: "user", content: body.input }]
      : body.input || [];
  const messages = [];
  const system = [body.instructions || ""];
  for (const i of input) {
    if (i.type === "reasoning") continue;
    if (i.type === "function_call") {
      if (kind === "anthropic")
        messages.push({
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: i.call_id,
              name: i.name,
              input: JSON.parse(i.arguments || "{}"),
            },
          ],
        });
      else
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: i.call_id,
              type: "function",
              function: { name: i.name, arguments: i.arguments || "{}" },
            },
          ],
        });
    } else if (i.type === "function_call_output") {
      if (kind === "anthropic")
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: i.call_id,
              content:
                typeof i.output === "string"
                  ? i.output
                  : JSON.stringify(i.output),
            },
          ],
        });
      else
        messages.push({
          role: "tool",
          tool_call_id: i.call_id,
          content:
            typeof i.output === "string" ? i.output : JSON.stringify(i.output),
        });
    } else if (i.role) {
      if (["system", "developer"].includes(i.role)) {
        system.push(textOf(i.content));
        continue;
      }
      if (
        Array.isArray(i.content) &&
        i.content.some(
          (c) => !["input_text", "output_text", "text"].includes(c.type),
        )
      )
        throw new Error(
          "该协议适配目前仅支持文本和函数工具；图片/文件请使用 Responses 模型",
        );
      messages.push({
        role: i.role === "assistant" ? "assistant" : "user",
        content:
          kind === "anthropic"
            ? [{ type: "text", text: textOf(i.content) || " " }]
            : textOf(i.content),
      });
    } else throw new Error(`该协议暂不支持输入类型 ${i.type || "unknown"}`);
  }
  if (kind === "anthropic") {
    const merged = [];
    for (const m of messages) {
      if (merged.at(-1)?.role === m.role)
        merged.at(-1).content.push(...m.content);
      else merged.push(m);
    }
    return { messages: merged, system: system.filter(Boolean).join("\n\n") };
  }
  return {
    messages: [
      ...(system.some(Boolean)
        ? [{ role: "system", content: system.filter(Boolean).join("\n\n") }]
        : []),
      ...messages,
    ],
  };
}
function convertRequest(body, model, protocol) {
  if (body.previous_response_id)
    throw new Error("跨协议请求需要完整历史，不支持 previous_response_id");
  const tools = (body.tools || []).map((t) => {
    if (t.type !== "function")
      throw new Error(
        `该协议不支持 ${t.type} 工具，请关闭原生工具或改用 Responses 模型`,
      );
    return protocol === "anthropic"
      ? {
          name: t.name,
          description: t.description || "",
          input_schema: t.parameters || { type: "object", properties: {} },
        }
      : {
          type: "function",
          function: {
            name: t.name,
            description: t.description || "",
            parameters: t.parameters || { type: "object", properties: {} },
          },
        };
  });
  const request = {
    model: body.model,
    ...inputMessages(body, protocol),
    stream: true,
  };
  if (tools.length) request.tools = tools;
  if (protocol === "anthropic") {
    request.max_tokens =
      body.max_output_tokens || model.maxOutputTokens || 16384;
    // Effort is forwarded, never silently downshifted. Compatibility is determined by the upstream.
    if (body.reasoning?.effort)
      request.output_config = { effort: body.reasoning.effort };
    if (body.tool_choice === "none") delete request.tools;
    else if (body.tool_choice === "required")
      request.tool_choice = { type: "any" };
    else if (body.tool_choice?.name)
      request.tool_choice = { type: "tool", name: body.tool_choice.name };
  } else {
    request.stream_options = { include_usage: true };
    if (body.reasoning?.effort)
      request.reasoning_effort = body.reasoning.effort;
    if (body.max_output_tokens) request.max_tokens = body.max_output_tokens;
    if (body.tool_choice)
      request.tool_choice =
        typeof body.tool_choice === "string"
          ? body.tool_choice
          : { type: "function", function: { name: body.tool_choice.name } };
  }
  return request;
}
async function* sseMessages(stream) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) {
          if (data === "[DONE]") yield { done: true };
          else yield JSON.parse(data);
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
class ResponseEvents {
  constructor(model) {
    this.seq = 0;
    this.response = {
      id: "resp_" + crypto.randomBytes(12).toString("hex"),
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "in_progress",
      model,
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
    this.items = new Map();
  }
  event(type, data = {}) {
    return { type, sequence_number: this.seq++, ...data };
  }
  start() {
    return [
      this.event("response.created", {
        response: { ...this.response, output: [] },
      }),
      this.event("response.in_progress", {
        response: { ...this.response, output: [] },
      }),
    ];
  }
  add(key, kind, info = {}) {
    if (this.items.has(key)) return [];
    const index = this.response.output.length;
    const item =
      kind === "tool"
        ? {
            type: "function_call",
            id: "fc_" + crypto.randomBytes(8).toString("hex"),
            call_id: info.id || "call_" + crypto.randomBytes(8).toString("hex"),
            name: info.name || "",
            arguments: "",
            status: "in_progress",
          }
        : {
            type: "message",
            id: "msg_" + crypto.randomBytes(8).toString("hex"),
            role: "assistant",
            status: "in_progress",
            content: [{ type: "output_text", text: "", annotations: [] }],
          };
    this.items.set(key, { item, index });
    this.response.output.push(item);
    const ev = [
      this.event("response.output_item.added", {
        output_index: index,
        item: structuredClone(item),
      }),
    ];
    if (kind !== "tool")
      ev.push(
        this.event("response.content_part.added", {
          item_id: item.id,
          output_index: index,
          content_index: 0,
          part: structuredClone(item.content[0]),
        }),
      );
    return ev;
  }
  delta(key, text) {
    const { item, index } = this.items.get(key);
    if (item.type === "function_call") {
      item.arguments += text;
      return this.event("response.function_call_arguments.delta", {
        item_id: item.id,
        output_index: index,
        delta: text,
      });
    }
    item.content[0].text += text;
    return this.event("response.output_text.delta", {
      item_id: item.id,
      output_index: index,
      content_index: 0,
      delta: text,
    });
  }
  finish(incomplete = false) {
    const ev = [];
    for (const { item, index } of this.items.values()) {
      item.status = "completed";
      if (item.type === "function_call")
        ev.push(
          this.event("response.function_call_arguments.done", {
            item_id: item.id,
            output_index: index,
            arguments: item.arguments,
          }),
        );
      else {
        ev.push(
          this.event("response.output_text.done", {
            item_id: item.id,
            output_index: index,
            content_index: 0,
            text: item.content[0].text,
          }),
        );
        ev.push(
          this.event("response.content_part.done", {
            item_id: item.id,
            output_index: index,
            content_index: 0,
            part: item.content[0],
          }),
        );
      }
      ev.push(
        this.event("response.output_item.done", { output_index: index, item }),
      );
    }
    this.response.status = incomplete ? "incomplete" : "completed";
    if (incomplete)
      this.response.incomplete_details = { reason: "max_output_tokens" };
    this.response.usage.total_tokens =
      this.response.usage.input_tokens + this.response.usage.output_tokens;
    ev.push(
      this.event(incomplete ? "response.incomplete" : "response.completed", {
        response: this.response,
      }),
    );
    return ev;
  }
}
async function* translateStream(stream, protocol, model) {
  const out = new ResponseEvents(model);
  yield* out.start();
  let ended = false,
    limited = false;
  for await (const data of sseMessages(stream)) {
    if (data.error || data.type === "error") throw new Error("上游流返回错误");
    if (protocol === "anthropic") {
      if (data.type === "message_start")
        out.response.usage.input_tokens =
          data.message?.usage?.input_tokens || 0;
      if (data.type === "content_block_start") {
        const c = data.content_block;
        if (c.type === "tool_use")
          yield* out.add(data.index, "tool", { id: c.id, name: c.name });
        else if (c.type === "text") {
          yield* out.add(data.index, "text");
          if (c.text) yield out.delta(data.index, c.text);
        }
      }
      if (data.type === "content_block_delta" && out.items.has(data.index)) {
        if (data.delta.type === "text_delta")
          yield out.delta(data.index, data.delta.text);
        if (data.delta.type === "input_json_delta")
          yield out.delta(data.index, data.delta.partial_json);
      }
      if (data.type === "message_delta") {
        out.response.usage.output_tokens = data.usage?.output_tokens || 0;
        limited = data.delta?.stop_reason === "max_tokens";
      }
      if (data.type === "message_stop") {
        ended = true;
        break;
      }
    } else {
      if (data.done) {
        ended = true;
        break;
      }
      if (data.usage) {
        out.response.usage.input_tokens = data.usage.prompt_tokens || 0;
        out.response.usage.output_tokens = data.usage.completion_tokens || 0;
      }
      const c = data.choices?.[0],
        d = c?.delta;
      if (c?.finish_reason) {
        ended = true;
        limited = c.finish_reason === "length";
      }
      if (d?.content) {
        yield* out.add("text", "text");
        yield out.delta("text", d.content);
      }
      for (const t of d?.tool_calls || []) {
        const key = "tool" + t.index;
        yield* out.add(key, "tool", { id: t.id, name: t.function?.name });
        if (t.function?.arguments) yield out.delta(key, t.function.arguments);
      }
    }
  }
  if (!ended) throw new Error("上游流提前断开，未收到结束事件");
  yield* out.finish(limited);
}
module.exports = { convertRequest, translateStream, sseMessages };
