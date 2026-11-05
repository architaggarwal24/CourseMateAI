// Draws every brand image from the mark in src/components/brand/Logo.tsx: the theme-aware favicon (src/app/icon.svg),
// favicon.ico, the app icons, the Apple touch icon and the link preview (src/app/opengraph-image.png).
// Run after changing the mark:   node scripts/brand-assets.mjs     (uses Playwright's Chromium, as the e2e tests do)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const logo = readFileSync(join(ROOT, "src/components/brand/Logo.tsx"), "utf8");
const C = logo.match(/c: "([^"]+)"/)[1];
const STROKE = Number(logo.match(/stroke: ([\d.]+)/)[1]);
const [CX, CY, R] = logo.match(/dot: \{ cx: ([\d.]+), cy: ([\d.]+), r: ([\d.]+) \}/).slice(1).map(Number);

const INK = "#000000", PAPER = "#ffffff", BLUE = "#3550c8", BLUE_TEXT = "#8a9df2";
const mark = (fg, dot = BLUE) =>
  `<path d="${C}" fill="none" stroke="${fg}" stroke-width="${STROKE}" stroke-linecap="round"/><circle cx="${CX}" cy="${CY}" r="${R}" fill="${dot}"/>`;

// 1. the favicon modern browsers use: ink C on a light tab bar, white C on a dark one
writeFileSync(join(ROOT, "src/app/icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>path{stroke:#0a0a0a}@media (prefers-color-scheme: dark){path{stroke:#ffffff}}</style>` +
  `<path d="${C}" fill="none" stroke-width="${STROKE}" stroke-linecap="round"/><circle cx="${CX}" cy="${CY}" r="${R}" fill="${BLUE}"/></svg>\n`);

// A tile: the mark at `scale` of the tile, on ink; rounded unless the platform rounds it itself.
const tile = (size, { scale = 0.62, radius = 0.22 } = {}) => {
  const m = size * scale, off = (size - m) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${INK}"/>` +
    `<g transform="translate(${off} ${off}) scale(${m / 32})">${mark(PAPER)}</g></svg>`;
};

const font = (file) => `data:font/woff2;base64,${readFileSync(join(ROOT, "src/fonts", file)).toString("base64")}`;
const og = `<!doctype html><html><head><style>
@font-face { font-family: B; src: url(${font("BricolageGrotesque-Variable.woff2")}); font-weight: 200 800; }
@font-face { font-family: O; src: url(${font("Onest-Variable.woff2")}); font-weight: 100 900; }
html, body { margin: 0; width: 1200px; height: 630px; background: ${INK}; color: ${PAPER}; }
body { display: grid; align-content: center; gap: 36px; padding: 0 96px; box-sizing: border-box; font-family: O, sans-serif; }
.lock { display: flex; align-items: center; gap: 32px; }
.word { font-family: B, sans-serif; font-weight: 700; font-size: 104px; letter-spacing: -0.035em; line-height: 1; }
.word span { color: ${BLUE_TEXT}; }
p { margin: 0; font-size: 40px; color: #d4d4d4; max-width: 24ch; line-height: 1.25; }
small { font-size: 26px; color: #a3a3a3; letter-spacing: 0.01em; }
</style></head><body>
<div class="lock"><svg width="128" height="128" viewBox="0 0 32 32">${mark(PAPER)}</svg><div class="word">CourseMate<span>AI</span></div></div>
<p>Your PDFs as a study companion.</p>
<small>Chat · Quizzes · Flashcards · Exams · Boss arena</small>
</body></html>`;

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(html, w, h, transparent = true) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html.startsWith("<!doctype") ? html : `<html><body style="margin:0;background:transparent">${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}
const out = (rel, buf) => { writeFileSync(join(ROOT, rel), buf); console.log("wrote", rel); };

out("public/icons/icon-192.png", await png(tile(192), 192, 192));
out("public/icons/icon-512.png", await png(tile(512), 512, 512));
out("public/icons/maskable-512.png", await png(tile(512, { scale: 0.5, radius: 0 }), 512, 512, false));   // inside the 80% safe zone
out("public/icons/apple-touch-icon.png", await png(tile(180, { scale: 0.58, radius: 0 }), 180, 180, false)); // iOS rounds it
out("src/app/opengraph-image.png", await png(og, 1200, 630, false));

// favicon.ico for old browsers: PNG-in-ICO at 16, 32 and 48 px
const sizes = [16, 32, 48];
const images = [];
for (const s of sizes) images.push(await png(tile(s, { scale: s === 16 ? 0.86 : 0.74, radius: 0.2 }), s, s));   // bigger at 16px so the dot survives
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
out("public/favicon.ico", Buffer.concat([header, ...images]));
await browser.close();
