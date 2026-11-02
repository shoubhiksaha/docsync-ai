# Cloudflare proxy for DocSync AI

`docsync.analogdigital.tech` and `docsync-staging.analogdigital.tech` are served by Cloud Run in
Mumbai. Cloud Run can't attach a custom domain in that region, so a small Worker on ADT's
Cloudflare account (where the domain's DNS already lives) forwards each request to the right
Cloud Run service. There is one Worker per environment, so publishing staging can never touch
production. The Workers free plan covers 100,000 requests a day.

## The shared secret

With `PROXY_SECRET` set, the app refuses every request that doesn't carry it (`core/proxy.ts`), so
the `run.app` addresses can't be used to get around Cloudflare. That also lets the rate limiter
trust the caller's address the Worker passes in `x-real-ip`. Use a different secret for each
environment, and run each line yourself, so the value never appears in a chat or log:

```bash
npx wrangler@4.151.0 login                                   # ADT's Cloudflare account
openssl rand -hex 32 | pbcopy
npx wrangler@4.151.0 secret put PROXY_SECRET --env staging    # paste
# add PROXY_SECRET=<the same value> to .env.staging.local, then:
bash ../../scripts/gcp/push-env.sh staging ../../.env.staging.local
```

Repeat for production with a new value: `npx wrangler@4.151.0 secret put PROXY_SECRET --env production`
and `.env.prod.local`.

## Publish

- **Staging:** `npx wrangler@4.151.0 deploy --env staging`. Cloudflare creates the DNS record and certificate for
  `docsync-staging.analogdigital.tech`. It can be published before the first staging deploy;
  until the service exists, it shows Cloud Run's 404 page.
- **Production:** `npx wrangler@4.151.0 deploy --env production`. The route takes over
  `docsync.analogdigital.tech` from Vercel the moment it's published, so publish it only after
  the first approved production deploy has finished. To undo, remove the route in Cloudflare
  (Workers → docsync-proxy-production → Settings → Domains & Routes); the existing DNS record then
  serves Vercel again.

Add each domain's sign-in callback to the Google OAuth client
(`https://<domain>/api/auth/callback/google`) and, if Notion is connected,
`https://<domain>/api/auth/notion/callback` to the Notion integration.
