/** Small HTTP helpers shared by the browser-facing functions. */

import { ConfigError } from "./env.ts";
import { corsHeadersForRequest } from "./cors.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  if (req.headers.get("Content-Length") === "0") return {};
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/** Wraps a handler with CORS, method checking, and error translation, so each
 *  function body can deal only with its happy path. */
export function withJsonApi(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const cors = corsHeadersForRequest(req);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== "POST") {
      return jsonResponse(
        { error: { code: "method_not_allowed", message: "Use POST." } },
        405,
        { ...cors, Allow: "POST, OPTIONS" },
      );
    }

    try {
      const response = await handler(req);
      for (const [key, value] of Object.entries(cors)) {
        response.headers.set(key, value);
      }
      return response;
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(
          { error: { code: error.code, message: error.message } },
          error.status,
          cors,
        );
      }
      // A missing secret is an operator problem, so log the detail but keep it
      // out of the response.
      console.error(
        error instanceof ConfigError ? `Configuration: ${error.message}` : error,
      );
      return jsonResponse(
        {
          error: {
            code: "internal_error",
            message: "Something went wrong. Please try again.",
          },
        },
        500,
        cors,
      );
    }
  };
}
