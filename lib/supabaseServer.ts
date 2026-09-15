import { createClient } from '@supabase/supabase-js'

// Server-only client — uses service key, bypasses RLS
// Never import this in client components
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
}
