import "@tailor-platform/app-shell/styles";
import dark from "@enlumine/html/themes/dark";
import light from "@enlumine/html/themes/light";
import json from "@enlumine/json";
import { Alert, Badge, Button, Card, Textarea } from "@tailor-platform/app-shell";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { segments } from "../../src/function-run/segments";
import { parseFrame, splitFrames, type RunRecord } from "../../src/function-run/stream";
import { scopeTheme } from "../../src/function-run/theme";
import { Editor } from "./Editor";
import "./style.css";

type EntryBody = { type: "run"; record: RunRecord } | { type: "failure" | "note"; text: string };
type Entry = EntryBody & { id: number };

const token = document.querySelector<HTMLMetaElement>('meta[name="tailor-studio-token"]')?.content;
const themeCss = `${scopeTheme(light, ":root:not(.dark)")}${scopeTheme(dark, ".dark")}`;

const starterCode = `import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "add",
  operation: "query",
  permission: "allowAnonymous",
  input: {
    a: t.int(),
    b: t.int(),
  },
  body: ({ input }) => input.a + input.b,
  output: t.int(),
});
`;

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark")),
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function followShellTheme() {
  const sync = () => {
    document.documentElement.className = window.parent.document.documentElement.className;
  };
  try {
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(window.parent.document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  } catch {
    document.documentElement.className = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function Code({ text, language }: { text: string; language: "json" | "plain" }) {
  const parts = useMemo(() => segments(text, language === "json" ? json : null), [text, language]);
  return (
    <pre
      className="enlumine astw:m-0 astw:overflow-x-auto astw:rounded-md astw:bg-muted astw:p-3"
      style={{ fontSize: "0.75rem" }}
    >
      {parts.map((part, index) => (
        <span key={index} className={`enl-${part.kind}`}>
          {part.text}
        </span>
      ))}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="astw:grid astw:gap-1">
      <div className="astw:font-medium astw:text-muted-foreground" style={{ fontSize: "0.75rem" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function RunCard({ record }: { record: RunRecord }) {
  const ok = record.success === true;
  return (
    <Card.Root>
      <Card.Header>
        <div className="astw:flex astw:flex-wrap astw:items-center astw:gap-2">
          <Badge variant={ok ? "success" : "error"}>{ok ? "OK" : "FAILED"}</Badge>
          <span className="astw:font-medium">{record.functionName ?? record.scriptName}</span>
          {record.executionId ? (
            <code className="astw:text-muted-foreground" style={{ fontSize: "0.75rem" }}>
              {record.executionId}
            </code>
          ) : null}
        </div>
      </Card.Header>
      <Card.Content>
        <div className="astw:grid astw:gap-3">
          {record.result ? (
            <Section title="Result">
              <Code text={prettyJson(record.result)} language="json" />
            </Section>
          ) : null}
          {record.logs?.trim() ? (
            <Section title="Logs">
              <Code text={record.logs} language="plain" />
            </Section>
          ) : null}
          {record.error ? (
            <Section title="Error">
              <Code text={record.error} language="plain" />
            </Section>
          ) : null}
        </div>
      </Card.Content>
    </Card.Root>
  );
}

function App() {
  const [code, setCode] = useState(starterCode);
  const [arg, setArg] = useState("");
  const [status, setStatus] = useState<"idle" | "watching" | "stopped">("idle");
  const [entries, setEntries] = useState<Entry[]>([]);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const runId = useRef<string | null>(null);
  const dark = useDarkTheme();

  useEffect(followShellTheme, []);

  useEffect(() => {
    const id = runId.current;
    if (id === null) return;
    const timer = setTimeout(() => {
      void fetch("save", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tailor-studio-token": token ?? "" },
        body: JSON.stringify({ id, code }),
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [code]);

  const add = (entry: EntryBody) =>
    setEntries((current) => [{ ...entry, id: nextId.current++ }, ...current]);

  async function run() {
    const abort = new AbortController();
    controller.current = abort;
    setEntries([]);
    setStatus("watching");
    try {
      const response = await fetch("run", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tailor-studio-token": token ?? "" },
        body: JSON.stringify({ code, arg: arg.trim() }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        add({ type: "failure", text: (await response.text()).trim() || "Request failed" });
        return;
      }
      runId.current = response.headers.get("x-run-id");
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const { frames, rest } = splitFrames(buffer + value);
        buffer = rest;
        for (const frame of frames) {
          const message = parseFrame(frame);
          if (message === undefined || message.type === "exit") continue;
          if (message.type === "run") add({ type: "run", record: message.record });
          else add(message);
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        add({ type: "failure", text: String(error) });
      }
    } finally {
      controller.current = null;
      runId.current = null;
      setStatus("stopped");
    }
  }

  const watching = status === "watching";
  return (
    <form
      className="fr-root"
      onSubmit={(event) => {
        event.preventDefault();
        void run();
      }}
    >
      <style>{themeCss}</style>
      <div className="fr-bar">
        <Button type="submit" disabled={watching}>
          Run and watch
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!watching}
          onClick={() => controller.current?.abort()}
        >
          Stop
        </Button>
        <Badge variant={watching ? "info" : "neutral"} className="astw:ml-auto">
          {watching ? "Watching" : status === "stopped" ? "Stopped" : "Idle"}
        </Badge>
      </div>
      <div className="fr-main">
        <div className="fr-pane">
          <div className="fr-label">Function</div>
          <div className="fr-editor">
            <Editor value={code} onChange={setCode} dark={dark} />
          </div>
          <label className="fr-label" htmlFor="argument">
            Argument (JSON, optional)
          </label>
          <Textarea
            id="argument"
            value={arg}
            onChange={(event) => setArg(event.target.value)}
            placeholder='{"a": 1, "b": 2}'
            rows={4}
            disabled={watching}
            className="astw:font-mono"
          />
        </div>
        <div className="fr-pane">
          <div className="fr-label">Output</div>
          <div className="fr-output">
            {entries.length === 0 ? (
              <div className="fr-empty">Run the function to see its output here.</div>
            ) : null}
            {entries.map((entry) =>
              entry.type === "run" ? (
                <RunCard key={entry.id} record={entry.record} />
              ) : (
                <Alert.Root key={entry.id} variant={entry.type === "failure" ? "error" : "neutral"}>
                  <Alert.Description>
                    <span className="astw:whitespace-pre-wrap">{entry.text}</span>
                  </Alert.Description>
                </Alert.Root>
              ),
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
