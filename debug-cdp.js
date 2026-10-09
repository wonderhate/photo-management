const http = require("http");

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let data = "";
      response.on("data", (chunk) => data += chunk);
      response.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

async function main() {
  const targets = await getJson("http://127.0.0.1:9223/json");
  const target = targets.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:5500/"));
  if (!target) throw new Error("Page target not found");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let messageId = 0;
  const pending = new Map();

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  };

  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5500/" });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const clicks = await send("Runtime.evaluate", {
    expression: "window.__errors = []; window.addEventListener('error', (event) => window.__errors.push(String(event.message))); [...document.querySelectorAll('.photo-tile')].map((tile, index) => { tile.click(); const rect = document.getElementById('imageStage').getBoundingClientRect(); const result = { index, width: rect.width, height: rect.height }; document.getElementById('modalClose').click(); return result; })",
    returnByValue: true,
  });
  console.log(JSON.stringify(clicks, null, 2));

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const result = await send("Runtime.evaluate", {
    expression: "JSON.stringify({errors: window.__errors, tiles: document.querySelectorAll('.photo-tile').length})",
    returnByValue: true,
  });

  console.log(JSON.stringify(result, null, 2));
  socket.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
