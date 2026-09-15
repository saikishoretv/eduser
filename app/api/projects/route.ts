import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

function makeSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}

export async function GET() {
  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, created_at')
    .order('updated_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const projects = (data ?? []).map(p => ({
    id: p.id,
    name: p.name,
    createdAt: new Date(p.created_at).getTime(),
  }))

  return Response.json({ projects })
}

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as {
    projectId: string
    name: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any>
    sources: Array<{ id: string; name: string; duration: number; s3Key: string }>
  }

  const { projectId, name, metadata, sources } = body
  if (!projectId || !name) {
    return Response.json({ error: 'projectId and name are required' }, { status: 400 })
  }

  // Insert project row
  const { error: projectErr } = await supabase
    .from('projects')
    .insert({ id: projectId, user_id: user.id, name, metadata })

  if (projectErr) {
    return Response.json({ error: projectErr.message }, { status: 500 })
  }

  // Insert source rows
  if (sources?.length) {
    const rows = sources.map(s => ({
      id: s.id,
      project_id: projectId,
      user_id: user.id,
      name: s.name,
      duration: s.duration,
      s3_key: s.s3Key,
    }))
    const { error: sourcesErr } = await supabase.from('sources').insert(rows)
    if (sourcesErr) {
      return Response.json({ error: sourcesErr.message }, { status: 500 })
    }
  }

  return Response.json({ ok: true })
}
