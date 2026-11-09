# CourseMateAI: SEO checklist

Step-by-step checks for the SEO P0 work: the live address, metadata, robots.txt, sitemap, noindex, structured data and social previews. These steps are for Windows PowerShell, from the project folder (`C:\Archit\Projects\CourseMateAI`).

Live address used everywhere below: **https://coursemateai.architaggarwal.workers.dev**

> Nothing here guarantees rankings or indexing. Google and Bing decide what to index and how to rank it. These checks make sure the site is correct, crawlable and safe to index.

---

## 0. Fix the build error first

The error `NEXT_PUBLIC_SITE_URL must be set for a production build` is the safety check working. A production build refuses to run without the live address, so a wrong or localhost address can never go live. `npm run dev` doesn't need it. Only builds do.

### Option A: one-time setup (recommended)

Create `.env.production` next to `package.json`. Next.js reads it on every production build, and git ignores it.

```powershell
Set-Content -Path .env.production -Value "NEXT_PUBLIC_SITE_URL=https://coursemateai.architaggarwal.workers.dev" -Encoding ascii
Get-Content .env.production
```

You should see the one line printed back.

### Option B: just for this terminal window

```powershell
$env:NEXT_PUBLIC_SITE_URL = "https://coursemateai.architaggarwal.workers.dev"
```

### Then build again

```powershell
npm run build
npx opennextjs-cloudflare build
```

- ✅ **Pass:** the build output's first lines include `- Environments: .env.local, .env.production` (with option A), and the route list shows `○ /robots.txt` and `○ /sitemap.xml`.
- ❌ **Fail: "must use https"** means the value starts with `http://`. Use `https://`.
- ❌ **Fail: "just the origin"** means there is a path or a slash plus more after the domain. Use only `https://coursemateai.architaggarwal.workers.dev`.

**GitHub deploys:** the deploy job in `.github/workflows/ci.yml` already sets the variable, so there is nothing to do there.

---

## 1. Check locally before deploying

### 1.1 Tests

```powershell
npm run check
npx playwright test e2e/seo.spec.ts --project=desktop
```

- ✅ **Pass:** `npm run check` shows all tests passed, and Playwright shows `19 passed`. Playwright builds the app itself the first time, which takes a few minutes.

### 1.2 Run the production build and look at it

Run this in one terminal and leave it running:

```powershell
npm run build
npx next start -p 3000
```

Then run each check below in a **second** terminal.

#### a) robots.txt

```powershell
curl.exe -s http://localhost:3000/robots.txt
```

✅ **Expected:**

```
User-Agent: *
Allow: /
Disallow: /api/

Sitemap: https://coursemateai.architaggarwal.workers.dev/sitemap.xml
```

#### b) sitemap.xml lists only the 4 public pages

```powershell
curl.exe -s http://localhost:3000/sitemap.xml
```

✅ **Expected:** exactly these 4 `<loc>` entries, all on the live address (not localhost):

- `https://coursemateai.architaggarwal.workers.dev/`
- `https://coursemateai.architaggarwal.workers.dev/legal/terms`
- `https://coursemateai.architaggarwal.workers.dev/legal/privacy`
- `https://coursemateai.architaggarwal.workers.dev/legal/refunds`

❌ **Fail:** anything with `/study`, `/account`, `/today`, `/hero`, `/login`, `/offline` or `/api`.

#### c) Each public page's title, description, canonical and social tags

Run this for each of `/`, `/legal/terms`, `/legal/privacy` and `/legal/refunds`:

```powershell
$p = "/legal/privacy"
(curl.exe -s "http://localhost:3000$p") -split "><" | Select-String -Pattern 'title>|name="description"|rel="canonical"|name="robots"|og:title|og:url|og:image"|twitter:card'
```

✅ **Expected for `/legal/privacy`:**

| Tag | Value |
|---|---|
| `title` | `Privacy Policy \| CourseMateAI` |
| `description` | one line about what is collected |
| `canonical` | `https://coursemateai.architaggarwal.workers.dev/legal/privacy` |
| `robots` | `index, follow` |
| `og:url` | the same as the canonical |
| `og:image` | `https://coursemateai.architaggarwal.workers.dev/opengraph-image.png` |
| `twitter:card` | `summary_large_image` |

Also check:

- The title and description are **different on each of the 4 pages**.
- The canonical for `/` is `https://coursemateai.architaggarwal.workers.dev` (no path).

#### d) Each public page has exactly one H1

```powershell
((curl.exe -s "http://localhost:3000/") | Select-String -Pattern '<h1[\s>]' -AllMatches).Matches.Count
```

✅ **Expected:** `1`. Repeat for the three legal pages.

#### e) Private pages are noindex in both the header and the page

Run this for each of `/study`, `/today`, `/hero`, `/account`, `/login` and `/offline`:

```powershell
$p = "/study"
curl.exe -sI "http://localhost:3000$p" | Select-String "HTTP/|X-Robots-Tag"
(curl.exe -s "http://localhost:3000$p") -split "><" | Select-String 'name="robots"|rel="canonical"'
```

✅ **Expected:**

- `HTTP/1.1 200 OK`
- `X-Robots-Tag: noindex, nofollow`
- `meta name="robots" content="noindex, nofollow"`
- **No** canonical line

#### f) The API says noindex

```powershell
curl.exe -sI http://localhost:3000/api/v1/plans | Select-String "X-Robots-Tag"
```

✅ **Expected:** `X-Robots-Tag: noindex, nofollow`

#### g) The share image works

```powershell
curl.exe -sI http://localhost:3000/opengraph-image.png | Select-String "HTTP/|Content-Type"
```

✅ **Expected:** `200 OK` and `Content-Type: image/png`

#### h) Structured data on the homepage

```powershell
$h = curl.exe -s http://localhost:3000/
[regex]::Match($h, '<script type="application/ld\+json">(.*?)</script>').Groups[1].Value
```

✅ **Expected:** JSON with `"@type":"Organization"` and `"@type":"WebSite"`, name `CourseMateAI`, and url `https://coursemateai.architaggarwal.workers.dev/`.

❌ **Fail:** any rating, review, price or Course entry. None should exist.

#### i) An unknown page is a 404

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/no-such-page
```

✅ **Expected:** `404`

Stop the server with **Ctrl+C** in the first terminal when you're done.

---

## 2. Deploy

Use one of these:

- **Push to `main`** (GitHub deploys it), or
- **From your computer:**

  ```powershell
  npm run cf:deploy
  ```

  `.env.production` from step 0 must exist for this.

---

## 3. Check the live site

Repeat the checks from **1.2** against the live address. In every command, replace `http://localhost:3000` with `https://coursemateai.architaggarwal.workers.dev`. For example:

```powershell
$site = "https://coursemateai.architaggarwal.workers.dev"
curl.exe -s "$site/robots.txt"
curl.exe -s "$site/sitemap.xml"
curl.exe -sI "$site/study" | Select-String "HTTP/|X-Robots-Tag"
curl.exe -sI "$site/opengraph-image.png" | Select-String "HTTP/|Content-Type"
```

### 3.1 Search crawlers aren't blocked by Cloudflare

```powershell
$bot = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
foreach ($p in "/", "/legal/privacy", "/robots.txt", "/sitemap.xml", "/opengraph-image.png") {
  "{0}  {1}" -f (curl.exe -s -o NUL -w "%{http_code}" -A $bot "$site$p"), $p
}
```

✅ **Expected:** `200` for every line.

❌ **If you see `403` or `503`, or the page body says "Just a moment…":**

1. In the Cloudflare dashboard, go to your account → **Security** (or the Worker's zone if you add a domain later) → **Bots** / **WAF**.
2. Make sure "Bot Fight Mode" or any challenge rule doesn't apply to these paths.
3. On a plain `workers.dev` address this usually isn't an issue.

---

## 4. Google Search Console

1. Open **https://search.google.com/search-console** and sign in.
2. Click **Add property** → choose **URL prefix** (not "Domain": a Domain property needs a DNS record, and you can't add one on `workers.dev`).
3. Enter `https://coursemateai.architaggarwal.workers.dev/` → **Continue**.
4. **Verify ownership.** The easiest method without code is **HTML file**:
   1. Download the file Google gives you, e.g. `google1a2b3c4d5e.html`.
   2. Put it in the project's `public\` folder, unchanged.
   3. Deploy (step 2).
   4. Check it opens: `https://coursemateai.architaggarwal.workers.dev/google1a2b3c4d5e.html`
   5. Back in Search Console, click **Verify**.

   *(The "HTML tag" method also works, but it needs a code change: `verification: { google: "<code>" }` in the root `metadata` in `src/app/layout.tsx`. Ask me if you'd rather do that.)*
5. **Submit the sitemap:** left menu → **Sitemaps** → enter `sitemap.xml` → **Submit**.
   - ✅ Status becomes **Success**, with **Discovered pages: 4**. This can take from minutes to a few days.
6. **Inspect URLs:** paste each URL into the search bar at the top, then click **Test live URL**:

   | URL | Expected result |
   |---|---|
   | `/` | "URL is available to Google". Click **Request indexing**. |
   | `/legal/privacy` | "URL is available to Google" |
   | `/study` | "**Excluded by 'noindex' tag**". This is correct. |
   | `/login` | "Excluded by 'noindex' tag". This is correct. |

7. **Later, after 1–2 weeks:**
   - **Indexing → Pages**: the 4 public pages should end up under "Indexed".
   - **Performance**: shows search queries once impressions start.

---

## 5. Bing Webmaster Tools

1. Open **https://www.bing.com/webmasters** and sign in.
2. **Easiest:** choose **Import from Google Search Console**, allow access, and pick the property. Bing copies the verification and the sitemap.

   **Or add it manually:**
   1. **Add site** → `https://coursemateai.architaggarwal.workers.dev/`
   2. Verify with the **XML file** method: put `BingSiteAuth.xml` in `public\`, deploy, then click **Verify**.
3. Go to **Sitemaps** → **Submit sitemap** → `https://coursemateai.architaggarwal.workers.dev/sitemap.xml`
4. Run **URL Inspection** on `/` and `/study`. You should get the same results as in Google: `/study` is excluded by noindex.

---

## 6. Social previews

### LinkedIn

1. Open **https://www.linkedin.com/post-inspector/**
2. Paste `https://coursemateai.architaggarwal.workers.dev/` → **Inspect**.
3. ✅ **Expected:**
   - **Title:** "CourseMateAI: your PDFs, turned into a tutor"
   - **Description:** the homepage one
   - **Image:** the 1200×630 CourseMateAI card (black, with the logo)
4. Try `/legal/privacy` too. Its title should be "Privacy Policy | CourseMateAI".
5. If an old preview shows, click **Inspect** again: that refreshes LinkedIn's copy.

### WhatsApp / X / Telegram

Paste the link into a message draft (don't send it). A card with the image should appear. These apps keep old previews for a while; adding `?v=2` to the link shows a fresh one.

---

## 7. Structured data

1. **Rich Results Test:** open **https://search.google.com/test/rich-results**, enter the homepage URL → **Test URL**.
   - ✅ The page loads with no errors.
   - "No items detected" for rich results is **normal**: Organization and WebSite don't produce a special result here, and that is expected.
2. **Schema Markup Validator:** open **https://validator.schema.org**, enter the homepage URL → **Run test**.
   - ✅ It shows **Organization** and **WebSite** with **0 errors, 0 warnings**.
   - The values should be: name CourseMateAI, the live URL, and the logo `…/icons/icon-512.png`.

---

## 8. Lighthouse / PageSpeed

1. Open **https://pagespeed.web.dev**, enter the homepage URL → **Analyze**.
2. Check both the **Mobile** and **Desktop** tabs.
3. ✅ **SEO** section: no failed audits. It checks title, meta description, a valid robots.txt, crawlable links, `hreflang` (not used, fine) and a valid canonical.
4. **Core Web Vitals:** the targets are LCP under 2.5 s, INP under 200 ms and CLS under 0.1.
   - Real-user ("field") data only appears once the site has enough visitors.
   - Until then, look at the lab numbers, and fix whatever it points to as the biggest issue, rather than chasing a single score.
5. **To run it in Chrome instead:** open the page in an **Incognito** window (no extensions) → F12 → **Lighthouse** tab → tick SEO, Performance and Accessibility → **Analyze page load**.
6. Repeat for `/legal/privacy`.

---

## 9. Final acceptance list

Tick each one:

- [ ] `npm run build` and `npx opennextjs-cloudflare build` both pass (with `.env.production`).
- [ ] `npm run check` and `npx playwright test e2e/seo.spec.ts --project=desktop` pass.
- [ ] No `localhost` or staging address appears in any canonical tag, `og:url`, `og:image`, robots.txt or the sitemap.
- [ ] Each of the 4 public pages has its own title, its own description, its canonical and one H1.
- [ ] robots.txt and sitemap.xml return 200; the sitemap has exactly the 4 public pages.
- [ ] `/today`, `/study`, `/hero`, `/account`, `/login`, `/offline` and `/api/*` say noindex (header and meta) and aren't in the sitemap.
- [ ] Homepage JSON-LD parses, and only states the name, URL and logo.
- [ ] Public pages return 200 to Googlebot, with no Cloudflare challenge.
- [ ] Google Search Console and Bing are verified, the sitemap is submitted, and `/`, `/legal/privacy` and `/study` are inspected.
- [ ] LinkedIn Post Inspector shows the right title, description and image.

---

## 10. If you move to your own domain later

1. Change `NEXT_PUBLIC_SITE_URL` in **both** `.env.production` and `.github/workflows/ci.yml` to the new address, e.g. `https://coursemateai.in`.
2. Set the Worker setting `BETTER_AUTH_URL` to the same address. Also add the new redirect URI in Google Cloud, if you use Google sign-in.
3. Deploy.
4. In Search Console, add the new address as a property. Ideally use a **Domain** property, since you can add the DNS record on your own domain.
5. Submit the new sitemap.
6. Keep the old `workers.dev` address redirecting to the new one, so existing links keep working.

---

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL must be set…` | No address when building | Step 0 |
| `…must use https` / `…just the origin` | Typo in the address | Use exactly `https://coursemateai.architaggarwal.workers.dev` |
| Canonical shows `localhost` | Built without the variable in an old build | Rebuild after step 0; clear `.next` if needed: `Remove-Item -Recurse -Force .next` |
| Sitemap "Couldn't fetch" in Search Console | Just submitted, or a bot challenge | Wait a day; check 3.1 |
| Old preview on LinkedIn/WhatsApp | Their cache | Inspect again on LinkedIn; add `?v=2` in chat apps |
| `/study` shows "Indexed" in Google | It was indexed before the noindex was added | It drops out after Google recrawls. To speed it up, use Search Console → **Removals** → temporary removal |
