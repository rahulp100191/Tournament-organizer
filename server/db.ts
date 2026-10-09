import pg from "pg";
export interface Sql {
  query<T = any>(
    sql: string,
    params?: any[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
}
let pool: pg.Pool | undefined;
export const database: Database = {
  async query(sql, params) {
    if (!process.env.DATABASE_URL)
      throw Object.assign(new Error("Database setup is required."), {
        status: 503,
        code: "SETUP_REQUIRED",
      });
    pool ??= new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });
    return pool.query(sql, params) as any;
  },
  async transaction(fn) {
    await this.query("SELECT 1");
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
};
