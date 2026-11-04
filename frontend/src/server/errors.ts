// The API's error contract on the TypeScript side (the same shape as backend/errors.py; read by src/lib/api/errors.ts):
//   { "error": { "code", "message", "action", "details" } }
import type { ApiErrorAction } from "@/lib/api/errors";

export function apiError(
  status: number,
  code: string,
  message: string,
  action: ApiErrorAction = null,
  details: Record<string, unknown> | null = null,
  headers?: HeadersInit,
): Response {
  return Response.json({ error: { code, message, action, details } }, { status, headers });
}
