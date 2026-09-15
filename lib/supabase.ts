import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Browser client — uses anon/publishable key, respects RLS policies.
// createBrowserClient (from @supabase/ssr) syncs the session to cookies
// so proxy.ts can perform optimistic auth checks without a DB call.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnon)
