// Counts D1 round trips (each one is a network hop from the Worker to the database on Cloudflare). A prepared
// statement run (all / first / run / raw) is one; a batch of any size is one; exec is one. Tests use it to keep the
// hot routes' query counts from creeping up.
export interface QueryCounter {
  db: D1Database;
  /** Round trips since the last reset, and the SQL of each (the first 80 characters) for a failure message. */
  count: () => number;
  log: () => string[];
  reset: () => void;
}

export function countQueries(real: D1Database): QueryCounter {
  let log: string[] = [];
  const wrapStatement = (stmt: D1PreparedStatement, sql: string): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop, receiver) {
        if (prop === "bind") return (...args: unknown[]) => wrapStatement(target.bind(...args), sql);
        if (prop === "all" || prop === "first" || prop === "run" || prop === "raw") {
          return (...args: unknown[]) => {
            log.push(sql.replace(/\s+/g, " ").slice(0, 80));
            return (target[prop] as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        if (prop === "__real") return target;
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  const db = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "prepare") return (sql: string) => wrapStatement(target.prepare(sql), sql);
      if (prop === "batch") {
        return (stmts: D1PreparedStatement[]) => {
          log.push(`batch(${stmts.length})`);
          return target.batch(stmts.map((s) => (s as unknown as { __real?: D1PreparedStatement }).__real ?? s));
        };
      }
      if (prop === "exec") return (sql: string) => { log.push(`exec ${sql.slice(0, 60)}`); return target.exec(sql); };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { db, count: () => log.length, log: () => [...log], reset: () => { log = []; } };
}
