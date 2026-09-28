const { createHash } = require("node:crypto");
// Convert client-executed custom/namespace tools to JSON functions. The proxy
// never executes them; restore the exact client tool identity on the way back.
function toolBridge(body) {
  const mapping = new Map(), names = new Map(), tools = [];
  const key = (namespace, name) => JSON.stringify([namespace || "", name]);
  function add(tool, namespace) {
    if (tool.type === "namespace") {
      for (const nested of tool.tools || []) add(nested, namespace ? namespace + "." + tool.name : tool.name);
      return;
    }
    if (!["custom", "function"].includes(tool.type)) { tools.push(tool); return; }
    const original = { name: tool.name, ...(namespace ? { namespace } : {}), custom: tool.type === "custom" };
    const wireName = namespace || original.custom ? "ass_" + createHash("sha256").update(key(namespace, tool.name)).digest("hex").slice(0, 32) : tool.name;
    if (mapping.has(wireName)) throw Object.assign(Error("重复工具定义"), { status: 400 });
    mapping.set(wireName, original); names.set(key(namespace, tool.name), wireName);
    tools.push(original.custom ? { type: "function", name: wireName,
      description: [tool.description, "Pass the complete raw tool input as the input string.",
        tool.format?.syntax ? "Input syntax: " + tool.format.syntax : "", tool.format?.definition || ""].filter(Boolean).join("\n"),
      parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"], additionalProperties: false } }
      : { ...tool, name: wireName });
  }
  for (const tool of body.tools || []) add(tool, tool.namespace);
  function convertItem(item) {
    if (item.type === "custom_tool_call_output") return { ...item, type: "function_call_output" };
    if (!["function_call", "custom_tool_call"].includes(item.type)) return item;
    const name = names.get(key(item.namespace, item.name));
    if (!name && item.type === "custom_tool_call") throw Object.assign(Error("自定义工具历史缺少对应定义"), { status: 400 });
    const { namespace, input, ...rest } = item;
    return { ...rest, type: "function_call", name: name || item.name,
      arguments: item.type === "custom_tool_call" ? JSON.stringify({ input }) : item.arguments };
  }
  const choice = body.tool_choice;
  const request = { ...body, ...(body.tools ? { tools } : {}),
    ...(Array.isArray(body.input) ? { input: body.input.map(convertItem) } : {}),
    ...(choice && typeof choice === "object" && names.has(key(choice.namespace, choice.name))
      ? { tool_choice: { type: "function", name: names.get(key(choice.namespace, choice.name)) } } : {}) };
  function item(value) {
    const original = value?.type === "function_call" && mapping.get(value.name);
    if (!original) return value;
    const { custom, ...identity } = original;
    if (!custom) return { ...value, ...identity };
    let input = "";
    if (value.arguments) {
      let parsed;
      try { parsed = JSON.parse(value.arguments); } catch { throw Error("上游自定义工具输入不是完整 JSON"); }
      if (typeof parsed.input !== "string") throw Error("上游自定义工具缺少 input 字符串");
      input = parsed.input;
    }
    const { arguments: args, ...rest } = value;
    return { ...rest, ...identity, type: "custom_tool_call", input };
  }
  async function* restore(events) {
    const customs = new Set(), argumentsById = new Map(); let sequence = 0;
    const output = event => ({ ...event, sequence_number: sequence++ });
    for await (const e of events) {
      if (e.type === "response.output_item.added" && mapping.get(e.item?.name)?.custom) customs.add(e.item.id);
      if (customs.has(e.item_id) && e.type === "response.function_call_arguments.delta") {
        argumentsById.set(e.item_id, (argumentsById.get(e.item_id) || "") + e.delta); continue;
      }
      if (customs.has(e.item_id) && e.type === "response.function_call_arguments.done") {
        const raw = e.arguments || argumentsById.get(e.item_id) || "{}";
        let parsed; try { parsed = JSON.parse(raw); } catch { throw Error("上游自定义工具输入不是完整 JSON"); }
        if (typeof parsed.input !== "string") throw Error("上游自定义工具缺少 input 字符串");
        const { arguments: args, ...rest } = e;
        yield output({ ...rest, type: "response.custom_tool_call_input.delta", delta: parsed.input });
        yield output({ ...rest, type: "response.custom_tool_call_input.done", input: parsed.input }); continue;
      }
      yield output({ ...e, ...(e.item ? { item: item(e.item) } : {}),
        ...(e.response ? { response: { ...e.response, output: e.response.output?.map(item) || [] } } : {}) });
    }
  }
  return { request, restore };
}
module.exports = { toolBridge };
