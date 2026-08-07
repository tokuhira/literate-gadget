const display = document.createElement("div");
display.style.cssText = "font-size:5rem;text-align:center;font-family:sans-serif";

function button(label, delta) {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText = "font-size:2rem;width:4rem;margin:0 .5rem";
  b.onclick = () => gadget.increment(delta);
  return b;
}

const controls = document.createElement("div");
controls.style.textAlign = "center";
controls.append(button("-", -1), button("+", +1));
document.body.append(display, controls);

class Watcher extends RpcTarget {
  update(count) {
    display.textContent = count;
  }

  [Symbol.dispose]() {
    connect();
  }
}

async function connect() {
  display.textContent = await gadget.subscribe(new Watcher());
}

await connect();
