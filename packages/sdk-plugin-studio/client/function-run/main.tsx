import "@tailor-platform/app-shell/styles";
import dark from "@enlumine/html/themes/dark";
import light from "@enlumine/html/themes/light";
import json from "@enlumine/json";
import { Highlight } from "@enlumine/react";
import { Alert, Badge, Button, Card } from "@tailor-platform/app-shell";
import {
  StrictMode,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createRoot } from "react-dom/client";
import { locateArgPath, normalizeArg } from "../../src/function-run/arg";
import { parseEventFrame, splitFrames, type RunRecord } from "../../src/function-run/stream";
import { parseTailorErrors, type TailorErrorItem } from "../../src/function-run/tailor-errors";
import { scopeTheme } from "../../src/function-run/theme";
import { Editor } from "./Editor";
import "./style.css";

type EntryBody = { type: "run"; record: RunRecord } | { type: "failure" | "note"; text: string };
type Entry = EntryBody & { id: number };

const themeCss = `${scopeTheme(light, ":root:not(.dark)")}${scopeTheme(dark, ".dark")}`;

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
      style={{ fontSize: "0.875rem" }}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="astw:grid astw:gap-1">
      <div className="astw:font-medium astw:text-muted-foreground" style={{ fontSize: "0.875rem" }}>
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
            <code className="astw:text-muted-foreground" style={{ fontSize: "0.875rem" }}>
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

interface Paths {
  file: string;
  argFile: string;
  resultFile?: string;
  absolute?: { file: string; argFile: string; resultFile?: string };
}

interface ServerState extends Paths {
  code: string;
  arg: string;
  status: Status;
  running?: boolean;
  reason?: string;
}

type Status = "idle" | "watching" | "stopped";

async function readEvents(
  signal: AbortSignal,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const response = await fetch("events", { signal });
  if (!response.ok || !response.body) throw new Error(`events: ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const { frames, rest } = splitFrames(buffer + value);
    buffer = rest;
    for (const frame of frames) {
      const { event, data } = parseEventFrame(frame);
      onEvent(event, JSON.parse(data));
    }
  }
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function PathWithCopy({
  title,
  shown,
  copied: text,
  label,
}: {
  title: string;
  shown: string;
  copied: string;
  label: string;
}) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  if (shown === "") return <span className="fr-title">{title}</span>;
  const finish = (outcome: "copied" | "failed") => {
    setResult(outcome);
    setTimeout(() => setResult(null), 1500);
  };
  return (
    <>
      <span className="fr-title">
        {title}{" "}
        <code className="fr-path" title={text}>
          {shown}
        </code>
      </span>
      <button
        type="button"
        className="fr-copy"
        data-result={result ?? undefined}
        title={result === "copied" ? "Copied" : result === "failed" ? "Copy failed" : text}
        aria-label={`Copy the path of the ${label}`}
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => finish("copied"),
            () => finish("failed"),
          );
        }}
      >
        {result === "copied" ? (
          <Icon>
            <path d="M5 12l5 5L20 7" />
          </Icon>
        ) : result === "failed" ? (
          <Icon>
            <path d="M6 6l12 12M18 6L6 18" />
          </Icon>
        ) : (
          <Icon>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V6a2 2 0 0 1 2-2h9" />
          </Icon>
        )}
      </button>
    </>
  );
}

function put(change: { code: string } | { arg: string }): void {
  void fetch("file", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(change),
  });
}

function App() {
  const [code, setCode] = useState("");
  const [arg, setArg] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [paths, setPaths] = useState<Paths>({ file: "", argFile: "" });
  const [status, setStatus] = useState<Status>("idle");
  const [running, setRunning] = useState(false);
  const [argHeight, setArgHeight] = useState(DEFAULT_ARG_HEIGHT);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [argErrors, setArgErrors] = useState<TailorErrorItem[]>([]);
  const leftPane = useRef<HTMLDivElement | null>(null);
  const serverCode = useRef("");
  const serverArg = useRef("");
  const localId = useRef(0);
  const dark = useDarkTheme();

  useEffect(followShellTheme, []);

  useEffect(() => {
    const abort = new AbortController();
    const handle = (event: string, data: unknown) => {
      if (event === "state") {
        const state = data as ServerState;
        serverCode.current = state.code;
        serverArg.current = state.arg;
        setCode(state.code);
        setArg(state.arg);
        setPaths({
          file: state.file,
          argFile: state.argFile,
          resultFile: state.resultFile,
          absolute: state.absolute,
        });
        setStatus(state.status);
        setRunning(state.running === true);
        setEntries([]);
        setArgErrors([]);
        setLoaded(true);
      } else if (event === "reset") {
        setEntries([]);
        setArgErrors([]);
      } else if (event === "status") {
        const next = data as { status: Status; running?: boolean };
        setStatus(next.status);
        setRunning(next.running === true);
      } else if (event === "entry") {
        const { seq, message } = data as { seq: number; message: EntryBody };
        setEntries((current) => [{ ...message, id: seq }, ...current]);
        if (message.type === "run") setArgErrors(parseTailorErrors(message.record.error));
      } else if (event === "file") {
        const change = data as { code?: string; arg?: string };
        if (change.code !== undefined) {
          serverCode.current = change.code;
          setCode(change.code);
        }
        if (change.arg !== undefined) {
          serverArg.current = change.arg;
          setArg(change.arg);
          setArgErrors([]);
        }
      }
    };
    void (async () => {
      while (!abort.signal.aborted) {
        try {
          await readEvents(abort.signal, handle);
        } catch {
          // reconnect below
        }
        if (!abort.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    })();
    return () => abort.abort();
  }, []);

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

  useEffect(() => {
    if (!loaded || code === serverCode.current) return;
    const timer = setTimeout(() => {
      serverCode.current = code;
      put({ code });
    }, 400);
    return () => clearTimeout(timer);
  }, [code, loaded]);

  useEffect(() => {
    if (!loaded || !argValid || arg === serverArg.current) return;
    const timer = setTimeout(() => {
      serverArg.current = arg;
      put({ arg });
    }, 400);
    return () => clearTimeout(timer);
  }, [arg, argValid, loaded]);

  async function start() {
    const response = await fetch("start", { method: "POST" });
    if (!response.ok) {
      const text = (await response.text()).trim() || "Request failed";
      setEntries((current) => [{ type: "failure", text, id: --localId.current }, ...current]);
    }
  }

  function stop() {
    void fetch("stop", { method: "POST" });
  }

  const watching = status === "watching";
  return (
    <form
      className="fr-root"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <style>{themeCss}</style>
      <div className="fr-bar">
        <Button type="submit" disabled={watching || !loaded}>
          Run and watch
        </Button>
        <Button type="button" variant="outline" disabled={!watching} onClick={stop}>
          Stop
        </Button>
        <Badge variant={watching ? "info" : "neutral"} className="astw:ml-auto">
          {watching ? "Watching" : status === "stopped" ? "Stopped" : "Idle"}
        </Badge>
      </div>
      <div className="fr-main">
        <div className="fr-pane" ref={leftPane}>
          <div className="fr-label">
            <PathWithCopy
              title="Function"
              shown={paths.file}
              copied={paths.absolute?.file ?? paths.file}
              label="function"
            />
          </div>
          <div className="fr-editor">
            <Editor value={code} onChange={setCode} dark={dark} label="Function" typescript />
          </div>
          <Splitter height={argHeight} onChange={setArgHeight} pane={leftPane} />
          <div className="fr-label" id="argument-label">
            <PathWithCopy
              title="Argument (JSON5)"
              shown={paths.argFile}
              copied={paths.absolute?.argFile ?? paths.argFile}
              label="argument"
            />
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
          {argValid ? null : (
            <div className="fr-invalid" role="alert">
              Not valid JSON5. The last valid argument stays in use.
            </div>
          )}
        </div>
        <div className="fr-pane">
          <div className="fr-label">
            <PathWithCopy
              title="Output"
              shown={paths.resultFile ?? ""}
              copied={paths.absolute?.resultFile ?? paths.resultFile ?? ""}
              label="result file"
            />
            {running ? (
              <span className="fr-running" role="status">
                <span className="fr-spinner" aria-hidden="true" />
                Running…
              </span>
            ) : null}
          </div>
          <div className="fr-output" aria-busy={running}>
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
