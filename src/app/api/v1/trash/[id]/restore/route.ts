import { requireUser } from "@/server/context";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import { restoreFromTrash } from "@/server/study/trash";

export const dynamic = "force-dynamic";

/** Put a PDF or course back where it was (a PDF rejoins its courses that still exist). */
export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `trash-restore:${u.id}`, 30, 60);
  return restoreFromTrash(ctx, u, id);
});
