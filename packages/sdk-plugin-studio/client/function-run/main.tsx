import "@tailor-platform/app-shell/styles";
import dark from "@enlumine/html/themes/dark";
import light from "@enlumine/html/themes/light";
import json from "@enlumine/json";
import { Highlight } from "@enlumine/react";
import { Alert, Badge, Button, Card } from "@tailor-platform/app-shell";
import { StrictMode, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { locateArgPath, normalizeArg } from "../../src/function-run/arg";
import { parseFrame, splitFrames, type RunRecord } from "../../src/function-run/stream";
import { parseTailorErrors, type TailorErrorItem } from "../../src/function-run/tailor-errors";
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
  return (
    <Highlight
      source={text}
      tokenizer={language === "json" ? json : null}
      className="astw:m-0 astw:overflow-x-auto astw:rounded-md astw:bg-muted astw:p-3"
      style={{ fontSize: "0.75rem" }}
    />
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

const DEFAULT_ARG_HEIGHT = 192;
const MIN_ARG_HEIGHT = 64;
const MIN_EDITOR_HEIGHT = 120;

function Splitter({
  height,
  onChange,
  pane,
}: {
  height: number;
  onChange: (height: number) => void;
  pane: RefObject<HTMLDivElement | null>;
}) {
  const maxHeight = () => {
    const editor = pane.current?.querySelector(".fr-editor")?.clientHeight ?? 0;
    return height + editor - MIN_EDITOR_HEIGHT;
  };
  const start = useRef<{ y: number; height: number; max: number } | null>(null);
  return (
    <div
      className="fr-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the argument"
      aria-valuenow={height}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { y: event.clientY, height, max: maxHeight() };
      }}
      onPointerMove={(event) => {
        if (start.current === null) return;
        const next = start.current.height + start.current.y - event.clientY;
        onChange(Math.round(Math.max(MIN_ARG_HEIGHT, Math.min(next, start.current.max))));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const next = height + (event.key === "ArrowUp" ? 24 : -24);
        onChange(Math.max(MIN_ARG_HEIGHT, Math.min(next, maxHeight())));
      }}
    />
  );
}

function App() {
  const [code, setCode] = useState(starterCode);
  const [argHeight, setArgHeight] = useState(DEFAULT_ARG_HEIGHT);
  const leftPane = useRef<HTMLDivElement | null>(null);
  const [arg, setArg] = useState("");
  const [status, setStatus] = useState<"idle" | "watching" | "stopped">("idle");
  const [entries, setEntries] = useState<Entry[]>([]);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const runId = useRef<string | null>(null);
  const dark = useDarkTheme();

  useEffect(followShellTheme, []);

  const [argErrors, setArgErrors] = useState<TailorErrorItem[]>([]);
  const argValid = normalizeArg(arg) !== undefined;
  const argDiagnostics = useMemo(
    () =>
      argErrors.flatMap((item) => {
        const range = locateArgPath(arg, item.path);
        if (range === undefined) return [];
        const where = item.path.length > 0 ? `${item.path.join(".")}: ` : "";
        return [{ ...range, severity: "error" as const, message: `${where}${item.message}` }];
      }),
    [argErrors, arg],
  );

  const save = (change: { code: string } | { arg: string }) => {
    const id = runId.current;
    if (id === null) return;
    void fetch("save", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tailor-studio-token": token ?? "" },
      body: JSON.stringify({ id, ...change }),
    });
  };

  useEffect(() => {
    if (runId.current === null) return;
    const timer = setTimeout(() => save({ code }), 400);
    return () => clearTimeout(timer);
  }, [code]);

  useEffect(() => {
    if (runId.current === null || !argValid) return;
    const timer = setTimeout(() => save({ arg: arg.trim() }), 400);
    return () => clearTimeout(timer);
  }, [arg, argValid]);

  const add = (entry: EntryBody) =>
    setEntries((current) => [{ ...entry, id: nextId.current++ }, ...current]);

  async function run() {
    const abort = new AbortController();
    controller.current = abort;
    setEntries([]);
    setArgErrors([]);
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
          if (message.type === "run") {
            add({ type: "run", record: message.record });
            setArgErrors(parseTailorErrors(message.record.error));
          } else add(message);
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
        <div className="fr-pane" ref={leftPane}>
          <div className="fr-label">Function</div>
          <div className="fr-editor">
            <Editor value={code} onChange={setCode} dark={dark} label="Function" typescript />
          </div>
          <Splitter height={argHeight} onChange={setArgHeight} pane={leftPane} />
          <div className="fr-label" id="argument-label">
            Argument (JSON or JSON5, optional)
            {argValid ? null : (
              <span className="fr-invalid">
                {" "}
                — not valid JSON or JSON5, the last valid argument stays in use
              </span>
            )}
          </div>
          <div className="fr-argument" style={{ height: argHeight }}>
            <Editor
              value={arg}
              onChange={(next) => {
                setArg(next);
                setArgErrors([]);
              }}
              dark={dark}
              label="Argument"
              placeholder="{a: 1, b: 2}"
              diagnostics={argDiagnostics}
              invalid={!argValid || argErrors.length > 0}
            />
          </div>
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
