export type D1ResultLike<T = Record<string, unknown>> = {
  results?: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
};

export type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1ResultLike<T>>;
  run(): Promise<D1ResultLike>;
};

export type D1Like = {
  prepare(query: string): D1PreparedStatementLike;
};
