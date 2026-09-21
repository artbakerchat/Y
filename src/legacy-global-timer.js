// Compatibility export for the existing Durable Object namespace.
// Preserve its implementation and storage; no website timer route is enabled.
const GLOBAL_TIMER_DURATION_MS = 15 * 60 * 1000;

export class GlobalTimer {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS timer_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          ends_at INTEGER NOT NULL
        )
      `);
    });
  }

  getTimer() {
    const now = Date.now();
    const current = this.ctx.storage.sql.exec('SELECT ends_at FROM timer_state WHERE id = 1').toArray()[0];
    let endsAt = Number(current?.ends_at);
    if (!Number.isFinite(endsAt) || endsAt <= now) {
      endsAt = now + GLOBAL_TIMER_DURATION_MS;
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO timer_state (id, ends_at) VALUES (1, ?)', endsAt);
    }
    return { endsAt, serverNow: now, durationMs: GLOBAL_TIMER_DURATION_MS };
  }
}
