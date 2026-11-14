import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import { searchDeps } from "@/server/search";
import { listTrash } from "@/server/study/trash";

export const dynamic = "force-dynamic";

/** What's in your Trash: deleted PDFs and courses, restorable for 30 days (items past that are deleted for good first). */
export const GET = api(async (req, ctx) => listTrash(ctx, searchDeps(ctx.env), await requireUser(req, ctx)));
