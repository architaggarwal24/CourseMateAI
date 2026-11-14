// The Trash, from the browser (data-loss safety): deleted PDFs and courses wait 30 days before they go for good.
import { API_BASE_URL, throwForResponse } from "@/lib/api/client";

export interface TrashItem {
  id: string; kind: "document" | "course"; name: string; deleted_at: string; expires_at: string; days_left: number;
  pages?: number | null; courses?: number; documents?: number;
}
export interface TrashList { days: number; items: TrashItem[] }

async function call<T>(path: string, method = "GET"): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { method, credentials: "include", headers: method === "GET" ? {} : { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
  if (!res.ok) await throwForResponse(res);
  return (await res.json()) as T;
}

export const fetchTrash = () => call<TrashList>("/trash");
export const restoreItem = (id: string) => call<{ ok: true; kind: "document" | "course"; id: string; name: string }>(`/trash/${encodeURIComponent(id)}/restore`, "POST");
export const deleteForever = (id: string) => call<{ ok: true }>(`/trash/${encodeURIComponent(id)}`, "DELETE");
