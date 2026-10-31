// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));   // src/
const read = (p: string) => readFileSync(`${root}${p}`, "utf8");

// Screens whose buttons, fields and modals all come from the kit.
const MIGRATED = [
  "app/login/page.tsx", "app/(app)/account/settings/page.tsx", "app/(app)/account/page.tsx",
  "components/hero/HeroArea.tsx", "components/hero/HeroHeader.tsx", "components/hero/ForgeTab.tsx",
  "components/ProviderPicker.tsx", "components/ErrorBoundary.tsx",
];

function walk(dir: string, out: string[] = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("UI kit usage", () => {
  it.each(MIGRATED)("%s defines no raw <button>/<input>/<select>/<textarea> or control styling of its own", (file) => {
    const text = read(file);
    expect(text).not.toMatch(/<(button|input|select|textarea)\b/);
    expect(text).not.toMatch(/focus:(ring|border)-/);        // the old per-page input/button focus styling
    expect(text).not.toMatch(/position:\s*"fixed"[^}]*inset|zIndex:\s*9999/);   // hand-rolled modal overlay
  });

  it("only the kit's Toast touches the toast library, and nothing imports it any more", () => {
    const offenders = walk(root.replace(/\/$/, ""))
      .filter(f => !/\.test\./.test(f))
      .filter(f => /from ["']sonner["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the kit's styles use no raw colours and no gradient literals (gradients come from the --gradient-* tokens)", () => {
    const css = read("components/ui/ui.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient\(/);
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(css.match(/rgba?\([^)]*\)/g) ?? []).toEqual([]);
  });

  it("the dev kit page is a page.dev.tsx, which next.config.ts only counts as a page outside production", () => {
    const config = readFileSync(fileURLToPath(new URL("../../../next.config.ts", import.meta.url)), "utf8");
    expect(config).toMatch(/process\.env\.NODE_ENV === "production" \? \[\] : \["dev\.tsx"\]/);
    expect(readdirSync(`${root}app/dev/kit`)).toEqual(["page.dev.tsx"]);
  });
});
