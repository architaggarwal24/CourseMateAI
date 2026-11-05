// What an exam can be, and topics to suggest (the concepts this document's questions covered, weakest first).
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import { gate, options } from "@/server/study/exams";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await gate(ctx, u);
  return options(ctx, u, new URL(req.url).searchParams.get("session_id") ?? "");
});
