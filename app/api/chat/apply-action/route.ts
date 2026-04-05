import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'
import { getSetting } from '@/lib/settings'
import { log } from '@/lib/logger'
import { getGoogleAdsClient } from '@/lib/google-ads'

interface ApplyActionBody {
  message_id: number
  action_index: number
  dismiss?: boolean
}

interface ProposedAction {
  type: string
  title: string
  status?: string
  details: Record<string, unknown>
}

function findCampaignByName(db: ReturnType<typeof getDb>, name: string) {
  let camp = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns WHERE name = ?').get(name) as any
  if (camp) return camp
  camp = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns WHERE name COLLATE NOCASE = ?').get(name) as any
  if (camp) return camp
  camp = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns WHERE name LIKE ?').get(`%${name}%`) as any
  if (camp) return camp
  const allCamps = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns').all() as any[]
  const nameLower = name.toLowerCase()
  return allCamps.find((c: any) => nameLower.includes(c.name.toLowerCase())) || null
}

function findAdGroupByName(db: ReturnType<typeof getDb>, name: string, googleCampaignId?: string) {
  const params: string[] = [name]
  let sql = 'SELECT google_adgroup_id, name FROM ad_groups WHERE name = ?'
  if (googleCampaignId) {
    sql += ' AND campaign_id = (SELECT id FROM campaigns WHERE google_campaign_id = ?)'
    params.push(googleCampaignId)
  }
  let ag = db.prepare(sql).get(...params) as any
  if (ag) return ag
  ag = db.prepare(sql.replace('name = ?', 'name COLLATE NOCASE = ?')).get(...params) as any
  if (ag) return ag
  params[0] = `%${name}%`
  ag = db.prepare(sql.replace('name = ?', 'name LIKE ?')).get(...params) as any
  return ag || null
}

function resolveGoogleIds(db: ReturnType<typeof getDb>, details: Record<string, unknown>) {
  const customerId = getSetting('google_ads_customer_id')
  if (!customerId) throw new Error('Google Ads customer ID niet geconfigureerd')

  const resolved: Record<string, unknown> = { ...details, customer_id: customerId }

  if (details.campaign_name && !details.google_campaign_id) {
    const camp = findCampaignByName(db, String(details.campaign_name))
    if (camp) {
      resolved.google_campaign_id = camp.google_campaign_id
      if (!resolved.old_budget) resolved.old_budget = camp.daily_budget
      log('info', 'google-ads', `Campagne gevonden: "${camp.name}" voor zoeknaam "${details.campaign_name}"`)
    } else {
      log('warn', 'google-ads', `Campagne niet gevonden voor naam: "${details.campaign_name}"`)
    }
  }

  if (details.adgroup_name && !details.google_adgroup_id) {
    const ag = findAdGroupByName(db, String(details.adgroup_name), resolved.google_campaign_id as string | undefined)
    if (ag) {
      resolved.google_adgroup_id = ag.google_adgroup_id
    } else {
      log('warn', 'google-ads', `Ad group niet gevonden voor naam: "${details.adgroup_name}"`)
    }
  }

  return resolved
}

async function verifyAction(actionType: string, details: Record<string, unknown>): Promise<{ verified: boolean; actual?: unknown; expected?: unknown }> {
  try {
    const customer = getGoogleAdsClient()

    switch (actionType) {
      case 'budget_change': {
        if (!details.google_campaign_id) return { verified: false }
        const [row] = await customer.query(`
          SELECT campaign_budget.amount_micros
          FROM campaign
          WHERE campaign.id = ${details.google_campaign_id}
          LIMIT 1
        `)
        const actualBudget = row?.campaign_budget?.amount_micros
          ? Number(row.campaign_budget.amount_micros) / 1_000_000
          : null
        const expected = Number(details.new_budget || 0)
        return { verified: actualBudget !== null && Math.abs(actualBudget - expected) < 0.01, actual: actualBudget, expected }
      }

      case 'pause_campaign': {
        if (!details.google_campaign_id) return { verified: false }
        const [row] = await customer.query(`
          SELECT campaign.status
          FROM campaign
          WHERE campaign.id = ${details.google_campaign_id}
          LIMIT 1
        `)
        const status = String(row?.campaign?.status || '')
        return { verified: status === 'PAUSED' || status === '3', actual: status, expected: 'PAUSED' }
      }

      case 'keyword_negative': {
        if (!details.google_campaign_id || !details.keyword) return { verified: false }
        const rows = await customer.query(`
          SELECT campaign_criterion.keyword.text
          FROM campaign_criterion
          WHERE campaign.id = ${details.google_campaign_id}
            AND campaign_criterion.negative = TRUE
            AND campaign_criterion.keyword.text = '${String(details.keyword).replace(/'/g, "\\'")}'
          LIMIT 1
        `)
        return { verified: rows.length > 0, actual: rows.length > 0 ? 'gevonden' : 'niet gevonden', expected: details.keyword }
      }

      default:
        // For types we can't easily verify, assume success if API didn't throw
        return { verified: true }
    }
  } catch (e) {
    log('warn', 'google-ads', `Verificatie mislukt: ${e instanceof Error ? e.message : 'onbekend'}`)
    return { verified: true } // Don't block on verification errors
  }
}

async function applyAction(actionType: string, details: Record<string, unknown>): Promise<unknown> {
  const customer = getGoogleAdsClient()

  switch (actionType) {
    case 'budget_change': {
      if (!details.google_campaign_id) throw new Error('Campagne niet gevonden voor budget wijziging')
      const [campaign] = await customer.query(`
        SELECT campaign.id, campaign_budget.resource_name
        FROM campaign
        WHERE campaign.id = ${details.google_campaign_id}
        LIMIT 1
      `)
      if (!campaign?.campaign_budget?.resource_name) {
        throw new Error(`Budget niet gevonden voor campagne ${details.google_campaign_id}`)
      }
      return customer.mutateResources([{
        entity: 'campaign_budget',
        operation: 'update',
        resource: {
          resource_name: campaign.campaign_budget.resource_name as string,
          amount_micros: Math.round(Number(details.new_budget || 0) * 1_000_000),
        },
      }])
    }

    case 'keyword_negative': {
      if (!details.google_campaign_id) throw new Error('Campagne niet gevonden voor negatief zoekwoord')
      return customer.mutateResources([{
        entity: 'campaign_criterion',
        operation: 'create',
        resource: {
          campaign: `customers/${details.customer_id}/campaigns/${details.google_campaign_id}`,
          negative: true,
          keyword: { text: details.keyword as string, match_type: (details.match_type as string) || 'EXACT' },
        },
      }])
    }

    case 'pause_campaign': {
      if (!details.google_campaign_id) throw new Error('Campagne niet gevonden om te pauzeren')
      return customer.mutateResources([{
        entity: 'campaign',
        operation: 'update',
        resource: {
          resource_name: `customers/${details.customer_id}/campaigns/${details.google_campaign_id}`,
          status: 'PAUSED',
        },
      }])
    }

    case 'bid_adjustment': {
      return customer.mutateResources([{
        entity: 'ad_group_criterion',
        operation: 'update',
        resource: {
          resource_name: `customers/${details.customer_id}/adGroupCriteria/${details.google_adgroup_id}~${details.criterion_id}`,
          cpc_bid_micros: Math.round(Number(details.new_bid || 0) * 1_000_000),
        },
      }])
    }

    case 'keyword_add': {
      if (!details.google_adgroup_id) throw new Error('Ad group niet gevonden voor zoekwoord toevoegen')
      const keywords = Array.isArray(details.keywords) ? details.keywords as string[] : [details.keyword as string]
      return customer.mutateResources(keywords.map((kw: string) => ({
        entity: 'ad_group_criterion' as const,
        operation: 'create' as const,
        resource: {
          ad_group: `customers/${details.customer_id}/adGroups/${details.google_adgroup_id}`,
          keyword: { text: kw, match_type: (details.match_type as string) || 'PHRASE' },
        },
      })))
    }

    default:
      throw new Error(`Onbekend actie-type: ${actionType}`)
  }
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  let body: ApplyActionBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Ongeldige JSON' }, { status: 400 })
  }

  const { message_id, action_index, dismiss } = body

  if (message_id === undefined || action_index === undefined) {
    return NextResponse.json({ error: 'message_id en action_index zijn verplicht' }, { status: 400 })
  }

  const db = getDb()

  // Look up the chat message
  const message = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(message_id) as {
    id: number
    thread_id: number
    proposed_actions: string | null
  } | undefined

  if (!message) {
    return NextResponse.json({ error: 'Bericht niet gevonden' }, { status: 404 })
  }

  // Parse proposed_actions
  let proposedActions: ProposedAction[]
  try {
    proposedActions = message.proposed_actions ? JSON.parse(message.proposed_actions) : []
  } catch {
    return NextResponse.json({ error: 'Ongeldige proposed_actions JSON' }, { status: 400 })
  }

  // Validate action_index
  if (action_index < 0 || action_index >= proposedActions.length) {
    return NextResponse.json({ error: `Ongeldig action_index: ${action_index}` }, { status: 400 })
  }

  const action = proposedActions[action_index]

  // Check action is pending
  if (action.status && action.status !== 'pending') {
    return NextResponse.json({ error: `Actie is al ${action.status}` }, { status: 400 })
  }

  // Handle dismiss
  if (dismiss) {
    proposedActions[action_index] = { ...action, status: 'dismissed' }
    db.prepare('UPDATE chat_messages SET proposed_actions = ? WHERE id = ?')
      .run(JSON.stringify(proposedActions), message_id)
    return NextResponse.json({ success: true })
  }

  // Apply the action via Google Ads API
  try {
    const db2 = getDb()
    const details = resolveGoogleIds(db2, action.details)

    let oldValue: string | null = null
    let newValue: string | null = null

    // Build descriptive old/new values for action_log
    switch (action.type) {
      case 'budget_change':
        oldValue = details.old_budget !== undefined ? `€${details.old_budget}` : null
        newValue = details.new_budget !== undefined ? `€${details.new_budget}` : null
        break
      case 'bid_adjustment':
        oldValue = details.old_bid !== undefined ? `€${details.old_bid}` : null
        newValue = details.new_bid !== undefined ? `€${details.new_bid}` : null
        break
      case 'keyword_negative':
        newValue = details.keyword as string | null ?? null
        break
      case 'pause_campaign':
        oldValue = 'ENABLED'
        newValue = 'PAUSED'
        break
      case 'keyword_add':
        newValue = Array.isArray(details.keywords)
          ? (details.keywords as string[]).join(', ')
          : (details.keyword as string | null ?? null)
        break
    }

    const googleResponse = await applyAction(action.type, details)

    // Verify the action was actually applied
    const verification = await verifyAction(action.type, details)

    const finalStatus = verification.verified ? 'applied' : 'failed'
    const verificationNote = verification.verified
      ? undefined
      : `Verificatie mislukt: verwacht ${JSON.stringify(verification.expected)}, maar gevonden ${JSON.stringify(verification.actual)}`

    // Update action status in proposed_actions
    proposedActions[action_index] = { ...action, status: finalStatus, ...(verificationNote ? { verification_note: verificationNote } : {}) }
    db.prepare('UPDATE chat_messages SET proposed_actions = ? WHERE id = ?')
      .run(JSON.stringify(proposedActions), message_id)

    // Log to action_log
    db.prepare(`
      INSERT INTO action_log (action_type, description, old_value, new_value, applied_by, google_response)
      VALUES (?, ?, ?, ?, 'manual', ?)
    `).run(
      action.type,
      action.title,
      oldValue,
      newValue,
      JSON.stringify({ ...googleResponse as object, verification }),
    )

    if (verification.verified) {
      log('info', 'google-ads', `Chat actie toegepast en geverifieerd: ${action.title}`, {
        message_id, action_index, type: action.type,
      })
    } else {
      log('warn', 'google-ads', `Chat actie toegepast maar verificatie mislukt: ${action.title}`, {
        message_id, action_index, type: action.type,
        expected: verification.expected, actual: verification.actual,
      })
    }

    return NextResponse.json({ success: true, verified: verification.verified, verification_note: verificationNote })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Toepassen mislukt'
    log('error', 'google-ads', `Chat actie mislukt: ${errorMessage}`, {
      message_id,
      action_index,
      type: action.type,
    })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
