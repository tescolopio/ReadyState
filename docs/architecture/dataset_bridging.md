# Dataset Bridging: Medical Conditions to Functional Constraints

To translate sensitive medical data into actionable survival logic without exposing Protected Health Information (PHI), ReadyState needs a bridging layer. It categorizes the logistical burden of a condition rather than its clinical diagnosis, so the AI can calculate consequences from strict medical baselines without ever seeing the diagnosis.

Sources for the thresholds are listed in [Data sources](datasources.md). See [Fit with the current architecture](#fit-with-the-current-architecture) for where this data should live.

## 1. Schema: functional constraints

The proposed `health_constraints` table strips away the specific illness and stores only physical and logistical limitations.

```sql
CREATE TYPE constraint_category AS ENUM (
  'temperature_dependent',
  'power_dependent',
  'supply_dependent',
  'mobility_restricted',
  'environmental_sensitive'
);

CREATE TABLE public.health_constraints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_profile_id UUID REFERENCES public.user_profiles(id),
    category constraint_category NOT NULL,

    -- Specific functional thresholds
    max_safe_temp_celsius DECIMAL(5,2), -- e.g. 8.0 for insulin
    min_power_watts INT,                -- e.g. 60 for a CPAP without humidifier (see review notes)
    stockpile_buffer_days INT,          -- the household's actual on-hand supply

    -- Tag sent to the model in place of the condition
    llm_obfuscation_tag VARCHAR(50) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 2. Functional mapping dictionary

When a user enters household details, the client-side obfuscation layer maps each condition to the constraint variables above.

### Type 1 diabetes or biologic treatments

- **User input:** "Type 1 diabetic taking Humalog."
- **LLM tag:** `[Refrigerated Medication Dependent]`
- **Simulation logic:** FDA labeling defines refrigerated storage as 2–8 °C (36–46 °F). If a summer outage pushes the cooler above that range, the AI triggers a stability assessment, and the user must decide whether the product is still safe to use and how to keep it cool.

### Asthma or COPD

- **User input:** "Severe asthma, needs a nebulizer and inhalers."
- **LLM tags:** `[Hardware Power Dependent]`, `[Air Quality Sensitive]`
- **Simulation logic:** CDC continuity-of-care guidance recommends keeping an emergency supply of prescription medications, including inhalers, in waterproof, childproof containers. In a wildfire scenario, the AI injects smoke and respiratory-distress triggers, and the nebulizer draws on the household's backup power.

### Severe allergies (anaphylaxis)

- **User input:** "Deadly peanut allergy."
- **LLM tags:** `[Anaphylaxis Risk]`, `[Epinephrine Dependent]`
- **Simulation logic:** based on Wilderness Medical Society guidance for anaphylaxis in delayed-care settings. If the participant meets a trigger and doesn't say they're using the auto-injector, the AI escalates the reaction.

### Chronic pain or hypertension

- **User input:** "Daily lisinopril and oxycodone for back pain."
- **LLM tag:** `[Daily Maintenance Medication: Controlled]`
- **Simulation logic:** the AI tracks `stockpile_buffer_days`. If the household has 3 days of medication and the disaster lasts a week, the AI plays out the consequences of running out. Controlled substances also need to stay in labeled pharmacy containers during an evacuation to avoid legal and logistical problems.

## 3. How the AI uses this in the game loop

The AI only sees the obfuscation tag, so it can generate specific, realistic injects without knowing the underlying condition.

Example inject for `[Refrigerated Medication Dependent]`:

> It is Hour 36 of the grid failure. The temperature in your house has reached 88 °F, and the ice in your cooler has melted, so your [Refrigerated Medication] has been above its 8 °C storage limit for several hours. Heat exposure can reduce how well it works. What will you do to keep it cool, and do you have a backup supply?

## Fit with the current architecture

_Added while formatting (2026-10-27)._

- **Where the data lives.** The design brief keeps detailed household profiles on the device and sends only the attributes an exercise needs. The live privacy ledger is memory-only; explicit local exercise snapshots or password-encrypted full backups can preserve it. By default the condition-to-constraint mapping runs in the browser, with profiles stored locally. A server-side `health_constraints` table would hold health information and should exist only for hosted Cloud Sync (H6), opt-in and encrypted. `public.user_profiles` doesn't exist yet either.
- **Tags already in use.** The game prompt already treats bracketed tags such as `[Requires Refrigeration]` as placeholders to reuse verbatim. This dictionary should become the canonical tag list, emitted by the structured household form (F2) rather than typed by hand.
- **Tone.** The design brief asks for calm, non-shaming prompts. Injects should be realistic, not "terrifying"; the example above follows that.

## Review notes

- **CPAP wattage.** The draft used 300 W as the example for a CPAP. Typical CPAP machines draw about 30–60 W, and up to roughly 90 W with a heated humidifier. 300 W is closer to an oxygen concentrator. Use manufacturer figures per device.
- **Stockpile guidance.** The draft quoted "at least a 7 to 10-day supply" here and "1 to 2 weeks" in the data sources doc. Settle on the CDC wording.
- **Unresolved citations.** `[cite: …]` markers without a reference list were removed. Each threshold needs a primary source before it's used (Research R1), and medical content needs D6 sign-off.
