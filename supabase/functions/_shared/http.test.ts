import { assertEquals } from "jsr:@std/assert@^1";
import { HttpError, jsonResponse, readJsonBody, withJsonApi } from "./http.ts";

const ORIGIN = "https://projectcarlo.com";

function withAllowedOrigins<T>(value: string, run: () => T): T {
  Deno.env.set("ALLOWED_ORIGINS", value);
  try {
    return run();
  } finally {
    Deno.env.delete("ALLOWED_ORIGINS");
  }
}

function post(body: unknown, origin = ORIGIN): Request {
  return new Request("https://functions.test/stripe-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

Deno.test("answers a preflight with 204 and the CORS headers", async () => {
  const response = await withAllowedOrigins(
    ORIGIN,
    () =>
      withJsonApi(() => Promise.resolve(jsonResponse({}, 200)))(
        new Request("https://functions.test/stripe-checkout", {
          method: "OPTIONS",
          headers: { Origin: ORIGIN },
        }),
      ),
  );

  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

Deno.test("rejects anything that is not a POST", async () => {
  const response = await withAllowedOrigins(
    ORIGIN,
    () =>
      withJsonApi(() => Promise.resolve(jsonResponse({}, 200)))(
        new Request("https://functions.test/stripe-checkout", { method: "GET" }),
      ),
  );

  assertEquals(response.status, 405);
  assertEquals(response.headers.get("Allow"), "POST, OPTIONS");
});

Deno.test("adds CORS headers to a successful response", async () => {
  const response = await withAllowedOrigins(
    ORIGIN,
    () =>
      withJsonApi(() =>
        Promise.resolve(jsonResponse({ url: "https://stripe.test" }, 200))
      )(
        post({}),
      ),
  );

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assertEquals(await response.json(), { url: "https://stripe.test" });
});

Deno.test("leaves CORS headers off for an origin that is not allowed", async () => {
  const response = await withAllowedOrigins(
    ORIGIN,
    () =>
      withJsonApi(() => Promise.resolve(jsonResponse({}, 200)))(
        post({}, "https://evil.test"),
      ),
  );

  assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("turns an HttpError into its status and code", async () => {
  const response = await withAllowedOrigins(
    ORIGIN,
    () =>
      withJsonApi(() =>
        Promise.reject(new HttpError(409, "already_subscribed", "Nope."))
      )(
        post({}),
      ),
  );

  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    error: { code: "already_subscribed", message: "Nope." },
  });
});

Deno.test("does not leak an unexpected error to the caller", async () => {
  const response = await withAllowedOrigins(
    ORIGIN,
    () =>
      withJsonApi(() => Promise.reject(new Error("STRIPE_SECRET_KEY=sk_live_secret")))(
        post({}),
      ),
  );

  assertEquals(response.status, 500);
  const body = await response.text();
  assertEquals(body.includes("sk_live_secret"), false);
});

Deno.test("reads a JSON object body and rejects everything else", async () => {
  assertEquals(await readJsonBody(post({ plan: "monthly" })), { plan: "monthly" });

  for (const body of ["[]", '"nope"', "not json"]) {
    const request = new Request("https://functions.test/stripe-checkout", {
      method: "POST",
      body,
    });
    let code: string | undefined;
    try {
      await readJsonBody(request);
    } catch (error) {
      code = error instanceof HttpError ? error.code : undefined;
    }
    assertEquals(code, "invalid_json", `expected ${body} to be rejected`);
  }
});
