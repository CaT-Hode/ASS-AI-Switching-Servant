const { SseParser } = require('./sse-parser.cjs');
class SseMonitor {
  constructor() { this.parser = new SseParser(); this.ended = false; }
  feed(bytes, done = false) {
    const frames = this.parser.feed(bytes, done, event => ['response.completed', 'response.incomplete'].includes(event.type)), output = [];
    for (const frame of frames) {
      if (this.ended) break;
      output.push(frame.raw);
      if (['response.completed', 'response.incomplete'].includes(frame.event.type)) this.ended = true;
    }
    if (done && !this.ended) throw Error('上游流提前断开，未收到结束事件');
    return output;
  }
}
module.exports = { SseMonitor };
