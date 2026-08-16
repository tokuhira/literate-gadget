import { DurableObject } from "cloudflare:workers";

export class Gadget extends DurableObject {
  
  async bump() {
    const n = ((await this.ctx.storage.get("n")) ?? 0) + 1;
    await this.ctx.storage.put("n", n);
    return n;
  }
  
  async current() {
    return (await this.ctx.storage.get("n")) ?? 0;
  }
}
