export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { scheduleSyncs } = await import('@/lib/scheduler')
    scheduleSyncs()
    console.log('[instrumentation] Sync scheduler gestart')
  }
}
