import "@tailor-platform/app-shell/styles";
import { AppShell, GlobalHeaderLayout, defineModule } from "@tailor-platform/app-shell";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

type TabInfo =
  | { id: string; title: string; state: "mounted" }
  | { id: string; title: string; state: "not-installed"; installCommand: string }
  | { id: string; title: string; state: "no-ui-support" };

type ContextInfo = {
  token: string;
  profiles: { name: string; workspaceId: string }[];
  selected: { profile?: string; workspaceId?: string };
};

const BAR_COLORS = {
  selected: { background: "#535ae8", color: "#fff" },
  unselected: { background: "#475569", color: "#fff" },
};

function StudioHeader() {
  const [info, setInfo] = useState<ContextInfo>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void fetch("/api/context")
      .then((response) => response.json() as Promise<ContextInfo | { error: string }>)
      .then((body) => ("error" in body ? setError(body.error) : setInfo(body)))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const select = async (profile: string) => {
    if (!info) return;
    const response = await fetch("/api/context", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-tailor-studio-token": info.token },
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
        <option value="">
          {selected?.workspaceId && !hasProfile ? "(from options)" : "Select a profile…"}
        </option>
        {info?.profiles.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <code style={{ opacity: 0.85 }}>{selected?.workspaceId ?? "no workspace selected"}</code>
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
