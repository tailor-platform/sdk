export function renderPage(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Function run</title>
<style>
  :root { color-scheme: light dark; --border: #8884; --ok: #1a7f37; --bad: #cf222e; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 16px; }
  form { display: grid; grid-template-columns: 1fr; gap: 8px; max-width: 720px; }
  label { display: grid; gap: 4px; }
  input, textarea { font: inherit; font-family: ui-monospace, monospace; padding: 6px 8px; }
  .actions { display: flex; gap: 8px; align-items: center; }
  .status { margin-left: auto; opacity: .7; }
  #runs { margin-top: 16px; display: grid; gap: 8px; }
  .run { border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; }
  .run header { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .badge { font-weight: 600; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }
  pre { margin: 6px 0 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
</style>
</head>
<body>
<form id="form">
  <label>Function file
    <input id="file" name="file" placeholder="resolvers/add.ts" required autocomplete="off">
  </label>
  <label>Argument (JSON, optional)
    <textarea id="arg" name="arg" rows="3" placeholder='{"a": 1, "b": 2}'></textarea>
  </label>
  <div class="actions">
    <button id="start" type="submit">Run and watch</button>
    <button id="stop" type="button" disabled>Stop</button>
    <span class="status" id="status">Idle</span>
  </div>
</form>
<div id="runs"></div>
<script>
const TOKEN = ${JSON.stringify(token)};
const form = document.getElementById("form");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const statusEl = document.getElementById("status");
const runsEl = document.getElementById("runs");
let controller = null;

function setStatus(text) { statusEl.textContent = text; }

function addRun(record) {
  const el = document.createElement("div");
  el.className = "run";
  const head = document.createElement("header");
  const badge = document.createElement("span");
  badge.className = "badge " + (record.success ? "ok" : "bad");
  badge.textContent = record.success ? "OK" : "FAILED";
  const name = document.createElement("span");
  name.textContent = record.functionName || record.scriptName || "";
  const id = document.createElement("code");
  id.textContent = record.executionId || "";
  head.append(badge, name, id);
  el.append(head);
  const parts = [];
  if (record.logs && record.logs.trim()) parts.push("Logs:\\n" + record.logs);
  if (record.result) parts.push("Result:\\n" + record.result);
  if (record.error) parts.push("Error:\\n" + record.error);
  if (parts.length) {
    const pre = document.createElement("pre");
    pre.textContent = parts.join("\\n\\n");
    el.append(pre);
  }
  runsEl.prepend(el);
}

function addNote(text, bad) {
  const el = document.createElement("div");
  el.className = "run";
  const pre = document.createElement("pre");
  if (bad) pre.className = "bad";
  pre.textContent = text;
  el.append(pre);
  runsEl.prepend(el);
}

function handleFrame(frame) {
  let event = "message";
  const data = [];
  for (const line of frame.split("\\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data.push(line.slice(6));
  }
  const text = data.join("\\n");
  if (event === "stdout") {
    try { addRun(JSON.parse(text)); } catch { addNote(text, false); }
  } else if (event === "stderr") {
    try {
      const failure = JSON.parse(text).error;
      addNote([failure.message, failure.suggestion].filter(Boolean).join("\\n"), true);
    } catch {
      addNote(text, false);
    }
  } else if (event === "exit") {
    setStatus("Stopped");
  }
}

async function run(file, arg) {
  controller = new AbortController();
  startButton.disabled = true;
  stopButton.disabled = false;
  setStatus("Watching");
  try {
    const response = await fetch("run", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tailor-studio-token": TOKEN },
      body: JSON.stringify({ file, arg }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      addNote((await response.text()).trim() || "Request failed", true);
      return;
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let index;
      while ((index = buffer.indexOf("\\n\\n")) >= 0) {
        handleFrame(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") addNote(String(error), true);
  } finally {
    controller = null;
    startButton.disabled = false;
    stopButton.disabled = true;
    if (statusEl.textContent === "Watching") setStatus("Stopped");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runsEl.replaceChildren();
  run(document.getElementById("file").value.trim(), document.getElementById("arg").value.trim());
});
stopButton.addEventListener("click", () => controller && controller.abort());
</script>
</body>
</html>
`;
}
