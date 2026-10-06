import { PGlite } from "@electric-sql/pglite";
import type {
  DatabasePort,
  DatabaseResult,
  DatabaseRow,
  DatabaseSession,
} from "../src/database/database.port.js";

type PGliteSession = Pick<PGlite, "query" | "exec">;

const execute = async <Row extends DatabaseRow>(
  session: PGliteSession,
  text: string,
  values: readonly unknown[] = [],
): Promise<DatabaseResult<Row>> => {
  if (values.length === 0 && text.trim().split(";").filter(Boolean).length > 1) {
    await session.exec(text);
    return { rows: [], rowCount: 0 };
  }

  const result = await session.query<Row>(text, [...values]);
  return {
    rows: result.rows,
    rowCount:
      result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
  };
};

export class TestDatabase implements DatabasePort {
  private readonly database = new PGlite();

  query<Row extends DatabaseRow = DatabaseRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<DatabaseResult<Row>> {
    return execute<Row>(this.database, text, values);
  }

  transaction<Result>(
    work: (session: DatabaseSession) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction((transaction) =>
      work({
        query: <Row extends DatabaseRow>(
          text: string,
          values: readonly unknown[] = [],
        ) => execute<Row>(transaction, text, values),
      }),
    );
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}
