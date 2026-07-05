import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listFlowTemplates } from '@/lib/flows/templates'
import { resolveAccountEntitlements } from '@/lib/plans/resolve-account'

/**
 * GET /api/flows/templates
 *
 * Returns the static template gallery (slug + name + description +
 * icon hint + node_count) so the New-flow dialog can render cards
 * without bundling the full template payloads client-side. Bodies
 * are fetched only on actual clone via POST /api/flows.
 *
 * Available to any signed-in user. Flows is in soft-GA.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }
  const entitlements = await resolveAccountEntitlements(supabase, accountId)
  if (!entitlements.features.has('flows')) {
    return NextResponse.json(
      { error: "Flows isn't included in your plan.", code: 'plan_upgrade_required' },
      { status: 403 },
    )
  }

  // Shallow shape so the client gallery doesn't have to know about
  // the full node tree.
  const templates = listFlowTemplates().map((t) => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    icon: t.icon,
    trigger_type: t.trigger_type,
    node_count: t.nodes.length,
  }))
  return NextResponse.json({ templates })
}
