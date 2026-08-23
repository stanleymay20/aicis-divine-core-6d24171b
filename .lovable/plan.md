# AICIS — Netlify Migration Audit (no code changes)

Read-only audit of the current project. Nothing was modified.

## 1. Public frontend environment variables

These are the only variables the browser bundle reads (`src/integrations/supabase/client.ts` uses the first two; the third is metadata only). All are public by design — RLS protects the data.

```
VITE_SUPABASE_URL=https://psonnnuhjjskrdazrakk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o
VITE_SUPABASE_PROJECT_ID=psonnnuhjjskrdazrakk
```

Set these in Netlify → Site settings → Environment variables (all deploy contexts). Vite inlines them at build time, so a rebuild is required after any change. No server-side/service-role key belongs on Netlify — the SPA never uses one.

`netlify.toml` is already correct: `npm run build`, publish `dist`, SPA fallback redirect, security headers.

## 2. Does the backend survive without Lovable?

Technically yes, contractually no — as things stand today.

- The database, auth, storage, edge functions and `pg_cron` schedules are a standard Supabase project (`psonnnuhjjskrdazrakk.supabase.co`). Any external client with the URL + anon key can use it; Netlify does not need Lovable at all.
- But this project's Supabase instance is **provisioned and billed through Lovable Cloud**. When Cloud is paused (it is paused right now), the whole Supabase project is paused: queries fail, crons stop, edge functions stop. So "Lovable credits lapse" currently means "backend offline", not "frontend offline only".
- To make Lovable genuinely optional, the backend must be moved out of Lovable's billing scope: either transfer/claim the project into your own Supabase organisation, or stand up your own Supabase project and migrate (`pg_dump`/restore of schema + data, redeploy the ~250 edge functions with the Supabase CLI, recreate `pg_cron` jobs, re-add all function secrets, re-upload storage objects). Until that happens Lovable remains a production dependency regardless of where the frontend runs.

## 3. Lovable-specific runtime dependencies found

| Area | Dependency | Impact |
|---|---|---|
| AI features | **29 edge functions** call `ai.gateway.lovable.dev` with `LOVABLE_API_KEY` (e.g. `aicis-intelligence`, `enrich-global-signals`, `decision-infer`, `orchestrate-multi-agent`, `predict-risks`, `signal-translator`) | Hard dependency. Without Lovable credits these return errors even if Supabase is self-hosted. Must be repointed to a direct provider (OpenAI/Google/Anthropic) with your own key. |
| Google sign-in | `@lovable.dev/cloud-auth-js` via `src/integrations/lovable/index.ts`, used in `src/pages/Auth.tsx` | Google OAuth is brokered by Lovable. `supabase/config.toml` shows `[auth.external.google] enabled = false`, i.e. no native Supabase Google provider. Email/password sign-in, reset and signup are pure Supabase and unaffected. |
| Auth storage | `src/integrations/supabase/previewAuthStorage.ts` | Only activates on `*.lovable.app` / preview hosts; falls back to `localStorage` on Netlify. Harmless, no change needed. |
| Build | `lovable-tagger` in `vite.config.ts` | Dev-mode plugin only; does not affect the Netlify production build. |
| Storage / cron / other functions | none found | Standard Supabase `pg_cron` + edge functions. |

## 4. Redirect / auth URL changes for `aicis.netlify.app`

Auth code already derives URLs from `window.location.origin` (`Auth.tsx` lines 59, 80, 204), so no code change is required — only backend auth configuration:

- **Site URL** → `https://aicis.netlify.app`
- **Additional redirect URLs** → `https://aicis.netlify.app`, `https://aicis.netlify.app/**`, `https://aicis.netlify.app/auth`, `https://aicis.netlify.app/reset-password`, plus `http://localhost:5173/**` for local dev, plus any Netlify deploy-preview pattern (`https://*--aicis.netlify.app/**`) if you want previews to log in.
- Current stored config is `site_url = http://localhost:5173` — email confirmation and password-reset links will point at localhost until this is changed.
- If Google sign-in is kept: enable Supabase's own Google provider, register `https://psonnnuhjjskrdazrakk.supabase.co/auth/v1/callback` in Google Cloud Console, and switch `Auth.tsx` from the Lovable helper to `supabase.auth.signInWithOAuth`.

## 5. Remaining migration steps

1. Netlify: connect the Git repo, set the three `VITE_*` variables, deploy (`netlify.toml` needs no edits).
2. Update Supabase auth Site URL + redirect allowlist as above.
3. Replace the Lovable Google OAuth path with the native Supabase provider (or drop Google and keep email/password).
4. Repoint the 29 AI-gateway edge functions to a direct model provider and add that key as a Supabase function secret; remove reliance on `LOVABLE_API_KEY`.
5. Update hardcoded canonical/SEO hosts still pointing at `aicis-divine-core.lovable.app`: `index.html` (canonical, `og:url`, `og:image`, JSON-LD), `public/robots.txt` (sitemap URL), `public/sitemap.xml`, `src/components/SEO.tsx`, and `supabase/functions/public-api/index.ts`. Set `PUBLIC_SITE_URL` secret to the Netlify origin.
6. Check CORS on public edge functions (`public-api`, `public-intelligence`, `country-profile`) — they currently allow `*`, so they work, but tighten to the Netlify origin if desired.
7. Stripe: update webhook endpoint/return URLs to the Netlify domain.
8. Decide on backend ownership (section 2). Until the Supabase project leaves Lovable billing, pausing Cloud still takes the whole system down.
9. Optional: point a custom domain at Netlify rather than depending on `aicis.netlify.app`.

## Immediate blocker

The Lovable Cloud backend is **paused right now**, so the database, crons and edge functions are all offline. It must be resumed before any Netlify frontend can load data or authenticate.
