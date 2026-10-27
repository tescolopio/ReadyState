-- Hosted service: subscriptions (kept current by Stripe webhooks) and per-call
-- usage metering. Only the server (service role) writes; users read their own.

-- One row per account, upserted from Stripe webhook events.
CREATE TABLE public.subscriptions (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    plan TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'inactive',
    -- Prepaid exercise credits for pay-per-use plans.
    credits_remaining INT NOT NULL DEFAULT 0,
    current_period_end TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per completed model call, written by HostedServices.recordUsage.
CREATE TABLE public.usage_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    phase TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_tokens INT,
    output_tokens INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX usage_events_user_created_idx
    ON public.usage_events (user_id, created_at DESC);

-- Enable RLS (Default Deny). No INSERT/UPDATE policies: only the service role
-- (which bypasses RLS) can write, so users can't grant themselves credits.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription"
ON public.subscriptions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can view own usage"
ON public.usage_events FOR SELECT
USING (auth.uid() = user_id);
