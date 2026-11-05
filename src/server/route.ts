// One wrapper for every Worker route: the same-site check for changes, the request context, JSON answers
// (never cached) and errors in the API's shape.
import { requestContext, type RequestContext } from "./context";
import { HttpError, assertSameOrigin, handle } from "./http";

type Info<P> = { params?: Promise<P> };

export function api<P = Record<string, string>>(fn: (req: Request, ctx: RequestContext, params: P) => Promise<unknown>) {
  return (req: Request, info?: Info<P>): Promise<Response> =>
    handle(async () => {
      assertSameOrigin(req);
      const ctx = await requestContext(req);
      const params = ((await info?.params) ?? {}) as P;
      const out = await fn(req, ctx, params);
      return out instanceof Response ? out : Response.json(out, { headers: { "cache-control": "no-store" } });
    });
}

export function intParam(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, "not_found", "There's no such item.");
  return n;
}
