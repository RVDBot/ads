import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), 'data', 'ads-optimizer.db')

const dir = path.dirname(DB_PATH)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  initSchema(_db)
  return _db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_campaign_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ENABLED',
      country TEXT,
      target_countries TEXT,
      daily_budget REAL,
      bid_strategy TEXT,
      target_roas REAL,
      start_date TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      conversion_value REAL NOT NULL DEFAULT 0,
      roas REAL NOT NULL DEFAULT 0,
      avg_cpc REAL NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      UNIQUE(campaign_id, date)
    );

    CREATE TABLE IF NOT EXISTS ad_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      google_adgroup_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ENABLED',
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adgroup_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adgroup_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      conversion_value REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (adgroup_id) REFERENCES ad_groups(id) ON DELETE CASCADE,
      UNIQUE(adgroup_id, date)
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adgroup_id INTEGER NOT NULL,
      google_keyword_id TEXT NOT NULL UNIQUE,
      text TEXT NOT NULL,
      match_type TEXT NOT NULL,
      bid REAL,
      status TEXT NOT NULL DEFAULT 'ENABLED',
      FOREIGN KEY (adgroup_id) REFERENCES ad_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS keyword_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      conversion_value REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
      UNIQUE(keyword_id, date)
    );

    CREATE TABLE IF NOT EXISTS search_terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      search_term TEXT NOT NULL,
      date TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      conversion_value REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adgroup_id INTEGER NOT NULL,
      google_ad_id TEXT NOT NULL UNIQUE,
      headlines TEXT NOT NULL DEFAULT '[]',
      descriptions TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'ENABLED',
      FOREIGN KEY (adgroup_id) REFERENCES ad_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ad_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (ad_id) REFERENCES ads(id) ON DELETE CASCADE,
      UNIQUE(ad_id, date)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_product_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      price REAL,
      currency TEXT DEFAULT 'EUR',
      availability TEXT,
      margin_label TEXT,
      country TEXT,
      status TEXT DEFAULT 'approved',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      product_title TEXT NOT NULL,
      product_id TEXT,
      date TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      conversion_value REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      UNIQUE(campaign_id, product_title, date)
    );

    CREATE TABLE IF NOT EXISTS ga4_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_path TEXT NOT NULL,
      date TEXT NOT NULL,
      sessions INTEGER NOT NULL DEFAULT 0,
      bounce_rate REAL NOT NULL DEFAULT 0,
      avg_session_duration REAL NOT NULL DEFAULT 0,
      pages_per_session REAL NOT NULL DEFAULT 0,
      country TEXT,
      UNIQUE(page_path, date, country)
    );

    CREATE TABLE IF NOT EXISTS shop_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country TEXT NOT NULL UNIQUE,
      profile_content TEXT NOT NULL,
      last_crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      findings TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      title TEXT NOT NULL,
      description TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      applied_at DATETIME,
      result_roas_before REAL,
      result_roas_after REAL,
      FOREIGN KEY (analysis_id) REFERENCES ai_analyses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suggestion_id INTEGER,
      action_type TEXT NOT NULL,
      description TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      applied_by TEXT NOT NULL DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      google_response TEXT,
      FOREIGN KEY (suggestion_id) REFERENCES ai_suggestions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER,
      call_type TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (analysis_id) REFERENCES ai_analyses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      context_type TEXT NOT NULL,
      context_id INTEGER,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      proposed_actions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
    );
  `)

  // Migrations for existing databases
  const cols = db.prepare("PRAGMA table_info(campaigns)").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'target_countries')) {
    db.exec('ALTER TABLE campaigns ADD COLUMN target_countries TEXT')
  }

  if (!cols.some(c => c.name === 'start_date')) {
    db.exec('ALTER TABLE campaigns ADD COLUMN start_date TEXT')
  }

  const tuCols = db.prepare("PRAGMA table_info(token_usage)").all() as Array<{ name: string }>
  if (!tuCols.some(c => c.name === 'model')) {
    db.exec('ALTER TABLE token_usage ADD COLUMN model TEXT')
  }
}
