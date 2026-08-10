/** Error shapes shared by the account API layer and the UI that renders them. */

/** PostgREST reports a policy refusal as insufficient_privilege, with no detail
 *  about which policy refused. */
const INSUFFICIENT_PRIVILEGE = "42501";

/** Raised when the database refuses a write because the trial has run out and
 *  there is no subscription. The check lives in the insert policy, so this is
 *  how the client finds out. */
export class AccessRequiredError extends Error {
  constructor() {
    super("Your trial has ended. Subscribe to keep using Project Carlo.");
    this.name = "AccessRequiredError";
  }
}

export class FunctionCallError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FunctionCallError";
    this.code = code;
  }
}

export function isPolicyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === INSUFFICIENT_PRIVILEGE
  );
}

/** Reads the { error: { code, message } } body the edge functions return. */
export function parseFunctionErrorPayload(
  payload: unknown,
): { code: string; message: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;

  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || typeof message !== "string") return null;
  if (code.length === 0 || message.length === 0) return null;

  return { code, message };
}
