// ============================================================
// GET /api/whatsapp/config/list — all WhatsApp numbers on the account.
//
// Metadata only (never tokens), no live Meta calls, so the Settings
// "Connected numbers" manager loads instantly regardless of how many
// numbers are connected. Live health for a single number is still
// available via GET /api/whatsapp/config?id=<id>.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ numbers: [] })
    }

    const { data, error } = await supabase
      .from('whatsapp_config')
      .select(
        'id, provider, phone_number_id, wsapi_instance_id, phone_number, waba_id, label, is_default, status, registered_at, connected_at, subscribed_apps_at, last_registration_error, created_at',
      )
      .eq('account_id', accountId)
      // Default first, then most-recently connected.
      .order('is_default', { ascending: false })
      .order('connected_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[GET /api/whatsapp/config/list]', error)
      return NextResponse.json({ error: 'Failed to load numbers' }, { status: 500 })
    }

    return NextResponse.json({ numbers: data ?? [] })
  } catch (error) {
    console.error('Error in WhatsApp config list GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
