/** Creates a Stripe Billing Portal session for the signed-in user.
 *
 *  POST { returnPath?: string }  ->  { url }
 *
 *  The portal is what lets people update a card, download invoices, and cancel
 *  without any of that being built here — and cancelling through it produces the
 *  same customer.subscription.updated webhook the rest of the flow relies on.
 */

import { requireEnv } from "../_shared/env.ts";
import { HttpError, jsonResponse, readJsonBody, withJsonApi } from "../_shared/http.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";
import { getStripe } from "../_shared/stripe.ts";
import { siteUrlFor } from "../_shared/urls.ts";
import { findStripeCustomerId } from "../_shared/customers.ts";

const DEFAULT_RETURN_PATH = "/account";

Deno.serve(withJsonApi(async (req) => {
  const user = await requireUser(req);
  const body = await readJsonBody(req);

  const admin = createServiceClient();
  const customerId = await findStripeCustomerId(admin, user.id);

  if (!customerId) {
    throw new HttpError(
      404,
      "no_customer",
      "There is nothing to manage yet — start a subscription first.",
    );
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: siteUrlFor(body.returnPath, requireEnv("SITE_URL"), DEFAULT_RETURN_PATH),
  });

  return jsonResponse({ url: session.url }, 200);
}));
