/** Environment access with a loud, single failure mode.
 *
 *  A function that is missing a secret should fail as a 500 with a message
 *  naming the variable, not as a confusing downstream error from the Stripe or
 *  Supabase SDK.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value ? value : undefined;
}
