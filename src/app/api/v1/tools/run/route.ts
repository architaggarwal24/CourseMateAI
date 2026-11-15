// POST /api/v1/tools/run {tool: "flashcards" | "quiz" | "summary", text}: a free tool run, no account (src/server/tools).
import { api } from "@/server/route";
import { readJson } from "@/server/http";
import { runFreeTool } from "@/server/tools/free-tools";

export const POST = api(async (req, ctx) => runFreeTool(ctx, req, await readJson(req)));
