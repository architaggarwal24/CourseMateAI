// Checks (and where it is safe, repairs) a frontend folder after applying the redesign zips.
//   node scripts/doctor.mjs
// It never deletes anything you wrote; it only rewrites postcss.config.js when that file is the old Tailwind 3 one.
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
let problems = 0;
const ok = (m) => console.log("  ok      " + m);
const bad = (m) => { problems++; console.log("  FIX     " + m); };
const did = (m) => console.log("  fixed   " + m);

console.log("\nCourseMateAI frontend doctor\n");

// 1. package.json is the redesign's one
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const want = { "next": "16.4", "react": "19.", "tailwindcss": "4.", "@tailwindcss/postcss": "4.", "tw-animate-css": "1.", "motion": "14.", "three": "0.18" };
const all = { ...pkg.dependencies, ...pkg.devDependencies };
if (!all["@tailwindcss/postcss"] || !all["tw-animate-css"]) bad("package.json is the OLD one: unzip the Stage 1 (or the cumulative) zip again, then run npm install");
else ok("package.json lists the redesign's packages");

// 2. PostCSS config: exactly one, the Tailwind 4 plugin
const pcJs = join(root, "postcss.config.js");
const PC = `// Tailwind CSS v4: one PostCSS plugin (it also handles vendor prefixes, so autoprefixer is no longer needed).
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
`;
const current = existsSync(pcJs) ? readFileSync(pcJs, "utf8") : "";
if (!current.includes("@tailwindcss/postcss")) { writeFileSync(pcJs, PC); did("postcss.config.js now uses @tailwindcss/postcss (it was " + (current ? "the Tailwind 3 one" : "missing") + ")"); }
else ok("postcss.config.js uses @tailwindcss/postcss");
for (const extra of ["postcss.config.mjs", "postcss.config.cjs", ".postcssrc", ".postcssrc.json", "tailwind.config.js", "tailwind.config.ts"]) {
  if (existsSync(join(root, extra))) { rmSync(join(root, extra)); did(`removed ${extra} (a second / old config confuses the build)`); }
}

// 3. node_modules actually has them, at the right major versions
let missing = false;
for (const [name, prefix] of Object.entries(want)) {
  try {
    // read the file directly: some packages' "exports" hide their package.json from require()
    const v = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version;
    if (!v.startsWith(prefix)) { bad(`${name} ${v} is installed, the redesign needs ${prefix}x`); missing = true; }
  } catch { bad(`${name} is not installed`); missing = true; }
}
if (!missing) ok("node_modules has Next 16.4, React 19, Tailwind 4, tw-animate-css, motion, three");

// 4. stale files from before the redesign
for (const rel of ["src/components/arena/BossCanvas.tsx", "src/fonts/inter.ts", "undefined"]) {
  if (existsSync(join(root, rel))) { rmSync(join(root, rel), { recursive: true, force: true }); did(`removed ${rel}`); }
}

console.log("");
if (missing) {
  console.log("Next step - a clean install (keeps your package-lock.json from the zip):");
  console.log("   PowerShell:  Remove-Item -Recurse -Force node_modules, .next; npm install");
  console.log("   bash:        rm -rf node_modules .next && npm install");
  console.log("then run this doctor again, then: npm run build\n");
} else if (problems) {
  console.log("Fix the lines marked FIX above, then run this again.\n");
} else {
  console.log("All good. Now: npm run build\n");
}
process.exitCode = problems ? 1 : 0;
