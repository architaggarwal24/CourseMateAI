import { requireUser } from "@/server/context";
import { courseProgress } from "@/server/study/courses";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, ctx, { id }) => courseProgress(ctx, await requireUser(req, ctx), id));
