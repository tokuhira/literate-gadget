// Code generated from toy.nw by ntangle. DO NOT EDIT.
// これは生成物。変更は toy.nw の <<server.js>> を編集して tangle し直す。

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
