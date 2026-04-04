import { getSetting } from './settings'
import { getDb } from './db'
import { log } from './logger'
import Anthropic from '@anthropic-ai/sdk'

const DOMAINS: Record<string, string> = {
  nl: 'https://speedropeshop.nl',
  de: 'https://speedropeshop.de',
  fr: 'https://speedropeshop.fr',
  es: 'https://speedropeshop.es',
  it: 'https://speedropeshop.it',
  com: 'https://speedropeshop.com',
}

export async function crawlAndGenerateProfile(country: string): Promise<string> {
  const domain = DOMAINS[country]
  if (!domain) throw new Error(`Onbekend land: ${country}`)

  const homepageRes = await fetch(domain)
  const homepage = await homepageRes.text()

  const text = homepage.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000)

  const apiKey = getSetting('anthropic_api_key')
  if (!apiKey) throw new Error('Anthropic API key niet geconfigureerd')
  const model = getSetting('ai_model') || 'claude-sonnet-4-6'
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Analyseer deze e-commerce website (${domain}) en maak een shop profiel in het Nederlands. Beschrijf:
1. Doelgroep (wie koopt hier?)
2. Productaanbod (wat wordt er verkocht, prijsrange)
3. USPs (unieke verkoopargumenten)
4. Taal en tone of voice (hoe communiceert de shop)
5. Specifieke kenmerken voor dit land/markt

Website content:
${text}

Geef het profiel als gestructureerde markdown.`
    }]
  })

  const profile = (response.content[0] as { type: string; text: string }).text.trim()

  const db = getDb()
  db.prepare(`
    INSERT INTO shop_profile (country, profile_content, last_crawled_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(country) DO UPDATE SET profile_content = excluded.profile_content, last_crawled_at = CURRENT_TIMESTAMP
  `).run(country, profile)

  db.prepare('INSERT INTO token_usage (call_type, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?)')
    .run('shop_profile', model, response.usage.input_tokens, response.usage.output_tokens)

  log('info', 'ai', `Shop profiel gegenereerd voor ${country}`, { tokens: response.usage })
  return profile
}

export async function crawlAllProfiles(): Promise<void> {
  for (const country of Object.keys(DOMAINS)) {
    try {
      await crawlAndGenerateProfile(country)
    } catch (e) {
      log('error', 'ai', `Shop profiel mislukt voor ${country}`, { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
