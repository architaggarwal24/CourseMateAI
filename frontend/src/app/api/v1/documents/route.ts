import { requireUser } from "@/server/context";
import { listDocuments } from "@/server/documents";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

/** The user's documents, most recently used first. */
export const GET = api(async (req, ctx) => ({ documents: await listDocuments(ctx, await requireUser(req, ctx)) }));
