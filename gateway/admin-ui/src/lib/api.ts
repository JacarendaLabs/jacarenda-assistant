/**
 * Thin fetch wrapper that:
 *   - always targets same-origin `/admin/api/*`
 *   - includes cookies (credentials: 'same-origin')
 *   - parses JSON if present, else returns null
 *   - never throws on non-2xx — the caller decides what status means
 */
export interface ApiResult<T = unknown> {
  status: number;
  data: T | null;
}

export async function api<T = unknown>(
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH",
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  return { status: res.status, data };
}
