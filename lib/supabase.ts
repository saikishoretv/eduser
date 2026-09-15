import { createBrowserClient } from '@supabase/ssr'

// Lazy singleton — not created until first call.
// Avoids module-evaluation errors during Next.js static prerender
// when NEXT_PUBLIC_* env vars are not available at build time.
let _client: ReturnType<typeof createBrowserClient> | null = null

export function getSupabase() {
  if (!_client) {
    _client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return _client
}
