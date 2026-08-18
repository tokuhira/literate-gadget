// Code generated from notes.nw by ntangle. DO NOT EDIT.
// これは生成物。変更は notes.nw の <<server.js>> を編集して tangle し直す。

import { DurableObject } from "cloudflare:workers";

function summarize(kind, tool, result) {
  return {
    kind,                       // "call"（道具を呼んだ）か "collect"（結果を取りに行った）
    tool,
    status: result.status,
    actionId: result.actionId,
    detail: result.status === "ok" ? result.text : result.message,
  };
}

export class Gadget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.subscribers = new Set();
  }
  
  get notes() {
    const binding = this.env.NOTES;
    if (!binding) {
      throw new Error(
        "NOTES という名前の接続がない。Connections で名前を NOTES にして繋ぐこと。");
    }
    return binding;
  }
  
  async getLog() {
    return (await this.ctx.storage.get("log")) ?? [];
  }
  
  async note(entry) {
    const log = [...(await this.getLog()), { at: new Date().toISOString(), ...entry }];
    const trimmed = log.slice(-20);
    await this.ctx.storage.put("log", trimmed);
    this.broadcast(trimmed);
    return trimmed;
  }
  
  async readNote() {
    return this.note(
      summarize("call", "notes_read", await this.notes.callTool("notes_read", {})));
  }
  
  async appendNote(text) {
    return this.note(
      summarize("call", "notes_append",
                await this.notes.callTool("notes_append", { text })));
  }
  
  async touchNote() {
    return this.note(
      summarize("call", "notes_touch", await this.notes.callTool("notes_touch", {})));
  }
  
  async collect(actionId) {
    return this.note(
      summarize("collect", "回収 #" + actionId,
                await this.notes.getActionResult(actionId)));
  }
  
  async subscribe(callback) {
    const held = callback.dup();
    this.subscribers.add(held);
    held.onRpcBroken(() => this.subscribers.delete(held));
    return this.getLog();
  }
  
  broadcast(log) {
    for (const s of this.subscribers) {
      s.update(log).catch(() => {});
    }
  }
}
