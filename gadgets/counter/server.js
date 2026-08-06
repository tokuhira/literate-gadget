import { DurableObject } from "cloudflare:workers";

export class Gadget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.subscribers = new Set();
  }
  
  async getCount() {
    return (await this.ctx.storage.get("count")) ?? 0;
  }
  
  async increment(delta) {
    const next = (await this.getCount()) + delta;
    await this.ctx.storage.put("count", next);
    this.broadcast(next);
    return next;
  }
  
  async subscribe(callback) {
    const held = callback.dup();
    this.subscribers.add(held);
    held.onRpcBroken(() => this.subscribers.delete(held));
    return this.getCount();
  }
  
  broadcast(count) {
    for (const s of this.subscribers) {
      s.update(count).catch(() => {});
    }
  }
}
