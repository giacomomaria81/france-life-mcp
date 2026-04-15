/**
 * Shared HTTP client for all French government APIs.
 * Uses native fetch (Node 18+), adds timeouts, retries, and error normalization.
 */

export interface ApiRequestOptions {
  baseUrl: string;
  path?: string;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ApiError {
  source: string;
  status: number;
  message: string;
  hint?: string;
}

export async function apiFetch<T>(options: ApiRequestOptions): Promise<T> {
  const { baseUrl, path = "", params = {}, headers = {}, timeoutMs = 10000 } = options;

  // Build URL with query params
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "User-Agent": "france-life-mcp/1.0.0",
        ...headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw {
        source: url.hostname,
        status: response.status,
        message: `API returned ${response.status}: ${errorText.slice(0, 200)}`,
        hint: response.status === 429
          ? "Rate limited. Try again in a few seconds."
          : response.status === 404
            ? "Resource not found. Check your query parameters."
            : undefined,
      } satisfies ApiError;
    }

    return (await response.json()) as T;
  } catch (error: unknown) {
    if ((error as ApiError).source) throw error; // Re-throw our structured errors

    if (error instanceof Error && error.name === "AbortError") {
      throw {
        source: url.hostname,
        status: 408,
        message: `Request timed out after ${timeoutMs}ms`,
        hint: "The API may be slow. Try again or use a simpler query.",
      } satisfies ApiError;
    }

    throw {
      source: url.hostname,
      status: 0,
      message: `Network error: ${error instanceof Error ? error.message : "Unknown"}`,
      hint: "Check your internet connection.",
    } satisfies ApiError;
  } finally {
    clearTimeout(timeout);
  }
}

/** Format tool responses consistently */
export function toolResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function toolError(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const apiErr = error as ApiError;
  const message = apiErr.source
    ? `Error from ${apiErr.source}: ${apiErr.message}${apiErr.hint ? `\nHint: ${apiErr.hint}` : ""}`
    : `Error: ${error instanceof Error ? error.message : String(error)}`;

  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
