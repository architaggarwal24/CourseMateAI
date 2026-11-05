"use client";

// Dev-only (see pageExtensions in next.config.ts): every UI-kit component, once per theme scope.
import { useRef, useState } from "react";
import { Inbox, Search } from "lucide-react";
import ThemeScope, { type Theme } from "@/components/ThemeScope";
import { AnimatedNumber, Aurora, Magnetic, Spotlight, Starfield, TextReveal, TiltCard } from "@/components/fx";
import {
  Badge, Button, Card, Checkbox, EmptyState, Input, Modal, Select, Skeleton, Tabs, Textarea, Tooltip, toast,
  type BadgeTone,
} from "@/components/ui";

const TONES: BadgeTone[] = ["neutral", "accent", "success", "warning", "danger", "reward", "common", "rare", "epic", "legendary"];

function Showcase({ theme }: { theme: Theme }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState("one");
  const [name, setName] = useState("");
  const safe = useRef<HTMLButtonElement>(null);

  return (
    <ThemeScope theme={theme}>
      <section
        aria-label={`${theme} theme`}
        style={{ background: "var(--gradient-page), var(--color-surface)", color: "var(--color-text)", padding: "var(--space-5)" }}
        className="space-y-6 relative isolate overflow-hidden"
      >
        <div className="absolute inset-0 -z-10" aria-hidden="true"><Aurora />{theme === "play" && <Starfield />}</div>
        <TextReveal as="h2" className="text-3xl font-bold text-gradient" text={theme === "study" ? "Study — graphite glass" : "Play — arcane glass"} />

        <Card title="Effects">
          <div className="grid gap-4 md:grid-cols-3">
            <Card interactive pad="lg"><p className="font-semibold">Spotlight card</p><p className="text-fg-muted text-sm">Move the pointer over me.</p></Card>
            <TiltCard className="ui-card ui-card--pad-lg"><p className="font-semibold">Tilt card</p><p className="text-fg-muted text-sm">3D tilt + glare.</p></TiltCard>
            <Spotlight className="ui-card ui-card--pad-lg fx-beam"><p className="font-semibold">Border beam</p><p className="text-fg-muted text-sm">A light runs round the edge.</p></Spotlight>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Magnetic><Button variant="primary" size="lg">Magnetic primary</Button></Magnetic>
            <Button variant="reward">Claim reward (sparks)</Button>
            <span className="text-2xl font-bold font-num"><AnimatedNumber value={on ? 1450 : 320} /> XP</span>
            <span className="fx-shiny text-lg font-semibold">Shiny text</span>
            <span className="kbd">⌘</span><span className="kbd">K</span>
          </div>
        </Card>

        <Card title="Buttons">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
            <Button variant="primary" loading>Loading</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm">Small</Button>
            <Button pressed>Pressed</Button>
          </div>
        </Card>

        <Card title="Fields">
          <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="Type here" hint="A hint under the field" />
          <Input label="With an icon" leading={<Search size={16} />} placeholder="Search" />
          <Input label="With an error" defaultValue="oops" error="This value is not allowed" />
          <Input label="Disabled" disabled defaultValue="Can't edit" />
          <Select label="Select" defaultValue="b">
            <option value="a">Option A</option>
            <option value="b">Option B</option>
          </Select>
          <Textarea label="Textarea" placeholder="Longer text" />
          <Checkbox label="Checkbox" description="With a description" defaultChecked />
          <Checkbox appearance="switch" label="Switch" checked={on} onChange={e => setOn(e.target.checked)} />
        </Card>

        <Card title="Tabs">
          <Tabs label={`${theme} demo tabs`} value={tab} onChange={setTab} tabs={[
            { id: "one", label: "One", content: <p>First panel</p> },
            { id: "two", label: "Two", content: <p>Second panel</p> },
            { id: "three", label: "Disabled", disabled: true, content: <p>Never shown</p> },
            { id: "four", label: "Four", content: <p>Fourth panel</p> },
          ]} />
        </Card>

        <Card title="Badges, tooltip, toast, modal">
          <div className="flex flex-wrap gap-2">{TONES.map(t => <Badge key={t} tone={t}>{t}</Badge>)}</div>
          <div className="flex flex-wrap gap-2">
            <Tooltip content="A tooltip on hover and focus"><Button>Hover or focus me</Button></Tooltip>
            <Button onClick={() => toast.success("Saved", { description: "Everything is up to date" })}>Success toast</Button>
            <Button onClick={() => toast.error("Something failed")}>Error toast</Button>
            <Button onClick={() => toast.info("For your information")}>Info toast</Button>
            <Button variant="primary" onClick={() => setOpen(true)}>Open modal</Button>
          </div>
        </Card>

        <Card title="Skeleton and empty state">
          <div className="space-y-2">
            <Skeleton width="60%" />
            <Skeleton height="2rem" />
            <Skeleton width="3rem" height="3rem" circle />
          </div>
          <EmptyState icon={<Inbox size={32} />} title="Nothing here yet" description="Upload a PDF to get started."
            action={<Button variant="primary">Upload</Button>} />
        </Card>

        <Modal open={open} onClose={() => setOpen(false)} title="Discard changes?" initialFocusRef={safe}
          actions={<>
            <Button variant="danger" onClick={() => setOpen(false)}>Discard</Button>
            <Button ref={safe} onClick={() => setOpen(false)}>Keep editing</Button>
          </>}>
          Tab and Shift+Tab stay inside this dialog; Escape closes it.
        </Modal>
      </section>
    </ThemeScope>
  );
}

export default function KitPage() {
  return (
    <div className="grid gap-px lg:grid-cols-2" style={{ background: "var(--color-border)" }}>
      <Showcase theme="study" />
      <Showcase theme="play" />
    </div>
  );
}
