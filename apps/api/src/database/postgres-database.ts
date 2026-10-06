import type { PoolClient, QueryResultRow } from "pg";
import { Pool } from "pg";
import type {
  DatabasePort,
  DatabaseResult,
  DatabaseRow,
  DatabaseSession,
} from "./database.port.js";

const runQuery = async <Row extends DatabaseRow>(
  client: Pool | PoolClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<DatabaseResult<Row>> => {
  const result = await client.query<QueryResultRow>(text, [...values]);

  return {
    rows: result.rows as Row[],
    rowCount: result.rowCount ?? 0,
  };
};

export class PostgresDatabase implements DatabasePort {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "antojit-os-api",
    });
  }

  query<Row extends DatabaseRow = DatabaseRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<DatabaseResult<Row>> {
    return runQuery<Row>(this.pool, text, values);
  }

  async transaction<Result>(
    work: (session: DatabaseSession) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await work({
        query: <Row extends DatabaseRow>(
          text: string,
          values: readonly unknown[] = [],
        ) => runQuery<Row>(client, text, values),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

