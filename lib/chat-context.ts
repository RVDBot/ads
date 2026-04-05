import { getDb } from './db'

interface ChatContext {
  systemPrompt: string
  threadTitle: string
}

export function buildChatContext(contextType: string, contextId: number | null): ChatContext {
  const db = getDb()

  const baseRole = `Je bent een expert Google Ads optimizer voor Speed Rope Shop, een e-commerce shop voor speedropes en fitness accessoires actief in 6 landen (.com, .nl, .de, .fr, .es, .it).

Je helpt de gebruiker met vragen over campagnes, analyseert prestaties, en stelt concrete acties voor wanneer nodig.

## Regels
- Antwoord altijd in het Nederlands
- Stel NOOIT acties voor zonder eerst data op te halen en te analyseren via de beschikbare tools
- Bij het voorstellen van een actie (propose_action), leg altijd uit WAAROM
- Gebruik de exacte campagnenamen uit de database
- Headlines max 30 tekens, descriptions max 90 tekens (Google Ads limieten)
- Schrijf advertentieteksten in de taal van het land van de campagne
- Gebruik minimale opmaak in je antwoorden: alleen *bold*, _italic_ en lijstjes met - waar nodig. Gebruik GEEN markdown titels (# ## ###), geen tabellen, geen codeblokken. Schrijf zoals in een chat-app.`

  switch (contextType) {
    case 'campaign': {
      if (!contextId) return { systemPrompt: baseRole, threadTitle: 'AI Assistent' }
      const campaign = db.prepare(`
        SELECT c.*,
          (SELECT SUM(cost) FROM daily_metrics WHERE campaign_id = c.id AND date >= date('now', '-7 days')) as cost_7d,
          (SELECT SUM(conversion_value) FROM daily_metrics WHERE campaign_id = c.id AND date >= date('now', '-7 days')) as value_7d,
          (SELECT CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END FROM daily_metrics WHERE campaign_id = c.id AND date >= date('now', '-7 days')) as roas_7d
        FROM campaigns c WHERE c.id = ?
      `).get(contextId) as any
      if (!campaign) return { systemPrompt: baseRole, threadTitle: 'AI Assistent' }

      const context = `

## Huidige campagne context
- **Naam:** ${campaign.name}
- **Type:** ${campaign.type}
- **Status:** ${campaign.status}
- **Land:** ${campaign.country || 'onbekend'}
- **Target countries:** ${campaign.target_countries || 'niet ingesteld'}
- **Dagelijks budget:** €${campaign.daily_budget || 0}
- **ROAS (7d):** ${campaign.roas_7d?.toFixed(1) || '0.0'}x
- **Kosten (7d):** €${campaign.cost_7d?.toFixed(2) || '0.00'}
- **Omzet (7d):** €${campaign.value_7d?.toFixed(2) || '0.00'}
- **Database ID:** ${campaign.id} (gebruik dit voor tool-calls)`

      return {
        systemPrompt: baseRole + context,
        threadTitle: campaign.name,
      }
    }

    case 'suggestion': {
      if (!contextId) return { systemPrompt: baseRole, threadTitle: 'AI Assistent' }
      const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(contextId) as any
      if (!suggestion) return { systemPrompt: baseRole, threadTitle: 'AI Assistent' }

      let details: Record<string, unknown> = {}
      try { details = JSON.parse(suggestion.details) } catch { /* empty */ }

      const campaignName = (details.campaign_name || details.name || '') as string
      let campaignContext = ''
      if (campaignName) {
        const camp = db.prepare('SELECT id, name, type, status, country, daily_budget FROM campaigns WHERE name LIKE ?').get(`%${campaignName}%`) as any
        if (camp) {
          campaignContext = `
- **Campagne:** ${camp.name} (ID: ${camp.id}, type: ${camp.type}, status: ${camp.status}, land: ${camp.country}, budget: €${camp.daily_budget})`
        }
      }

      const context = `

## Huidige suggestie context
- **Titel:** ${suggestion.title}
- **Type:** ${suggestion.type}
- **Prioriteit:** ${suggestion.priority}
- **Status:** ${suggestion.status}
- **Beschrijving:** ${suggestion.description}
- **Details:** ${JSON.stringify(details, null, 2)}${campaignContext}

De gebruiker wil deze suggestie bespreken. Help met vragen, geef extra context, of stel alternatieve acties voor indien nodig.`

      return {
        systemPrompt: baseRole + context,
        threadTitle: suggestion.title,
      }
    }

    case 'global':
    default: {
      const activeCampaigns = db.prepare(`
        SELECT c.id, c.name, c.type, c.status, c.country, c.daily_budget,
          CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas_7d
        FROM campaigns c
        LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id AND dm.date >= date('now', '-7 days')
        WHERE c.status = 'ENABLED'
        GROUP BY c.id ORDER BY roas_7d DESC
      `).all()

      const context = `

## Actieve campagnes overzicht
${(activeCampaigns as any[]).map((c: any) => `- **${c.name}** (ID: ${c.id}) — ${c.type}, ${c.country || '?'}, budget €${c.daily_budget || 0}, ROAS 7d: ${c.roas_7d?.toFixed(1) || '0.0'}x`).join('\n')}

De gebruiker kan vragen stellen over elke campagne. Gebruik de tools om gedetailleerde data op te halen wanneer nodig.`

      return {
        systemPrompt: baseRole + context,
        threadTitle: 'AI Assistent',
      }
    }
  }
}
