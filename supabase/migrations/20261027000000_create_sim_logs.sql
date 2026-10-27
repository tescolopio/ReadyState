-- Tier 2 "Cloud Sync": sanitized exercise logs, isolated per user via RLS.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the scenarios log table
CREATE TABLE public.sim_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    scenario_type TEXT NOT NULL,
    turn_count INT NOT NULL,
    final_grade JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (Default Deny)
ALTER TABLE public.sim_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only insert their own logs
CREATE POLICY "Users can insert own logs"
ON public.sim_logs FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only read their own logs
CREATE POLICY "Users can view own logs"
ON public.sim_logs FOR SELECT
USING (auth.uid() = user_id);
