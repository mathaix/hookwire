declare module "pg" {
  export class Client {
    constructor(config?: { connectionString?: string });
    connect(): Promise<void>;
    end(): Promise<void>;
    query<T = Record<string, unknown>>(
      text: string,
      params?: unknown[]
    ): Promise<{ rows: T[]; rowCount: number | null }>;
  }

  const pg: {
    Client: typeof Client;
  };

  export default pg;
}
