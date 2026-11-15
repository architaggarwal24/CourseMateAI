# Moving to your own domain (SEO stage 2)

The site lives at `coursemateai.architaggarwal.workers.dev`. A domain of your own ranks and gets clicked more, and
every link, sitemap entry and canonical tag follows one setting: `NEXT_PUBLIC_SITE_URL`. The code is ready: once that
setting is the new address, every old workers.dev URL redirects (308, permanent) to the same path on the new domain
(`hostRedirects` in `src/lib/site-url.ts`, used by `next.config.ts`), so old links and search results keep working.

Do the steps in order. Below, `example.com` stands for your domain.

## 1. Get the domain onto Cloudflare

1. Get the domain (options are in the SEO research doc). It must let you change its **nameservers**: a Worker custom
   domain needs the domain's DNS on Cloudflare. A subdomain that only gives you a CNAME won't work.
2. Cloudflare dashboard → *Add a domain* → enter it → Free plan.
3. At the registrar, replace the nameservers with the two Cloudflare shows. Wait until Cloudflare says *Active*
   (minutes to a day).

## 2. Point the domain at the Worker

Cloudflare → *Workers & Pages* → `coursemateai` → *Settings* → *Domains & Routes* → *Add* → *Custom domain* →
`example.com`. Cloudflare creates the DNS record and certificate. Add `www.example.com` too if you want it.

Leave the workers.dev address **on** (it's on unless `wrangler.jsonc` says `"workers_dev": false`): it has to keep
answering so it can send people to the new domain.

## 3. Update the outside services

They check the exact address, so add the new one (keep the old one until the move has settled):

- Google sign-in: authorised redirect URI `https://example.com/api/auth/callback/google`
- GitHub sign-in: callback URL `https://example.com/api/auth/callback/github` (an OAuth App has one homepage URL; change it)
- Razorpay (if payments are on): webhook URL `https://example.com/api/v1/billing/webhook`
- If you set the `BETTER_AUTH_URL` secret, change it to `https://example.com` (`npx wrangler secret put BETTER_AUTH_URL`).
  If you never set it, do nothing.

## 4. Change the one setting

In `.github/workflows/ci.yml`, set:

```yaml
NEXT_PUBLIC_SITE_URL: https://example.com
```

Push. The deploy rebuilds with the new address: canonical tags, sitemap, robots.txt, structured data and share
cards all switch, and the workers.dev address starts redirecting.

## 5. Check it

```bash
curl -sI https://coursemateai.architaggarwal.workers.dev/pricing   # 308, location: https://example.com/pricing
curl -s https://example.com/sitemap.xml | head                     # every <loc> starts with https://example.com
curl -s https://example.com/robots.txt                             # Sitemap: https://example.com/sitemap.xml
```

Sign in with Google and GitHub once on the new domain.

## 6. Tell the search engines

1. **Google Search Console** → add a *Domain* property for `example.com` (verify with the DNS record it gives you:
   Cloudflare → DNS → add TXT). Submit `https://example.com/sitemap.xml`.
2. If the workers.dev address was already a Search Console property, open it → *Settings* → *Change of address* →
   pick the new property.
3. **Bing Webmaster Tools** → *Import from Google Search Console*, or add the site and submit the sitemap. IndexNow
   (run by the deploy) works on the new domain with no change.
4. Update the address anywhere you listed it: GitHub repo *About*, social profiles, the README.

Expect rankings to wobble for a few weeks, then settle. Keep the redirects for at least a year (keeping them
forever costs nothing).
