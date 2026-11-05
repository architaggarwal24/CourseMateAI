// Any /api path no route answers: a JSON 404 (Stage 4.6: the Python backend is gone, so nothing is forwarded).
import { HttpError, toResponse } from "@/server/http";

export const dynamic = "force-dynamic";

function handle(): Response {
  return toResponse(new HttpError(404, "not_found", "There is no such API route."));
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS, handle as HEAD };
