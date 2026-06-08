/**
 * Thin HTTP client over /api2/index.php.
 *
 * The PHP endpoint expects a multipart-encoded POST with a `file` field
 * containing the legacy {"FONT":{"API_KEY","BASE64","INFO":{...}}} JSON
 * envelope — same shape the Android app + web API have always used. We
 * keep that envelope here so the backend stays unchanged.
 *
 * One useful HTTP-status convention:
 *   200      → JSON array of matches (success)
 *   402      → quota_exceeded (free tier used + balance empty)
 *   409      → invalid / revoked API key
 *   429      → daily limit hit (legacy-key path) — shouldn't fire for MCP keys
 *   422      → image issue (URL unreachable, unsupported format, too big, …)
 *   5xx      → backend error
 *
 * The PHP errors come back as plain text bodies (e.g. "Invalid or revoked
 * API key") rather than JSON, so we surface the HTTP code + body in the
 * thrown error message.
 */

export interface IdentifyOpts {
  apiKey: string;
  baseUrl: string;
  imageUrl?: string;
  imageBase64?: string;
}

export interface FontMatch {
  title: string;
  url: string;
  image: string;
  image1: string;
  image2: string;
  type: "Free" | "Commercial" | string;
  site: string;
}

export interface Quota {
  mode: "free" | "paid";
  used_today: number;
  limit: number;
  free_remaining: number;
  balance: number;
  credits_per_usd: number;
}

export interface IdentifyResult {
  results: FontMatch[];
  quota: Quota | null; // null for legacy / non-MCP responses
}

export class WfiApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "WfiApiError";
  }
}

/**
 * Call the /api2/index.php endpoint and return the parsed font matches.
 *
 * Throws WfiApiError on non-200 responses with the parsed status code +
 * raw body so the tool handler can map known cases to friendly messages.
 */
export async function identifyFont(opts: IdentifyOpts): Promise<IdentifyResult> {
  const { apiKey, baseUrl, imageUrl, imageBase64 } = opts;

  if (!imageUrl && !imageBase64) {
    throw new Error("identify_font: pass either image_url or image_base64");
  }
  if (imageUrl && imageBase64) {
    throw new Error("identify_font: pass only one of image_url / image_base64");
  }

  // Build the legacy envelope the backend already understands.
  // WANT_QUOTA=1 opts in to the v0.2.0+ envelope response shape
  // ({results, quota}); v0.1.0 backends ignore the flag and return a
  // bare array, which our parser still accepts.
  const envelope = {
    FONT: {
      API_KEY: apiKey,
      BASE64: imageBase64 ? 1 : 0,
      WANT_QUOTA: 1,
      INFO: imageBase64
        ? { urlimagebase64: stripDataUriPrefix(imageBase64) }
        : { urlimage: imageUrl },
    },
  };

  // The PHP endpoint reads $_POST['file']; multipart/form-data is what
  // the existing Android client sends, and it's also what wins us a
  // bigger payload budget than urlencoded (base64 images can be MBs).
  const form = new FormData();
  form.append("file", JSON.stringify(envelope));

  const url = trimTrailingSlash(baseUrl) + "/api2/index.php";

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new WfiApiError(0, "", `Network error reaching ${url}: ${msg}`);
  }

  const bodyText = await res.text();

  if (!res.ok) {
    throw new WfiApiError(
      res.status,
      bodyText,
      mapErrorToFriendly(res.status, bodyText),
    );
  }

  // Successful response: bare JSON array of FontMatch.
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new WfiApiError(
      res.status,
      bodyText,
      `Unexpected response from ${url} — not JSON: ${bodyText.slice(0, 200)}`,
    );
  }

  // Two valid shapes:
  //   1. Bare array of FontMatch (legacy / non-MCP keys)
  //   2. Envelope { results: FontMatch[], quota: {...} } (MCP keys)
  // The MCP key path emits the envelope so the client can show usage info;
  // every other key keeps the historical bare-array contract intact.
  if (Array.isArray(parsed)) {
    return { results: parsed as FontMatch[], quota: null };
  }
  if (
    parsed && typeof parsed === "object" &&
    Array.isArray((parsed as { results?: unknown }).results)
  ) {
    const obj = parsed as { results: FontMatch[]; quota?: Quota };
    return { results: obj.results, quota: obj.quota ?? null };
  }

  throw new WfiApiError(
    res.status,
    bodyText,
    `Unexpected response shape — expected array or {results,quota}, got ${typeof parsed}`,
  );
}

function stripDataUriPrefix(b64: string): string {
  // Allow callers to pass either a raw base64 string OR a full data:URI
  // (Claude often produces data:image/png;base64,xxx when piping uploads).
  const m = b64.match(/^data:image\/[a-z0-9+.-]+;base64,(.*)$/i);
  return m ? m[1] : b64;
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function mapErrorToFriendly(status: number, body: string): string {
  // The PHP backend sends plain-text reasons in the body. Translate the
  // common ones into actionable advice for the AI client / human user.
  const trimmed = body.trim().slice(0, 200);
  switch (status) {
    case 402:
      return `Quota exceeded: your free 200/day is used and credit balance is empty. Top up at https://www.whatfontis.com/credits.html`;
    case 409:
      return `Invalid API key. Generate one at https://www.whatfontis.com/credits.html and set WFI_API_KEY in your MCP client config.`;
    case 422:
      return `Image issue: ${trimmed}`;
    case 429:
      return `Rate limited: ${trimmed}`;
    case 503:
      return `WhatFontIs MCP API is temporarily disabled — please try again later.`;
    default:
      return `WhatFontIs returned HTTP ${status}: ${trimmed}`;
  }
}
