# AICIS Portability Policy

AICIS must remain operable without Lovable Cloud, Lovable credits, Lovable AI Gateway, or Lovable-managed authentication.

## Non-negotiable rules

1. GitHub `main` is the source of truth for implementation.
2. Production code changes are made directly in the repository and validated by CI.
3. No new runtime dependency may be introduced on:
   - `ai.gateway.lovable.dev`
   - `LOVABLE_API_KEY`
   - `@lovable.dev/cloud-auth-*`
   - Lovable Cloud hosting or billing for application availability
4. AI provider access must go through the provider-neutral AICIS model gateway/cortex.
5. Authentication must use portable Supabase-native or standards-based OAuth flows.
6. Frontend hosting must remain replaceable without changing the cognitive/data layer.
7. Existing legacy Lovable runtime references are migration debt and must only decrease.
8. Secrets must live in the target platform's secret store, never in Git.

## Desired operational property

If Lovable is unavailable, paused, out of credits, or removed entirely, AICIS must continue to operate once the independent backend migration is complete.

CI enforces a no-new-Lovable-runtime gate while legacy references are removed incrementally.
