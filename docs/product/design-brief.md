# Ready State: Product and Experience Design Brief

_Version 0.1 · October 27, 2026_

Ready State is a smart tabletop exercise application that helps individuals, households, extended families and communities practice decisions before an emergency. Its experience centers on a personal preparedness field journal: read a developing situation, explain a response, learn what was considered or missed, and turn lessons into practical actions.

This brief gives product, design and development work one reference for the concept, intended users, interface, visual style and initial family exercise model. The immediate design priority is the exercise and feedback experience across mobile, desktop and web.

How this brief maps to engineering work: [Work breakdown](../roadmap/work-breakdown.md#product-direction).

## 1. Product direction

The core ideas are preparedness, intelligence and forward thinking. The journal should feel warm, capable and approachable. An unfinished path represents decisions already made and the opportunity to take the next step.

- **Personalized practice** reflects a household's circumstances, resources and constraints. Responses influence subsequent scenario developments, called *injects*.
- **Feedback** compares the response with sound preparedness considerations and explains the reasoning. Different circumstances can support different reasonable decisions.
- **A short sample** demonstrates the experience before account creation. More detailed setup and exercise customization belong inside the application.
- **Deployment:** self-hosted or local deployment and an optional paid hosted service are intended options. The hosted service provides convenience; the core identity stays consistent.

### How to read the decisions

- **Agreed direction:** explicitly selected or supported in the discussion.
- **Proposed:** a design suggestion that still needs validation.
- **Open:** no final decision was made.

These labels describe product intent, not implementation status.

Ready State is the display name used here. RdyState is the project context; final brand spelling, logo artwork, technology stack and pricing remain open. No competitor findings were established during the discussion.

## 2. People and user stories

Use five personas to test the interface against different motivations. Interest and preparedness are separate dimensions: someone can be highly motivated with little preparation, or well supplied with little experience practicing decisions. These are design descriptions, not user scores.

| Persona | Situation and motivation | Interface priority |
| --- | --- | --- |
| **Alex**, the curious newcomer | Lives alone in an apartment; has a flashlight and power bank, but little planning experience. An outage prompted curiosity. | Try a short sample without a profile; leave with one useful takeaway. |
| **Sam**, the household organiser | Married, with a spouse, two children and a dog in suburbia. Motivated to make household planning practical. | Easy household setup, relevant prompts, pause and resume, and a manageable action plan. |
| **Priya**, the busy caregiver | Nurse with long shifts, a partner and elder care responsibilities. Motivated but short on time. | Automatic saving, brief recaps, one priority action and a concise summary to discuss with a partner. |
| **Morgan**, the community organiser | Comfortable coordinating people and plans; wants neighbours to practice together. | Separate devices, shared decisions, clear assignments and a shareable summary. |
| **Jordan**, the experienced practitioner | Emergency management volunteer with supplies and drill experience. Wants to challenge existing plans. | Advanced exercise controls and decision review; custom injects and branching views are proposals. |

### Representative user stories

- As **Alex**, I want to try a realistic sample with a fictional profile so I can judge its value before creating an account.
- As **Sam**, I want the exercise to account for children and pets so I can discover practical gaps in my family's plan.
- As **Priya**, I want to resume with my response intact and a short recap so interruptions do not force me to restart.
- As **Morgan**, I want participants to respond on their own devices and agree who will do what so the exercise produces a shared plan.
- As **Jordan**, I want choices to affect later injects and a record of my decisions so I can stress-test assumptions.

## 3. Journey and navigation

### Sample experience

The public entry point offers **"Try a sample exercise."** A visitor uses a pre-filled fictional person or household, or supplies a few basic details. Present one short, fixed exercise with a clear situation, response, feedback and takeaway. Offer **"Make this mine"** after the value is visible. Keep round counts and advanced options outside the sample.

### Personal exercise journey

1. Create an account or complete the relevant local setup, then choose a basic household profile. Deployment-specific setup remains to be designed.
2. Add people, needs and resources at the desired level of detail. Allow the person to skip optional questions and return later.
3. Choose an exercise. Inside the application, offer proposed controls for a fixed number of rounds or continuing practice.
4. Read the current inject and relevant household context. Write what you would do before guidance is revealed.
5. Submit the response, review feedback and choose practical follow-up actions. Carry the decision forward into the scenario.
6. Continue, pause or end. Resume at the saved point with a brief recap. At the end, review decisions, lessons and the action plan.

### Core destinations

| Destination | Purpose |
| --- | --- |
| Journal | Resume the current exercise; revisit past situations, decisions and lessons. |
| Exercises | Browse scenarios, start practice and access customization after setup. |
| My household | Manage people, practical needs, available resources and optional details. |
| Action plan | Track real-world follow-up and link each action to its exercise lesson. |
| Settings | Secondary access to account, privacy and deployment preferences. |

Family and community workspaces are proposed additions to this navigation. A household or group switcher could change context without replacing the familiar destinations. The final location of group management is open.

### Progress meaning

Use a path rather than a preparedness percentage. It shows completed decisions, the current step and an open continuation without revealing future injects. Finishing the exercise does not establish real-world readiness.

## 4. Visual identity and style guide

The proposed visual system is a personal field journal with familiar application controls. Warm paper, clear typography and restrained route markings supply character. The interface should remain readable and efficient for both newcomers and experienced users.

### Brand imagery

Explore a simple path connecting three points with a deliberate gap before the final point. It should work as a small app icon as well as beside the wordmark. This is a concept for exploration, not an approved logo. Use simple line illustrations of everyday environments, people and resources. Keep faint paper grain in decorative areas only.

Avoid camouflage, distressed lettering, heavy leather effects and decorative handwriting in instructions. Earlier shield, home, doorway and horizon ideas were exploratory; the unfinished path became the preferred direction.

### Color tokens

| Role | Value | Intended use |
| --- | --- | --- |
| Paper | `#F6F2E9` | Main application background |
| Page | `#FFFCF6` | Cards, entries and forms |
| Ink | `#24342F` | Primary text |
| Secondary ink | `#58645D` | Supporting text |
| Forest teal | `#245C50` | Primary actions and selected navigation |
| Amber | `#A66A16` | Current decision and attention accents |
| Brick | `#A33D32` | Errors and critical feedback |
| Rule | `#D9D3C7` | Decorative dividers |

### Typography and geometry

- **Typefaces:** Source Serif 4 for brand and major headings, with Georgia fallback. Source Sans 3 for body, controls and labels, with system sans-serif fallback.
- **Body text:** start at 16–18 px, with line height around 1.5–1.65 and a reading width of approximately 60–75 characters. Support text scaling.
- **Spacing:** a scale of 4, 8, 12, 16, 24, 32 and 48 px; subtle corners around 8–12 px; thin borders and restrained shadows.

These are proposed design tokens. Verify contrast in actual components. The pale Rule color is decorative and should not be the only boundary identifying an input. Teal and amber statuses always need visible text or icons.

## 5. Interface components and platform behavior

| Component | Design and behavior |
| --- | --- |
| Scenario entry | Show an exercise label, simulated time, concise title, situation and response prompt. Keep one current inject prominent. |
| Response area | Use a spacious field with a persistent label. The person explains their plan before seeing feedback. |
| Primary and secondary actions | Use forest teal for "Submit response." Offer clear secondary controls such as "Save and leave" and "Continue the exercise." |
| Decision path | Mark completed steps and the labeled current decision; leave the continuation open. No future spoilers. |
| Feedback | Separate "What you covered," "What to consider" and "Why it matters." Keep the submitted response available for comparison. |
| Action item | Show a practical next step, completion checkbox and link to the originating lesson. Group ownership is a proposed extension. |
| Bookmark and recap | Return to the saved inject with a concise account of what has happened and what the person decided. |
| Household summary | Present editable people, needs and resources. Identify optional fields and explain how they tailor practice. |

### Adaptation by surface

- **Website:** explain the product, show a journal preview, offer the sample and describe hosted and self-hosted options. The hosted web application uses the same task patterns as the mobile and desktop applications.
- **Mobile:** use one column, labeled bottom navigation and one main task per screen. Put feedback below the response. Default to My household during a family exercise, with the family overview one tap away.
- **Desktop:** use sidebar navigation and an optional two-column workspace. Show the current exercise beside relevant notes, history or a compact family overview. Preserve the mobile reading order.

### Voice and accessibility

Use calm prompts such as "What would you do next?" and "What would change your plan?" Explain assumptions and missed considerations without shaming. Label events as exercise content. Keep transitions brief and respect reduced-motion preferences; page flipping is optional decoration.

Design for keyboard access, visible focus, screen-reader labels, text resizing and touch targets aiming for at least 44 × 44 CSS pixels. Do not make color, gestures, texture or hover the only means of understanding or operating a control.

## 6. Family and community exercise model

**Agreed direction:** begin with the household as the unit of context. A family group can connect up to three households for the current design scope. Participants use their own devices. Different locations and resources produce different household situations that eventually connect through shared decisions.

| Context | Meaning | Exercise emphasis |
| --- | --- | --- |
| Household | People who live together | Shared home, immediate needs and resources |
| Family | Extended family across households | Communication, assistance and coordination between homes |
| Community | Neighbours or another local group | Local coordination, shared needs and voluntary resource support |

The three-household cap is the current family prototype assumption. Community capacity, multiple simultaneous groups and membership rules have not been decided.

### Proposed group screens

- **My household:** current local situation, response area and private notes.
- **Family overview:** up to three named household cards with chosen shared updates and exercise progress. A progress label does not indicate whether the real household is safe.
- **Family decision:** shared inject, participant responses and agreed next steps. Household journals remain accessible in context.

### Response visibility

The organiser can choose whether responses appear as they arrive or remain hidden until discussion. Display the selected rule before anyone answers. The exact reveal trigger, late responses and organiser permissions remain open. Waiting and submitted states use words as well as color.

### Example of connected household paths

A simulated storm leaves Sam's home without power. His parents several hours away still have power but face worsening travel conditions. A sibling farther away is unaffected and may be able to help. Each household first responds to its own situation. A shared inject then asks how the family will coordinate if one household needs somewhere to stay.

Use journal tabs or household cards and a restrained path motif that converges at the shared decision. Distance does not imply equal conditions, shared supplies or safe travel. Shared actions could record who checks on whom, a communication fallback or an agreed meeting plan.

Detailed household profiles and private notes remain inside their household context. Only deliberately shared summaries and decisions appear at family level. The permissions and consent flow still needs specification.

## 7. Personalization, privacy and scenario behavior

### Household profile

Start with household size, age ranges and a general location. Let people progressively add pets, housing, supplies, mobility, accessibility and other relevant needs. The discussion also considered age, sex and physical characteristics; specific fields and their necessity remain open. Prefer practical questions such as whether someone needs help using stairs or carrying supplies.

Explain how each optional detail helps tailor the exercise. A person should be able to practice with limited information, then improve the profile over time. Missing details should remain unknown rather than silently becoming facts.

### Obfuscation direction

The intended direction is a configurable layer between detailed household information and scenario generation. For example, the engine might receive "two adults, one young child, one person needs help with stairs, urban area" rather than names, birth dates and an exact address. Let people choose their level of detail.

A proposed **"What the scenario engine sees"** preview would make the selected attributes visible and editable. Reduced detail lowers unnecessary disclosure but is not a guarantee of anonymity; the technical privacy design remains to be defined.

Separate personalization from optional contribution of data to improve future exercises. Tailored practice should not imply permission to reuse a person's data. For local deployment, the proposed approach keeps detailed profiles locally and passes only necessary attributes to any external service. Offline AI capability and external provider choices remain open.

### Scenario engine concept

The AI prompt combines relevant household context, the selected emergency, exercise history and the participant's decisions. It generates a next inject that follows from the scenario. For example, a decision to drive to a relative's home may be followed by a road closure that requires adapting the plan.

- **Proposed guardrails:** preserve elapsed time, resources and established events; do not contradict earlier choices without an explicit new development.
- **Grounding:** feedback draws on reviewed preparedness guidance, explains reasoning and acknowledges alternative reasonable responses. Guidance sources, review ownership and evaluation rules remain to be selected.
- **Lessons:** use the exercise record to identify missed considerations and practical next steps. Do not equate AI feedback or exercise completion with proof of readiness.

Data retention, deletion, export, contribution consent and family sharing permissions need a separate implementation specification. No architecture, model provider or anonymization method was selected in this discussion.

## 8. Requirements and design checks

The following translates the discussion into checks for a prototype. These checks are proposed; they do not represent completed development or a committed release plan.

| ID | Requirement and review check | Basis |
| --- | --- | --- |
| UX01 | A visitor completes a short fictional sample before signup; customization controls do not appear in the sample. | Agreed direction |
| UX02 | A person submits their own response before feedback is revealed and can read both afterward. | Agreed direction |
| UX03 | An interrupted exercise resumes with its saved response and a brief recap. | Proposed behavior |
| UX04 | A lesson can become a practical action linked to the originating decision. | Supported direction |
| UX05 | Profiles accept basic information and optional detail without blocking first practice. | Agreed direction |
| GR01 | A family prototype supports one, two or three households and clearly identifies the active household. | Agreed cap |
| GR02 | Separate household injects can lead to one shared decision without exposing private notes. | Agreed direction |
| GR03 | Participants see the response visibility rule before answering; hidden responses stay concealed until the chosen reveal. | Agreed choice; trigger open |
| GR04 | Each participant can respond from their own device; shared and private contexts are visibly distinct. | Agreed direction |
| VS01 | Mobile and desktop use the journal palette and the same exercise and feedback labels. | Proposed style |
| PR01 | Personalization and contribution are separate choices; the engine attribute preview is understandable. | Proposed controls |
| AC01 | Core tasks work with keyboard, visible focus and text scaling; status is understandable without color. | Proposed baseline |

### Suggested delivery sequence

First validate the visual identity and individual exercise flow. Then prototype household setup, recaps and action tracking. Next test the family flow with three distinct households, including response reveal and shared decisions. Advanced controls, community facilitation, custom injects and decision trees can follow as separate scope decisions.

The product vision includes self-hosted and paid hosted experiences. Their release order and exact feature parity still need a decision. Custom exercise duration belongs after setup, but its implementation phase is open.

## 9. Prototype plan and open decisions

### First prototype

Design the same power-outage exercise at mobile and desktop sizes in three states: a new inject, a response in progress and feedback revealed. Use Sam's household to test relevance and Alex's sample journey to test the first experience. Show the incomplete path, clear actions and an optional lesson added to the action plan.

Then add a family overview for three households, private local injects and one shared decision. Test both response visibility choices. This should show how the journal works before adding a large set of screens or advanced controls.

### Questions the prototype should answer

- Can **Alex** understand the scenario and answer without a preparedness glossary or account setup?
- Can **Sam** identify which household is active, what the exercise assumes and what remains private?
- Can **Priya** pause and resume without rereading the full scenario or losing a draft?
- Can **Morgan** tell who has responded, when answers will be revealed and who agreed to each action?
- Does **Jordan** find the reasoning useful, with advanced options discoverable after the core flow?

### Decisions to settle next

| Area | Open decision |
| --- | --- |
| Brand | Confirm Ready State versus RdyState naming; develop and compare actual path logo concepts. |
| Visual design | Validate journal styling, typography, contrast and mobile legibility with representative users. |
| Family coordination | Choose individual versus household submission, organiser roles, reveal trigger and handling of absent participants. |
| Shared timelines | Define when household paths converge and whether a household can continue while others are waiting. |
| Group scope | Set community capacity, membership, invitations and whether a person can join multiple groups. |
| Exercise controls | Define round limits, continuing practice, pause behavior and the role of custom injects. |
| Deployment and data | Choose platform delivery, local and hosted architecture, AI provider, retention and sharing controls. |
| Feedback quality | Select reviewed guidance, evaluation criteria and a process for correcting unhelpful or inaccurate feedback. |
| Market review | Complete the requested competitor research separately; the earlier lookup produced no findings. |
