import { useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell, Check, Settings } from "lucide-react";
import {
  Avatar,
  Button,
  Checkbox,
  Combobox,
  Dialog,
  DialogClose,
  Divider,
  EmptyState,
  Icon,
  IconButton,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  Panel,
  Popover,
  PopoverContent,
  ScrollArea,
  Select,
  ShortcutHint,
  Spinner,
  StatusBadge,
  StatusDot,
  Surface,
  Switch,
  TextArea,
  TextInput,
  THEME_NAMES,
  speak,
  useAppearance,
  useAppearanceControls,
  useToastStore,
  type ButtonVariant,
  type StatusBadgeVariant,
  type SurfaceElevation,
} from "@av-pi-studio/ui-library";

const BUTTON_VARIANTS: ButtonVariant[] = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
];
const BADGE_VARIANTS: StatusBadgeVariant[] = ["success", "error", "warning", "muted"];
const STATUSES = ["idle", "running", "waiting", "finished", "error", "queued", "archived"] as const;
const ELEVATIONS: SurfaceElevation[] = [0, 1, 2, 3, 4];
const SELECT_OPTIONS = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
];
const COMBO_OPTIONS = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
  { value: "gamma", label: "Gamma" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section" data-gallery-section={title}>
      <h2 className="sectionTitle">{title}</h2>
      {children}
    </section>
  );
}

function ThemeSwitcher() {
  const { mode } = useAppearance();
  const { setMode } = useAppearanceControls();
  return (
    <div className="themes" role="group" aria-label="Theme">
      {THEME_NAMES.map((name) => (
        <Button
          key={name}
          size="sm"
          variant={mode === name ? "default" : "outline"}
          data-theme-button={name}
          onClick={() => setMode(name)}
        >
          {name}
        </Button>
      ))}
    </div>
  );
}

export function App() {
  const [checked, setChecked] = useState(true);
  const [switched, setSwitched] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [combo, setCombo] = useState("alpha");
  const showToast = useToastStore((s) => s.show);

  return (
    <div className="page">
      <header className="header">
        <h1 className="sectionTitle">Pi-Studio UI gallery</h1>
        <ThemeSwitcher />
      </header>

      <Section title="Button">
        <div className="row">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          <Button size="xs">xs</Button>
          <Button size="sm">sm</Button>
          <Button size="lg">lg</Button>
          <Button disabled>disabled</Button>
        </div>
      </Section>

      <Section title="IconButton / Icon / ShortcutHint">
        <div className="row">
          <IconButton aria-label="Settings">
            <Icon icon={Settings} />
          </IconButton>
          <IconButton aria-label="Notifications">
            <Icon icon={Bell} />
          </IconButton>
          <Icon icon={Check} size="lg" />
          <ShortcutHint combo="cmd+k" />
          <ShortcutHint chord={["cmd+k", "cmd+s"]} os="linux" />
        </div>
      </Section>

      <Section title="Status: StatusDot / StatusBadge / Avatar / Spinner">
        <div className="row">
          {STATUSES.map((status) => (
            <StatusDot key={status} status={status} />
          ))}
          {BADGE_VARIANTS.map((variant) => (
            <StatusBadge key={variant} variant={variant} label={variant} />
          ))}
          <Avatar projectKey="pi-studio" />
          <Avatar projectKey="gallery" size={24} />
          <Spinner />
          <Spinner size="lg" />
        </div>
      </Section>

      <Section title="Inputs: TextInput / TextArea / Checkbox / Switch / Select / Combobox">
        <div className="stack">
          <TextInput placeholder="Text input" />
          <TextArea placeholder="Text area" rows={2} />
          <Checkbox
            label="Checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <Switch aria-label="Switch" checked={switched} onCheckedChange={setSwitched} />
          <Select options={SELECT_OPTIONS} placeholder="Select" defaultValue="" />
          <Combobox
            options={COMBO_OPTIONS}
            value={combo}
            onSelect={setCombo}
            placeholder="Combobox"
          />
        </div>
      </Section>

      <Section title="Surface / Panel / Divider / ScrollArea / EmptyState">
        <div className="row">
          {ELEVATIONS.map((elevation) => (
            <Surface key={elevation} elevation={elevation} className="box">
              elevation {elevation}
            </Surface>
          ))}
        </div>
        <Divider />
        <Panel className="box">Panel</Panel>
        <ScrollArea style={{ height: 64 }}>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i}>Scroll row {i + 1}</div>
          ))}
        </ScrollArea>
        <EmptyState>Nothing here yet</EmptyState>
      </Section>

      <Section title="Overlays: Dialog / Popover / Menu">
        <div className="row">
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Dialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            title="Dialog"
            footer={
              <DialogClose asChild>
                <Button>Close</Button>
              </DialogClose>
            }
          >
            Dialog body
          </Dialog>

          <Popover.Root>
            <Popover.Trigger asChild>
              <Button variant="outline">Popover</Button>
            </Popover.Trigger>
            <PopoverContent>Popover content</PopoverContent>
          </Popover.Root>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="outline">Menu</Button>
            </DropdownMenu.Trigger>
            <MenuContent>
              <MenuGroup label="Group">
                <MenuItem>First</MenuItem>
                <MenuItem>Second</MenuItem>
              </MenuGroup>
              <MenuSeparator />
              <MenuItem danger>Delete</MenuItem>
            </MenuContent>
          </DropdownMenu.Root>
        </div>
      </Section>

      <Section title="Feedback: toast / announcer">
        <div className="row">
          <Button onClick={() => showToast("Saved", { variant: "success" })} data-gallery="toast">
            Show toast
          </Button>
          <Button variant="outline" onClick={() => speak("Gallery announcement")}>
            Announce
          </Button>
        </div>
      </Section>
    </div>
  );
}
