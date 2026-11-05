// Rewards are granted by the server when an activity finishes; the browser can't claim one.
import { REWARD_ACTIONS } from "@/server/game/content";
import { requireUser } from "@/server/context";
import { HttpError, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  await requireUser(req, ctx);
  const action = (await readJson(req)).action_type;
  if (!(REWARD_ACTIONS as readonly unknown[]).includes(action)) throw new HttpError(400, "invalid_input", `Unknown action_type: '${String(action)}'.`);
  throw new HttpError(403, "reward_not_claimable", "That reward is granted by the server when you finish the activity.");
});
