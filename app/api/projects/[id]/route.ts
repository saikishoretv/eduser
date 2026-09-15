import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { deleteFile } from '@/lib/s3'

async function makeSupabase() {
  const cookieStore = await cookies()
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await makeSupabase()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, created_at, metadata')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (data.metadata ?? {}) as Record<string, any>

  return Response.json({
    project: {
      id: data.id,
      name: data.name,
      createdAt: new Date(data.created_at).getTime(),
      clips:         meta.clips         ?? [],
      sources:       meta.sources       ?? [],
      audioLayers:   meta.audioLayers   ?? [],
      overlayLayers: meta.overlayLayers ?? [],
    },
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await makeSupabase()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { metadata, name } = await request.json() as { metadata: Record<string, any>; name?: string }
  if (!metadata) {
    return Response.json({ error: 'metadata is required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { metadata }
  if (name) patch.name = name

  const { error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await makeSupabase()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Collect S3 keys from the sources table before deleting
  const { data: sources } = await supabase
    .from('sources')
    .select('s3_key')
    .eq('project_id', id)
    .eq('user_id', user.id)

  // Delete project row — FK cascade removes sources rows automatically
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Clean up S3 after DB delete succeeds (fire-and-forget from server)
  if (sources?.length) {
    await Promise.allSettled(sources.map(s => deleteFile(s.s3_key)))
  }

  return Response.json({ ok: true })
}
