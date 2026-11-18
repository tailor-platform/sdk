import "@tailor-platform/app-shell/styles";
import { AppShell, SidebarLayout, defineModule } from "@tailor-platform/app-shell";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

type TabInfo =
  | { id: string; title: string; state: "mounted" }
  | { id: string; title: string; state: "not-installed"; installCommand: string }
  | { id: string; title: string; state: "no-ui-support" };

function TabPage({ tab }: { tab: TabInfo }) {
  if (tab.state === "mounted") {
    return (
      <iframe
        title={tab.title}
        src={`/plugins/${tab.id}/`}
        style={{ border: 0, width: "100%", height: "calc(100vh - 6rem)" }}
      />
    );
  }
  if (tab.state === "not-installed") {
    return (
      <div>
        <p>{tab.title} is not installed. Install it to show it here:</p>
        <pre>
          <code>{tab.installCommand}</code>
        </pre>
      </div>
    );
  }
  return (
    <p>
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
        <SidebarLayout />
      </AppShell>
    </StrictMode>,
  );
}

void main();
