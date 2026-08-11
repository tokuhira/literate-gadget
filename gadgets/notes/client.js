const style = "font:14px sans-serif";
document.body.style.cssText = style + ";margin:1rem";

const input = document.createElement("input");
input.value = "こんにちは";
input.style.cssText = style + ";padding:.3rem;width:12rem";

function button(label, onclick) {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText = style + ";padding:.4rem .8rem;margin-right:.4rem";
  b.onclick = onclick;
  return b;
}

const controls = document.createElement("div");
controls.append(
  button("読む", () => gadget.readNote()),
  button("書き足す", () => gadget.appendNote(input.value)),
  button("触る", () => gadget.touchNote()),
  input);

const table = document.createElement("div");
table.style.cssText = style + ";margin-top:1rem";
document.body.append(controls, table);

const COLOR = {
  ok: "#0a0", pending: "#c60", rejected: "#c00", failed: "#c00",
};

function render(log) {
  table.textContent = "";
  for (const row of [...log].reverse()) {
    const line = document.createElement("div");
    line.style.cssText = "padding:.25rem 0;border-top:1px solid #ddd";

    const status = document.createElement("b");
    status.textContent = row.status;
    status.style.color = COLOR[row.status] ?? "#666";

    const label = document.createElement("span");
    label.textContent = ` ${row.tool} — ${row.detail ?? ""}`;

    line.append(status, label);
    if (row.kind === "call" && row.status === "pending" && row.actionId !== undefined) {
      line.append(button("回収", () => gadget.collect(row.actionId)));
    }
    table.append(line);
  }
}

class Watcher extends RpcTarget {
  update(log) {
    render(log);
  }

  [Symbol.dispose]() {
    connect();
  }
}

async function connect() {
  render(await gadget.subscribe(new Watcher()));
}

await connect();
