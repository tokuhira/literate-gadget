const out = document.createElement("div");
out.style.cssText = "font:3rem sans-serif;text-align:center";

const push = document.createElement("button");
push.textContent = "押す";
push.style.cssText = "font:1.2rem sans-serif;display:block;margin:1rem auto";

push.onclick = async () => { out.textContent = await gadget.bump(); };
document.body.append(out, push);
out.textContent = await gadget.current();
