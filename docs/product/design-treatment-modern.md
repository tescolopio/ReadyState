# ReadyState Modern Design Treatment

**Style B · Version 0.1 · October 27, 2026**

Style A is the Journal treatment in the [design brief](design-brief.md). Both are built on shared theme tokens and compared in an A/B test; see [Work breakdown](../roadmap/work-breakdown.md#product-direction).

## 1. Purpose and design position

ReadyState helps individuals, households and connected families practice emergency decisions through personalized tabletop exercises. Participants read a developing situation, explain what they would do, receive reasoned feedback and turn lessons into practical actions.

The Modern treatment expresses this through an organized digital workspace: midnight navy surfaces, crisp typography, cyan actions, clear scenario cards and a compact view of connected households. It should communicate intelligence and control while remaining approachable to someone trying their first exercise.

This document is a proposed design and implementation plan, not a record of completed functionality. The user has expressed equal interest in Style A, the planner/journal direction, and Style B, the modern technology direction. Developing Style B does not retire Style A or commit the product to maintaining two appearance modes.

### Direction already established

- Use **ReadyState** as the current display spelling.
- Support individual and household practice, with extended-family coordination across a maximum of **three households** for the current design scope.
- Let people use their own devices during group exercises.
- Give each household its own situation before connecting decisions at shared moments.
- Offer a short sample before signup; place advanced customization inside the application.
- Generate developing injects that reflect context and earlier choices.
- Let organizers choose response visibility, with the rule visible before participants answer.
- Support a local/self-hosted option and a paid hosted convenience service as product intentions.
- Use dots gathering into a solid home as the current app-icon direction.

### Proposed for this treatment

The tokens, layouts, screen details, permissions model, state behavior, accessibility targets and delivery sequence below are design recommendations. Validate them through prototypes before treating them as release commitments.

## 2. Experience principles

1. **The next decision is the focal point.** The current situation and response area dominate the exercise screen.
2. **Technology makes complexity manageable.** Show relevant household context and dependencies without turning the app into a wall of charts.
3. **Practice stays clearly labeled.** A simulation timestamp, fictional outage or participant progress indicator must not resemble live emergency monitoring.
4. **People control their context.** Make the active household, audience and response visibility understandable at the point of use.
5. **Learning leads to action.** Connect feedback to a small number of practical tasks and preserve the original decision for review.
6. **Detail is progressive.** Newcomers can start quickly; experienced users can reveal history and exercise controls when useful.
7. **Progress measures practice.** Exercise completion, action completion and real-world readiness are different concepts. Avoid a universal readiness percentage.

The desired impression is a capable personal planning application. Avoid military command-center styling, surveillance imagery, decorative telemetry, financial charts, constant animation and unsupported claims of AI certainty.

## 3. Audience and design implications

| Persona | Primary need | Modern treatment response |
|---|---|---|
| Alex, curious newcomer | Understand the value quickly | Short sample, fictional household, one decision at a time |
| Sam, household organizer | Prepare for two adults, two children and a dog | Clear household summary, relevant scenario context and manageable follow-up |
| Priya, busy caregiver | Practice despite interruptions | Saved drafts, a concise recap and a prominent next action |
| Morgan, community organizer | Coordinate participants | Visible group context, response rules and shared action ownership |
| Jordan, experienced practitioner | Challenge assumptions | Inspectable history and optional advanced controls after the core flow |

Interest and preparedness remain separate design dimensions. Do not assign people a preparedness level merely from their profession, supplies or chosen persona. Community exercises remain a future scope decision; the three-household cap applies to the initial family design.

## 4. Visual identity

### Wordmark and symbol

Use the exact wordmark **ReadyState**, in a clear sans-serif face with medium or semibold weight. Keep it readable in navigation, without unusual letter substitutions.

Preserve the icon's story: dots on the left gather into the solid home on the right. For Modern surfaces, explore a cyan or near-white version against navy. Keep the identity recognizable across Style A and Style B rather than inventing an unrelated technical logo.

The generated icon and hero are concept references. Production marks should be redrawn as clean vector assets, with simplified small-size versions and verified exports. The generated Modern hero's dotted mark is an exploration, not a replacement for the agreed directional house concept.

### Color tokens

| Token | Initial value | Intended use |
|---|---|---|
| `canvas` | `#0B1422` | Overall background |
| `surface` | `#111F30` | Main panels and navigation |
| `surface-raised` | `#182B3E` | Dialogs, selected supporting panels |
| `input` | `#102235` | Editable fields |
| `border-subtle` | `#294156` | Decorative separators and panel edges |
| `border-control` | `#64819B` | Identifiable input and control boundaries |
| `text-primary` | `#F4F7FB` | Headings and main content |
| `text-secondary` | `#B7C8DA` | Supporting descriptions |
| `text-muted` | `#91A7BC` | Timestamps and tertiary information |
| `action-primary` | `#22D9E8` | Main action fill and active accents |
| `action-hover` | `#62E7F0` | Primary hover fill |
| `on-action` | `#071722` | Text on bright action buttons |
| `success` | `#35D3B0` | Successful save and submitted responses |
| `attention` | `#F5BC59` | Current decision or an item needing attention |
| `error` | `#FF8F96` | Validation and failed operations |
| `focus` | `#9CEFFF` | Keyboard focus outline |

These are starting values, not verified accessibility pairings. Check each actual foreground/background combination, including disabled, hover, selected and error states. A decorative border is not automatically sufficient to identify an input.

Use cyan sparingly: one dominant primary action per task area. Teal indicates an operation or response state, not that a household is physically safe. Amber highlights the current exercise decision, not an automatic real-world alert. Pair every status color with explicit text.

### Typography

- Proposed family: **Inter**, with `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` fallbacks.
- Website headline: 48–64 px on wide screens; 32–40 px on narrow screens.
- App page title: 28–32 px; section title: 20–24 px.
- Scenario and response text: 17–18 px where space permits; body baseline: 16 px.
- Secondary labels: 14 px; avoid tiny text for essential information.
- Body line height: approximately 1.5–1.65. Keep sustained reading around 60–75 characters wide.
- Use sentence case. Reserve all-caps treatment for brief, infrequent labels such as “Simulation.”

### Geometry, depth and decoration

Use a 4, 8, 12, 16, 24, 32, 48 and 64 px spacing scale. Start with 12 px panel corners, 8 px controls and pill-shaped compact statuses. Favor crisp borders over heavy shadows.

A faint static grid or node pattern may support the public hero. Keep reading and response surfaces opaque and visually quiet. Restrained glow may emphasize the hero CTA; it should not surround every interactive element. Avoid glass effects that compromise text contrast.

## 5. Public website treatment

### Hero composition

Use the Modern dashboard preview as the visual anchor. On desktop, allocate roughly 38% of the content width to the message and 62% to the product preview, adjusting for readable dashboard detail. Use a maximum content width around 1280–1440 px with generous gutters.

**Navigation:** ReadyState mark and wordmark, How it works, Exercises, and Sign in. Keep optional deployment information accessible farther down the page.

**Proposed hero copy:**

- Eyebrow: “Personal preparedness, practiced”
- Headline: “Practice the unexpected.”
- Supporting text: “Explore realistic scenarios. Test your decisions. Build your household plan.”
- Primary CTA: “Try a sample exercise”
- Secondary link: “See how it works”

The sample CTA should start a short fixed exercise without requiring account creation. Advanced duration or group settings should not appear in that first interaction.

### Dashboard preview content

Show a clearly labeled simulation with one power-outage inject, a response field, exercise progress, an action plan and a three-household overview. Include example statuses such as “Responded” and “Not submitted.” Avoid making “Thinking” imply detected activity unless the application actually observes a relevant event.

Build final hero text and controls as real interface elements. The generated image is a composition reference; baked-in text, buttons and input fields should not substitute for accessible website controls. If the preview is static, label it as an illustrative example and do not make it appear editable.

### Below the hero

1. Explain the cycle: Situation → Your response → Feedback → Action.
2. Offer a few relatable exercise categories with concise descriptions.
3. Show how a household profile makes practice relevant.
4. Introduce connected family exercises across up to three households.
5. Explain local/self-hosted and hosted options once deployment details are settled.
6. Close with the same sample CTA.

Use actual product capabilities in public copy. Do not add invented customer counts, testimonials, certifications or unsupported privacy promises.

## 6. Application structure

Keep destinations conceptually aligned with the Journal direction so a visual test does not accidentally change the underlying product.

| Destination | Purpose | Primary action |
|---|---|---|
| Journal | Resume practice and review decision records | Resume exercise |
| Exercises | Browse and configure practice | Start exercise |
| My household | Maintain people, needs and resources | Edit household |
| Action plan | Follow through on lessons | Review next action |
| Family workspace | Coordinate the connected exercise | Open shared decision |
| Settings | Account, privacy and deployment controls | Context-dependent |

“Dashboard” describes the Modern layout; changing the Journal destination name is a separate information-architecture decision. Avoid forcing a theme-specific navigation model.

The global shell shows the active household or family context, the current page and secondary settings. Use a clearly labeled context switcher. Switching households must not silently change the audience of an unsent response; save the draft and make its ownership visible.

## 7. Screen-by-screen treatment

### 7.1 First visit and sample

Present one short exercise using a fictional household. A compact summary identifies the assumed people and resources. Let visitors view those assumptions without completing a profile.

Show the inject, response and feedback in sequence. End with one practical takeaway and an optional “Make this mine” step. Explain whether the sample is saved before the visitor exits. Signup and deployment-specific setup follow the demonstration.

### 7.2 Household setup

Use short sections for people, location context, practical needs and resources. Begin with basic household size, age ranges and a general location. Let people add pets, mobility needs, accessibility needs and relevant supplies voluntarily.

Use practical questions rather than a broad “fitness” score. Explain how a detail affects scenarios. Show skipped information as unknown. The exact fields, including any medical or demographic detail, require a separate data design decision.

Offer a preview of the attributes intended for the scenario engine. Distinguish household details from family-shared summaries and optional contribution to product improvement.

### 7.3 Journal home

Lead with a single “Resume exercise” panel containing its title, saved point and a one-sentence recap. Below it, show suggested practice, recent decisions and a short list of unfinished actions.

Use factual labels such as “2 exercises completed” or “3 actions remaining” only when backed by actual records. Avoid decorative progress charts, streak pressure and household safety scores.

### 7.4 Exercise library and configuration

Use a scannable card grid with title, short situation, approximate duration where known and whether the exercise is individual or shared. Initial categories may include power outage, severe weather, flooding and communication disruption; these are proposed content categories.

After setup, offer duration or round-count controls and a continuing-practice option. Reveal advanced options progressively. Show the selected household and any assumptions before starting. Session limits and continuing-mode behavior remain open.

### 7.5 Active exercise

On wide screens, use one dominant scenario column and one narrower context column. Suggested hierarchy:

1. Exercise title and persistent Simulation label.
2. Simulated time, current inject title and situation.
3. Relevant household facts or changes since the previous inject.
4. “What would you do next?” and a generous response area.
5. Primary “Submit response” action and a secondary save/leave action.
6. Compact progress path and expandable previous decisions.

The context column may contain household facts or family progress. Keep it collapsible and subordinate to the decision. Label exercise time separately from actual saved timestamps.

Preserve drafts. After submission, keep the person's original response available and clearly mark it as submitted. Later edits should not silently overwrite the historical response used to generate feedback; define revision behavior before implementation.

### 7.6 Feedback and review

Reveal three sections: **What you covered**, **What to consider**, and **Why it matters**. Explain the assumptions behind suggestions and acknowledge multiple reasonable responses.

Use a proposed next-action control beside a relevant lesson. The participant chooses which actions to keep. Separate general recommendations from household-specific observations. If reviewed guidance is available, expose its source and review information without overwhelming the main response.

The conceptual engine can vary events, but evaluation needs a defined guidance and quality-review process. Do not present an AI-generated “best answer” as universal certainty.

### 7.7 Action plan

Provide simple list views with practical task, owner where relevant, status and originating lesson. Suggested statuses: Open, In progress and Done. Due dates are optional, not automatically imposed.

Let users correct or dismiss a proposed action. In family mode, require a visible distinction between a suggested assignee and someone who has accepted responsibility. Completing the action does not certify the associated risk has been eliminated.

### 7.8 History and debrief

Show injects, submitted responses, feedback and retained actions in chronological order. Use a brief end-of-exercise summary with strengths, unresolved considerations and selected next steps.

Advanced branching diagrams, custom injects and timeline inspection are later proposals. Keep them out of the baseline layout until validated with experienced users.

## 8. Connected family workspace

### Model and layout

A household is the local context; a family connects up to three households. Household situations can differ by location, resources and previous choices. They join at shared decisions rather than assuming everyone experiences identical conditions.

Use three main views:

- **My household:** private situation, response and notes.
- **Family overview:** each household's chosen shared summary and exercise progress.
- **Family decision:** shared inject, permitted responses and agreed actions.

On desktop, a compact three-row overview fits beside the current inject. A small node diagram may reinforce the relationship, but names and statuses must carry the actual information. No exact-address map is necessary.

### Proposed roles and visibility

| Information or action | Suggested default | Decision still needed |
|---|---|---|
| Detailed household profile | Household members with permission | Who can edit and which fields need extra controls |
| Private notes | Author only | Whether an author can deliberately share them |
| Household shared summary | Family participants | Who publishes and can revise it |
| Unrevealed response | Author and explicitly authorized processing | Organizer access and reveal rules |
| Shared action | Relevant participants | Assignment, acceptance and editing rights |
| Exercise configuration | Organizer | Whether configuration can change after starting |

These are proposed permissions, not implemented guarantees. Family membership alone should not imply access to another household's private details.

### Response and timing rules

Support “Reveal as responses arrive” and “Keep hidden until discussion.” State the rule before each response. Choose an explicit reveal mechanism; organizer-triggered reveal is a candidate, not a final decision. Handle participants who are absent, late or disconnected without accidentally disclosing their drafts.

Define checkpoints where household paths converge. A proposed checkpoint shows which households have submitted and explains whether the participant can continue locally or must wait. Avoid a generic loading spinner for a deliberate group wait.

## 9. Components and interaction states

| Component | Required states and behavior |
|---|---|
| Button | Default, hover, focus, pressed, busy and disabled; preserve readable labels |
| Text response | Empty, drafting, saved, saving, failed save and submitted |
| Scenario panel | Loading, available, unavailable and completed; retain prior context on errors |
| Feedback panel | Generating, available, delayed and failed; preserve the submitted response |
| Household row | No response, submitted, waiting at checkpoint and disconnected where observable |
| Visibility badge | Private, shared or hidden until reveal, with explanatory text |
| Action item | Suggested, accepted/open, in progress and done |
| Dialog | Named purpose, clear confirmation and cancel path, predictable keyboard focus |
| Notification | Short factual update, useful recovery action and no unnecessary repetition |

Prefer precise messages: “Your response is saved,” “We could not save your latest changes,” or “Feedback is taking longer than usual.” Never label a draft saved before persistence succeeds. Prevent duplicate submissions while preserving recoverability after a timeout.

A local/self-hosted installation does not automatically mean offline AI generation. If the engine is unavailable, distinguish readable saved content, editable local drafts, synchronization and generation capabilities. Display only capabilities that the implementation actually supports.

## 10. Responsive and platform adaptation

| Surface | Proposed treatment |
|---|---|
| Wide desktop, starting around 1200 px | Persistent sidebar and two-column exercise workspace |
| Mid-size browser/tablet | Collapsible navigation; secondary context beneath or beside the inject when readable |
| Narrow mobile, below roughly 768 px | Single column; labeled primary navigation; context panels become expandable sections |
| Desktop application | Shared design system, with platform-appropriate window and file/export behavior |
| Public mobile website | Message and CTA first, simplified dashboard preview below |

Breakpoints are initial layout heuristics; adapt to content fit rather than device labels. On mobile, order content as situation, relevant context, response, feedback, then history. Family context remains accessible without taking over the response screen.

Ensure the on-screen keyboard does not obscure the input or primary action. Avoid shrinking the entire desktop dashboard into a phone. Use the same underlying terminology and state rules across hosted web, mobile and desktop surfaces.

## 11. Accessibility and motion targets

- Target at least 4.5:1 contrast for normal text, 3:1 for large text and 3:1 for essential control boundaries and state indicators where applicable; verify actual components before claiming conformance.
- Design comfortable controls around 44 × 44 CSS pixels where practical, including icon buttons and mobile navigation.
- Support keyboard operation, visible focus, meaningful headings, persistent input labels and screen-reader status announcements.
- Preserve readable reflow and usability with text enlargement. Do not hide essential actions on hover.
- Pair colors with text or icons. Icons need accessible names; decorative node patterns should be ignored by assistive technology.
- Keep changes brief and purposeful, approximately 120–180 ms for simple feedback. Respect reduced-motion preferences.
- Avoid blinking alerts, animated particle fields behind text and forced timed responses in the baseline exercise.

These are proposed acceptance targets, not a completed accessibility audit.

## 12. Assets and production preparation

| Asset | Production direction | Priority |
|---|---|---|
| Modern wordmark and home symbol | Vector redraw; dark/light and small-size variants | First |
| Website dashboard hero | Responsive layout with live copy; accessible static preview if needed | First |
| Token and component reference | Colors, typography, spacing, states and usage examples | First |
| Exercise and feedback screens | Desktop and mobile; identical content to Style A test | First |
| Family overview | Three household states and shared-decision checkpoint | Next |
| Scenario artwork | Consistent, secondary to text; do not use imagery to imply urgency | Later |
| Empty and error states | Short helpful copy; restrained optional illustrations | Next |
| Platform icon exports | Square source, safe padding and required platform sizes | Before release |

Keep generated concept imagery separate from production source assets. Do not depend on temporary chat file paths in a deployed application. Final export dimensions and formats should follow the selected platforms' requirements once those platforms are chosen.

## 13. Architecture and implementation approach

This treatment does not choose a framework, AI provider or hosting architecture. Its implementation recommendation is to separate reusable presentation components from scenario state and household permissions.

Define semantic theme tokens so Style A and Style B can be evaluated against the same functional screens. Avoid duplicating scenario logic per theme. A selectable appearance mode remains optional until testing justifies its maintenance cost.

Minimum interface concepts include Household, Family group, Exercise session, Inject, Submitted response, Feedback, Action item and Sharing rule. Define relationships and authoritative saved state before implementing optimistic updates or cross-device coordination.

Treat privacy choices, response reveal and household access as enforced behavior, not merely visual badges. Keep detailed profile inputs, engine attributes and optional research/product contributions distinct. Establish retention, deletion and export behavior in a separate implementation specification.

## 14. Delivery sequence and review gates

### Phase 1 — Establish the Modern system

Create production-quality mark explorations, token definitions and a compact component sheet. Design the public hero and an active exercise at desktop and mobile widths.

**Review gate:** users recognize the next action, read the scenario comfortably and understand that it is a simulation. The interface feels useful without decorative telemetry.

### Phase 2 — Complete the individual journey

Design the sample, setup, resume state, exercise, feedback, action plan and debrief. Include saving failures and generation delays, not just ideal states.

**Review gate:** a new participant can finish the sample, identify one useful lesson, pause and resume, and distinguish an exercise result from real-world readiness.

### Phase 3 — Validate three-household coordination

Prototype household switching, shared summaries, hidden and immediate response visibility, group checkpoints and accepted action ownership.

**Review gate:** participants correctly identify what is private, what is shared, who is waiting and when responses become visible.

### Phase 4 — Implement and evaluate

Build the validated flow, check contrast and responsive behavior, verify draft persistence and group permissions, and test with representatives of the five personas.

**Review gate:** complete the main tasks with keyboard and touch, preserve responses through errors, and resolve material confusion before adding advanced controls.

### Phase 5 — Consider advanced features

Evaluate continuing practice, custom injects, deeper decision review, community facilitation and appearance selection. Scope each from demonstrated user needs.

## 15. Comparing Style A and Style B

Test the same scenario, text, CTA and functional steps in both treatments. Style A uses the journal presentation; Style B uses the Modern dashboard. This compares the overall treatment rather than isolating a single color or font.

For a public website experiment, use sample starts per eligible unique visitor as a proposed primary measure, with sample completion as a quality check. For an interactive prototype, observe response completion, next-action discovery, household-context mistakes, privacy misunderstandings and perceived comfort.

Do not choose a winner solely from visual preference or raw click counts. Review whether people understand the product and complete useful practice. Establish assignment, measurement, privacy-conscious analytics, sample size and stopping criteria before running a live test; this document does not prescribe unsupported thresholds or a guaranteed duration.

## 16. Open decisions

- Confirm final logo geometry and how cyan Modern colors relate to the teal-and-amber base identity.
- Decide whether Style B is dark-only for initial testing or needs a separate light treatment.
- Choose whether “Journal” remains the main record destination in both styles.
- Specify account and local-setup differences, offline behavior and synchronization.
- Define individual versus household submission and organizer permissions.
- Decide reveal triggers, convergence rules, late responses and changes to a running exercise.
- Select reviewed preparedness guidance and feedback quality controls.
- Set initial scenario content, customization limits and release scope.
- Determine whether both appearance treatments warrant ongoing support after testing.

## 17. Definition of a complete Modern design handoff

- [ ] Brand mark, wordmark and export guidance are documented.
- [ ] Semantic tokens and accessible component states are specified.
- [ ] Public hero and sample entry are designed at mobile and desktop widths.
- [ ] Individual exercise, response, feedback and action flow are covered.
- [ ] Three-household private and shared views are distinguishable.
- [ ] Loading, saving, waiting, failure and recovery states are included.
- [ ] Keyboard flow, labels, contrast and reflow have been reviewed.
- [ ] Proposed functionality is distinguished from implemented capability.
- [ ] Style A comparison uses equivalent content and tasks.
- [ ] Remaining product, privacy and engineering decisions have named owners before development commitments are made.

The immediate next design deliverable is the same power-outage exercise in Modern desktop and mobile layouts, showing a new inject, a draft response and revealed feedback, followed by the three-household coordination view.
