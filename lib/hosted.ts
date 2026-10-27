import type { TtxPhase } from "@/lib/ttx";

/**
 * Integration points for the paid hosted service (`READYSTATE_MODE=hosted`).
 * Self-hosted installs never touch this module.
 *
 * To launch the hosted service, implement `HostedServices` (intended stack:
 * Supabase Auth for `authenticate`, the `subscriptions` / `usage_events`
 * tables for `checkQuota` / `recordUsage`, Stripe webhooks keeping
 * `subscriptions` current) and return it from `getHostedServices`. Until then
 * hosted mode fails closed with 503. See docs/architecture/deployment-modes.md.
 */
export interface HostedAccount {
  userId: string;
}

export type QuotaDecision = { allowed: true } | { allowed: false; reason: string };

export interface UsageEvent {
  phase: TtxPhase;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface HostedServices {
  /** Resolves the signed-in account from the request, or `null` if signed out. */
  authenticate(req: Request): Promise<HostedAccount | null>;
  /** Whether the account's plan or credits allow another model call. */
  checkQuota(account: HostedAccount): Promise<QuotaDecision>;
  /** Records one completed model call for metering and billing. */
  recordUsage(account: HostedAccount, usage: UsageEvent): Promise<void>;
}

/** Returns the hosted-service implementation, or `null` while none is wired up. */
export function getHostedServices(): HostedServices | null {
  return null;
}
