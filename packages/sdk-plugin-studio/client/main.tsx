import "@tailor-platform/app-shell/styles";
import { AppShell, GlobalHeaderLayout, defineModule } from "@tailor-platform/app-shell";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

type TabInfo =
  | { id: string; title: string; state: "mounted" }
  | { id: string; title: string; state: "not-installed"; installCommand: string }
  | { id: string; title: string; state: "no-ui-support" };

type PlatformInfo = { platformUrl?: string; oauth2ClientId?: string; consoleUrl?: string };

type ContextInfo = {
  platform?: PlatformInfo;
  profiles: { name: string; workspaceId: string }[];
  selected: { profile?: string; workspaceId?: string };
};

const BAR_COLORS = {
  selected: { background: "#535ae8", color: "#fff" },
  unselected: { background: "#475569", color: "#fff" },
};

const PLATFORM_LABELS: [keyof PlatformInfo, string][] = [
  ["platformUrl", "Platform URL"],
  ["oauth2ClientId", "OAuth2 client ID"],
  ["consoleUrl", "Console URL"],
];

function platformSummary(platform: PlatformInfo) {
  return PLATFORM_LABELS.flatMap(([key, label]) =>
    platform[key] ? [`${label}: ${platform[key]}`] : [],
  ).join("\n");
}

function PlatformDetails({ platform }: { platform: PlatformInfo }) {
  return (
    <dl style={{ margin: 0, fontSize: "0.75rem", display: "grid", gap: "0.125rem" }}>
      {PLATFORM_LABELS.flatMap(([key, label]) =>
        platform[key]
          ? [
              <div key={key}>
                <dt style={{ display: "inline", fontWeight: 600 }}>{label}: </dt>
                <dd style={{ display: "inline", margin: 0, wordBreak: "break-all" }}>
                  {platform[key]}
                </dd>
              </div>,
            ]
          : [],
      )}
    </dl>
  );
}

function NewProfileDialog({
  platform,
  onCreated,
}: {
  platform?: PlatformInfo;
  onCreated: (info: ContextInfo) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [users, setUsers] = useState<string[]>();
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>();
  const [name, setName] = useState("");
  const [user, setUser] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [permission, setPermission] = useState<"write" | "read">("write");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const latestUser = useRef("");

  const open = () => {
    setError(undefined);
    void fetch("/api/accounts")
      .then((response) => response.json() as Promise<{ users: string[] }>)
      .then((body) => setUsers(body.users))
      .catch((e: unknown) => setError(String(e)));
    ref.current?.showModal();
  };

  const chooseUser = (value: string) => {
    latestUser.current = value;
    setUser(value);
    setWorkspaceId("");
    setWorkspaces(undefined);
    setError(undefined);
    if (value === "") return;
    void fetch(`/api/accounts/workspaces?user=${encodeURIComponent(value)}`)
      .then(
        (response) =>
          response.json() as Promise<{ id: string; name: string }[] | { error: string }>,
      )
      .then((body) => {
        if (latestUser.current !== value) return;
        if ("error" in body) setError(body.error);
        else setWorkspaces(body);
      })
      .catch((e: unknown) => {
        if (latestUser.current === value) setError(String(e));
      });
  };

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, user, workspaceId, permission }),
      });
      const body = (await response.json()) as ContextInfo | { error: string };
      if ("error" in body) setError(body.error);
      else {
        onCreated(body);
        ref.current?.close();
        setName("");
        chooseUser("");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "0.25rem",
    fontSize: "0.8125rem",
  } as const;
  const canCreate = name.trim() !== "" && user !== "" && workspaceId !== "" && !busy;

  return (
    <>
      <button
        type="button"
        onClick={open}
        style={{
          border: "1px solid rgba(255, 255, 255, 0.7)",
          background: "transparent",
          color: "inherit",
          borderRadius: 4,
          padding: "0.125rem 0.5rem",
          cursor: "pointer",
        }}
      >
        New profile
      </button>
      <dialog
        ref={ref}
        style={{
          position: "fixed",
          inset: 0,
          margin: "auto",
          borderRadius: 8,
          border: 0,
          padding: "1.25rem",
          width: 420,
          maxWidth: "90vw",
          height: "fit-content",
          background: "#fff",
          color: "#111",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.35)",
        }}
      >
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "0.75rem" }}
        >
          <strong>New profile</strong>
          {platform ? <PlatformDetails platform={platform} /> : null}
          <label style={field}>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </label>
          <label style={field}>
            User
            <select value={user} onChange={(event) => chooseUser(event.target.value)}>
              <option value="">
                {users?.length === 0 ? "No logged-in user: run `tailor login`" : "Select a user…"}
              </option>
              {users?.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label style={field}>
            Workspace
            <select
              value={workspaceId}
              disabled={workspaces === undefined}
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              <option value="">
                {user !== "" && workspaces === undefined ? "Loading…" : "Select a workspace…"}
              </option>
              {workspaces?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.id})
                </option>
              ))}
            </select>
          </label>
          <label style={field}>
            Permission
            <select
              value={permission}
              onChange={(event) => setPermission(event.target.value as "write" | "read")}
            >
              <option value="write">write</option>
              <option value="read">read (blocks write commands)</option>
            </select>
          </label>
          {error ? <span style={{ color: "#b91c1c", fontSize: "0.8125rem" }}>{error}</span> : null}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <button type="submit" disabled={!canCreate}>
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function StudioHeader() {
  const [info, setInfo] = useState<ContextInfo>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const load = () =>
      void fetch("/api/context")
        .then((response) => response.json() as Promise<ContextInfo | { error: string }>)
        .then((body) => {
          if ("error" in body) setError(body.error);
          else {
            setError(undefined);
            setInfo(body);
          }
        })
        .catch((e: unknown) => setError(String(e)));
    load();
    const events = new EventSource("/api/context/events");
    events.addEventListener("changed", load);
    return () => events.close();
  }, []);

  const select = async (profile: string) => {
    if (!info) return;
    const response = await fetch("/api/context", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: profile === "" ? null : profile }),
    });
    const body = (await response.json()) as ContextInfo | { error: string };
    if ("error" in body) setError(body.error);
    else {
      setError(undefined);
      setInfo(body);
    }
  };

  const selected = info?.selected;
  const colors =
    selected?.profile || selected?.workspaceId ? BAR_COLORS.selected : BAR_COLORS.unselected;
  const hasProfile = info?.profiles.some((p) => p.name === selected?.profile) ?? false;

  return (
    <header
      style={{
        ...colors,
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.375rem 1rem",
        fontSize: "0.8125rem",
        flexShrink: 0,
      }}
    >
      <GlobalHeaderLayout.Trigger />
      <strong>Tailor Studio</strong>
      {info?.platform ? (
        <span
          title={platformSummary(info.platform)}
          style={{
            border: "1px solid rgba(255, 255, 255, 0.7)",
            borderRadius: 4,
            padding: "0 0.5rem",
            cursor: "help",
          }}
        >
          platform: {info.platform.platformUrl ?? "custom settings"}
        </span>
      ) : null}
      <select
        aria-label="Profile"
        value={hasProfile ? selected?.profile : ""}
        disabled={!info}
        onChange={(event) => void select(event.target.value)}
        style={{
          border: 0,
          background: "#fff",
          color: "#111",
          borderRadius: 4,
          padding: "0.125rem 0.5rem",
        }}
      >
        <option value="">Select a profile…</option>
        {info?.profiles.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      {info ? <NewProfileDialog platform={info.platform} onCreated={setInfo} /> : null}
      {selected?.workspaceId ? (
        <span style={{ opacity: 0.85 }}>
          workspace: <code>{selected.workspaceId}</code>
        </span>
      ) : null}
      {error ? <span style={{ marginLeft: "auto" }}>{error}</span> : null}
    </header>
  );
}

function TabPage({ tab }: { tab: TabInfo }) {
  if (tab.state === "mounted") {
    return (
      <iframe
        title={tab.title}
        src={`/plugins/${tab.id}/`}
        style={{ display: "block", border: 0, width: "100%", height: "100%" }}
      />
    );
  }
  if (tab.state === "not-installed") {
    return (
      <div style={{ padding: "1.5rem" }}>
        <p>{tab.title} is not installed. Install it to show it here:</p>
        <pre>
          <code>{tab.installCommand}</code>
        </pre>
      </div>
    );
  }
  return (
    <p style={{ padding: "1.5rem" }}>
      The installed version of {tab.title} does not provide a UI yet. Update it to show it here.
    </p>
  );
}

async function main() {
  const response = await fetch("/api/tabs");
  const tabs = (await response.json()) as TabInfo[];
  if (window.location.pathname === "/" && tabs[0]) {
    window.history.replaceState(null, "", `/${tabs[0].id}`);
  }
  const modules = tabs.map((tab) =>
    defineModule({
      path: tab.id,
      component: () => <TabPage tab={tab} />,
      meta: { title: tab.title },
      resources: [],
    }),
  );

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppShell title="Tailor Studio" modules={modules}>
        <GlobalHeaderLayout
          header={<StudioHeader />}
          sidebar={<GlobalHeaderLayout.DefaultSidebar footer={<div />} />}
          body={
            <main style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}>
              <GlobalHeaderLayout.Outlet />
            </main>
          }
        />
      </AppShell>
    </StrictMode>,
  );
}

void main();
