/**
 * DemoPage — showcases all built UI components with mock data.
 */

import { useState } from "react";
import { Button } from "../components/primitives/Button.js";
import { Spinner } from "../components/primitives/Spinner.js";
import { StatusDot } from "../components/primitives/StatusDot.js";
import { StatusBadge } from "../components/primitives/StatusBadge.js";
import { Avatar } from "../components/primitives/Avatar.js";
import { TextInput } from "../components/primitives/TextInput.js";
import { Switch } from "../components/primitives/Switch.js";
import { Divider } from "../components/primitives/Divider.js";
import { Composer } from "../components/timeline/Composer.js";
import { Explorer } from "../components/panels/Explorer.js";
import { lazy, Suspense } from "react";
const TerminalPane = lazy(() => import("../components/panels/TerminalPane.js").then((m) => ({ default: m.TerminalPane })));
import { SubagentsTrack } from "../components/panels/SubagentsTrack.js";
const BrowserPane = lazy(() => import("../components/panels/BrowserPane.js").then((m) => ({ default: m.BrowserPane })));
import {
  INITIAL_EXPLORER_STATE,
  buildNodes,
  type ExplorerEntry,
  type ExplorerState,
  toggleExpand,
  cycleSortMode,
} from "../panels/file-explorer.js";
import { INITIAL_TERMINAL_PANE } from "../panels/terminal-pane.js";

const MOCK_FILES: ExplorerEntry[] = [
  { name: "src", path: "/src", kind: "directory" },
  { name: "package.json", path: "/package.json", kind: "file", size: 1200 },
  { name: "README.md", path: "/README.md", kind: "file", size: 3400 },
  { name: "tsconfig.json", path: "/tsconfig.json", kind: "file", size: 450 },
  { name: "vite.config.ts", path: "/vite.config.ts", kind: "file", size: 200 },
  { name: ".gitignore", path: "/.gitignore", kind: "file", size: 50 },
];

export function DemoPage() {
  const [switchVal, setSwitchVal] = useState(false);
  const [explorerState, setExplorerState] = useState<ExplorerState>(() => ({
    ...INITIAL_EXPLORER_STATE,
    root: buildNodes(MOCK_FILES, 0, new Set(), "name"),
  }));

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 24px" }}>Pi-Studio UI Demo</h1>

      {/* Primitives */}
      <Section title="Buttons">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Button>Default</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Status & Avatars">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <StatusDot status="running" />
          <StatusDot status="idle" />
          <StatusDot status="waiting" />
          <StatusBadge variant="success" label="Running" />
          <StatusBadge variant="muted" label="Idle" />
          <StatusBadge variant="error" label="Error" />
          <Avatar projectKey="pi-studio" size={32} />
          <Avatar projectKey="my-app" size={32} />
          <Spinner size="sm" />
          <Spinner size="md" />
        </div>
      </Section>

      <Section title="Inputs">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <TextInput placeholder="Type something…" />
          <Switch checked={switchVal} onCheckedChange={setSwitchVal} />
          <span style={{ fontSize: 12, color: "var(--pi-color-foregroundMuted)" }}>{switchVal ? "On" : "Off"}</span>
        </div>
      </Section>

      <Divider />

      {/* Composer */}
      <Section title="Composer">
        <div style={{ border: "1px solid var(--pi-color-border)", borderRadius: "var(--pi-radius-base)" }}>
          <SubagentsTrack
            entries={[
              { agentId: "sub-1", parentAgentId: "main", title: "Research Agent", status: "running", createdAt: 1, isArchived: false, isPendingArchive: false },
              { agentId: "sub-2", parentAgentId: "main", title: "Code Writer", status: "needs_attention", createdAt: 2, isArchived: false, isPendingArchive: false },
            ]}
            expanded={true}
            onToggleExpand={() => {}}
            onSelect={(id) => console.log("select", id)}
            onArchive={(id) => console.log("archive", id)}
          />
          <Composer
            agentRunning={false}
            onSubmit={(text) => console.log("submit:", text)}
            initialDraft=""
            providerUsageLabel="Claude Sonnet 4 · $0.02"
          />
        </div>
      </Section>

      <Divider />

      {/* Explorer */}
      <Section title="File Explorer">
        <div style={{ height: 250, border: "1px solid var(--pi-color-border)", borderRadius: "var(--pi-radius-base)", overflow: "hidden" }}>
          <Explorer
            state={explorerState}
            onToggleExpand={(path) => setExplorerState((s) => toggleExpand(s, path))}
            onOpenFile={(path) => console.log("open:", path)}
            onRefresh={() => console.log("refresh")}
            onCycleSortMode={() => setExplorerState((s) => ({ ...s, sortMode: cycleSortMode(s.sortMode) }))}
          />
        </div>
      </Section>

      {/* Terminal */}
      <Section title="Terminal Pane">
        <div style={{ height: 180, border: "1px solid var(--pi-color-border)", borderRadius: "var(--pi-radius-base)", overflow: "hidden" }}>
          <Suspense fallback={<Spinner size="sm" />}>
            <TerminalPane
              state={INITIAL_TERMINAL_PANE}
              isClaiming
              showKeyBar
              onInput={(data) => console.log("input:", data)}
              onResize={(r) => console.log("resize:", r)}
            />
          </Suspense>
        </div>
      </Section>

      {/* Browser (web placeholder) */}
      <Section title="Browser Pane (web = placeholder)">
        <div style={{ height: 150, border: "1px solid var(--pi-color-border)", borderRadius: "var(--pi-radius-base)", overflow: "hidden" }}>
          <Suspense fallback={<Spinner size="sm" />}>
            <BrowserPane isElectron={false} />
          </Suspense>
        </div>
      </Section>

      <Divider />
      <p style={{ fontSize: 11, color: "var(--pi-color-foregroundMuted)", marginTop: 16 }}>
        Navigate using the sidebar or visit: /welcome, /sessions, /schedules, /settings, /new, /open-project
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 10px", color: "var(--pi-color-foregroundMuted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</h3>
      {children}
    </div>
  );
}
