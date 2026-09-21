class SseMonitor {
  constructor() {
    this.decoder = new TextDecoder();
    this.buffer = "";
    this.ended = false;
  }
  feed(bytes, done = false) {
    this.buffer += done
      ? this.decoder.decode()
      : this.decoder.decode(bytes, { stream: true });
    this.buffer = this.buffer.replace(/\r\n/g, "\n");
    let end;
    if (this.buffer.length > 16 * 1024 * 1024)
      throw new Error("上游 SSE 单个事件超过限制");
    while ((end = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const text = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!text || text === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(text);
      } catch {
        throw new Error("上游 SSE 事件不是有效 JSON");
      }
      if (["error", "response.failed"].includes(event.type))
        throw new Error("上游流返回失败事件，请检查供应商状态或模型参数");
      if (["response.completed", "response.incomplete"].includes(event.type))
        this.ended = true;
    }
    if (done && !this.ended) throw new Error("上游流提前断开，未收到结束事件");
  }
}
module.exports = { SseMonitor };
