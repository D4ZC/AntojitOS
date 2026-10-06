export type DatabaseRow = Record<string, unknown>;

export interface DatabaseResult<Row extends DatabaseRow> {
  rows: Row[];
  rowCount: number;
}

export interface DatabaseSession {
  query<Row extends DatabaseRow = DatabaseRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DatabaseResult<Row>>;
}

export interface DatabasePort extends DatabaseSession {
  transaction<Result>(
    work: (session: DatabaseSession) => Promise<Result>,
  ): Promise<Result>;
  close(): Promise<void>;
}

export const DATABASE = Symbol("DATABASE");

