/** Stripe client configured for the Deno edge runtime. */

import Stripe from "stripe";
import { requireEnv } from "./env.ts";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    client = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
      // Deno has no Node http module, so the SDK needs its fetch transport.
      httpClient: Stripe.createFetchHttpClient(),
      appInfo: { name: "Project Carlo", url: "https://projectcarlo.com" },
    });
  }
  return client;
}

/** Web Crypto is async-only, so webhook signatures must be checked with
 *  constructEventAsync and this provider rather than the synchronous default. */
export const cryptoProvider = Stripe.createSubtleCryptoProvider();
