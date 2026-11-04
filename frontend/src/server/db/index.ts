import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/** A typed Drizzle handle on the D1 binding. */
export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
