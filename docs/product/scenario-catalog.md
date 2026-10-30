# Scenario catalog

**Status:** revised after review, 2026-10-30. Guides development; nothing here is built yet. It extends [Scenario sets and severity](scenario-sets.md). Work items G5 and G14, with R2, R6, R7 and R8.

This maps every planned scenario across the severity levels it supports, and how the household changes each one. Statements about real events and agency guidance need source records (R1) before they reach a prompt or a debrief; §7 lists them.

## 1. How an exercise is assembled

An exercise is built from layers. The first two set the **world**: what happens, what stops working and for how long. The rest set the **stakes**: what that world means for this household.

| Layer | Set by | What it changes |
| --- | --- | --- |
| 1. Scenario and variant | The participant | The kind of emergency, its variant (for example the type of water advisory), its stages and its real hazards |
| 2. Severity | The participant | Duration, reach, which services are out, damage to the home |
| 3. Where and when | Profile region; season; the starting situation (§4) | Which hazards fit, the weather, the time it starts, who is home |
| 4. Home | Profile home | Shelter options, utilities that fail, what breaks |
| 5. People | Profile people and needs | What's at stake, who needs help, who can help |
| 6. Pets and animals | Profile pets | Food, water and shelter limits, and leaving |
| 7. Supplies and plans | Profile supplies, inventory check | Which gaps the story tests |

**The principle: severity sets the world; the household sets the stakes.** The same level 2 power outage is an inconvenience for Alex, a heating problem for Sam's family, and possibly urgent for Priya's mother, depending on what her care plan says about her oxygen. The world stays the same, so exercises are comparable, and the debrief explains why it mattered more for one household than another.

**How the layers reach the engine.** Layers 1–2 come from the scenario file (`data/scenarios/`). Layers 3–7 are the masked household baseline the engine already receives. What's new is **modifier rules**: on the device, the rules engine (`lib/rules/engine.ts`) picks the injects, look-fors and guidance that fit this scenario, level and household, and sends only those. It uses the same facts the inventory check already uses, such as `home.type`, `needs.kinds` and `pets.any`. This keeps the prompt within its token budget and makes the selection testable.

## 2. Severity: a baseline, with scenario overrides

The table is the **default** for each level. Every supported scenario level states its own duration, reach, services and home damage explicitly in §3, and differs from the baseline wherever the hazard does. A home fire at level 3 leaves one household out of its home for weeks while every service in town works normally; a heat wave at level 2 damages nothing but lasts a week.

| | 1 Disruption | 2 Emergency | 3 Disaster | 4 Catastrophe |
| --- | --- | --- | --- | --- |
| **Duration** | Hours to 1 day | 2–4 days | 1–2 weeks | Weeks or more |
| **Reach** | Neighborhood | Town or county | Region | Multi-state |
| **Services** | Working | Some out locally; emergency lines busy | Many out across the region; shelters and distribution points open | Essential services out across a wide area |
| **Home** | Not damaged | Minor damage possible | May be damaged | May be damaged or unlivable |
| **Stores, fuel, cash** | Normal | Key items short | Many closed | Mostly closed |
| **Default** | Yes, for first exercises | Yes | Opt-in | Opt-in, with a confirmation |

**No rescue timelines.** Severity never implies "help is days away" or "weeks away". Each level record names which services are unavailable and **what the participant knows**: what radio, alerts, neighbors or officials are saying. Injects follow from those facts, not from an assumed response time.

**Simulated time and decisions are separate.** The simulated period grows with severity, from about a day at level 1 to two weeks at level 4, and a scenario can override it. Longer periods use time jumps ("Day 4") rather than more turns. The decision count is bounded on its own:

| Level | Simulated period (default) | Decisions |
| --- | --- | --- |
| 1 | About 24 hours | 3–5 |
| 2 | About 72 hours | 5–8 |
| 3 | About 7 days | 6–10 |
| 4 | About 14 days | 8–12 |

The clock is 72 hours today (`TARGET_DURATION_HOURS`). Levels 3 and 4 wait for the history summaries (G6).

## 3. The catalog

**Realism labels, per level:**
- **Real:** based on real events.
- **Planning:** an official planning scenario, such as a USGS or FEMA exercise scenario.
- **Speculative:** plausible but unprecedented.
- **Fictional.**

A level not listed is unsupported. Scenarios marked _(new)_ aren't in `SCENARIOS` today.

### Everyday

**Power outage**

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | An equipment failure cuts power for an afternoon and evening | 6–12 hours | Neighborhood | Power only | Not damaged | Real |
| 2 | A storm brings lines down | 3 days | County | Power; traffic lights; some stores and gas stations | Not damaged | Real |
| 3 | Widespread storm damage to the grid | 1–2 weeks | Region | Power; many stores, fuel and some cell towers once backup batteries run out | Not damaged | Real |
| 4 | Grid failure across several states, absorbing the former "long grid failure" | Weeks | Multi-state | Power; most stores, fuel and payments; water pressure where pumps lack backup | Not damaged | Planning |

Real hazards: no light, refrigeration, heating or cooling, devices, medical power, or water on a well. **The sample exercise** stays at level 1–2 (F11).

**Water advisory** (was "boil-water notice")

The advisory type is a **variant**, chosen with the scenario, not a severity step. Each needs different actions ([CDC: drinking water advisories](https://www.cdc.gov/water-emergency/about/drinking-water-advisories-an-overview.html)):

| Variant | What it means |
| --- | --- |
| Boil water | Boil tap water before drinking, cooking or brushing teeth |
| Do not drink | Don't drink it, even boiled; some other uses may be fine |
| Do not use | Don't use it at all, not even for washing |

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | An advisory after a main break | About 1 day | Neighborhood | Safe tap water | Not damaged | Real |
| 2 | An advisory while the utility finds and fixes the cause | 3–7 days | Town | Safe tap water; bottled water short in local stores | Not damaged | Real |

Real hazards: water for drinking, cooking, hygiene, infants and pets. On a private well there's no utility advisory: the scenario becomes testing the well after a flood.

**Heat wave**

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A hot weekend | 2 days | Region | None | Not damaged | Real |
| 2 | Extreme heat with nights that don't cool | About a week | Region | None; cooling centers open | Not damaged | Real |
| 3 | Extreme heat and power cuts | About a week | Region | Power, on and off; air conditioning | Not damaged | Real |

Real hazards: heat illness, especially for older adults, infants, people on certain medications, people working outdoors and pets. Also medication storage and cooling centers.

**Home fire** _(new)_

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A fire starts in the kitchen while someone is cooking | Minutes, then the evening | This home | None | Kitchen damage | Real |
| 2 | A fire at night; everyone has to get out | One night, then days elsewhere | This home | None | Unlivable for days | Real |
| 3 | The home is unlivable after a fire | Weeks | This household | None | Unlivable for weeks | Real |

The outcome is never predetermined: whether the fire is put out or everyone leaves follows from the participant's decisions and real guidance on when to get out. Real hazards: getting out, smoke alarms, a meeting point, documents, temporary housing, insurance.

### Regional

**Winter storm**

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Snow closes roads | 1 day | County | Roads, schools | Not damaged | Real |
| 2 | An ice storm brings lines down in freezing cold | 2–3 days | County | Power, roads | Not damaged | Real |
| 3 | Outage in deep cold; pipes freeze | About a week | Region | Power; water where pipes or treatment fail; roads | Burst pipes possible | Real |
| 4 | A region unused to cold loses power and water | 1–2 weeks | Multi-state | Power, water, many stores and fuel | Burst pipes likely | Real |

Real hazards: staying warm without burning anything indoors, frozen pipes, carbon monoxide, travel, checking on neighbors. Level 4 is Texas, February 2021 (to verify).

**Tornado**

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A warning at an unplanned time; shelter; no touchdown nearby | Under an hour | County warning | None | Not damaged | Real |
| 2 | A touchdown nearby | 1–3 days | Neighborhood | Power; some roads blocked by debris | Minor damage possible | Real |
| 3 | A direct hit on the neighborhood | Weeks | Neighborhood | Power, gas, water in the damage path; roads | Damaged; may be unlivable | Real |
| 4 | An outbreak hits many towns across the region | Weeks | Region | Power, gas, water and roads across many towns; responders committed to the worst-hit areas; phones overloaded | May be destroyed | Real |

What the participant knows at level 4: radio reports name the hardest-hit towns; their own street is blocked. Real hazards: where to shelter, warnings at night, debris, gas leaks, finding family, documents.

**Flood**

Variants: **flash flood**, **river flood**, and **dam or levee failure** (formerly in "Rare but real"; little warning, otherwise a flood).

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Street flooding closes roads | Hours | Neighborhood | Roads | Not damaged | Real |
| 2 | A flood warning at night; water reaches the yard | 1–2 days | County | Roads; power in low areas | Yard; water at the foundation | Real |
| 3 | The home floods; leaving is necessary | 1–2 weeks out of the home | County | Roads, power, safe tap water in the flooded area | Flooded | Real |
| 4 | A regional flood | Weeks | Region | Roads, power and water across the region; shelters full | Flooded; may be unlivable | Real |

Real hazards: never driving into water, when to leave, utilities, contaminated water, mold, documents.

**Hurricane**

Levels describe **household consequences**, not storm category: a weaker storm can flood more than a stronger one.

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Wind and heavy rain; a brief outage | 1 day | County | Power, briefly | Not damaged | Real |
| 2 | Days of warning, then trees down and a multi-day outage | 3–5 days | Region | Power; roads with fallen trees | Minor damage possible | Real |
| 3 | An evacuation order for the area; flooding or wind damage | 1–2 weeks | Region | Power, water, roads; access to the area restricted | Damaged | Real |
| 4 | Widespread flooding and destruction, coastal or inland | Weeks | Multi-state | Power, water, roads, phones, stores and fuel across a wide area | May be unlivable | Real |

Real hazards: leaving or staying, surge (coastal only), inland flooding, wind, long outages, generators. Level 4 inland is Helene in western North Carolina, 2024 (to verify). Inland locations get no surge and no landfall (eval finding 11); see the inland adaptation in §4.

**Wildfire and smoke**

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Smoke from a distant fire | Several days | Region | None; outdoor events cancelled | Not damaged | Real |
| 2 | A fire nearby; an evacuation warning ("be ready") | 2–3 days | County | Some roads | Not damaged | Real |
| 3 | An evacuation order with little time; the route is congested | 1–2 weeks out of the area | County | Roads, power, phones in the fire area | Unknown until return | Real |
| 4 | A fast fire reaches the community | Weeks to months | Community | Everything in the burned area | May be destroyed | Real |

Real hazards: indoor air, go-bags, leaving early, animals and livestock, the route out. Level 4 is Paradise, 2018 and Lahaina, 2023 (to verify), handled with care.

**Earthquake**

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Moderate shaking; things fall | Minutes, then a day of aftershocks | Region | None | Things broken | Real |
| 2 | Strong shaking | 2–4 days | County | Power, gas, water in places | Some damage | Real |
| 3 | A major quake with continuing aftershocks | 1–2 weeks | Region | Power, gas, water, roads, phones | May be damaged | Real |
| 4 | A major fault rupture | Weeks | Multi-state | Essential services across a wide area | May be unlivable | Planning |

Level 4 draws on USGS and FEMA planning scenarios such as ShakeOut and Cascadia (to verify). Real hazards: drop, cover and hold on, gas shutoff only if leaking, water, injuries, aftershocks, communication.

### Rare but real

**Solar storm** _(new)_

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | Radio and GPS disruption; a brief outage | 1–2 days | Multi-state | GPS, some radio, power briefly | Not damaged | Real |
| 3 | Regional grid damage | 1–2 weeks | Region | Power, and what depends on it | Not damaged | Speculative |
| 4 | Transformer damage across several states | Weeks or more | Multi-state | Power, most stores, fuel, payments | Not damaged | Planning |

Real hazards: as a power outage, plus no GPS and unreliable information.

**Pandemic** _(new)_

Duration overrides the baseline: a pandemic runs for months, so the exercise jumps through stages.

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | Schools close; some items are short | Weeks | Nationwide | Schools; some stores' stock | Not damaged | Real |
| 3 | A household member is sick and isolating | Weeks | Nationwide | Schools; clinics and pharmacies stretched | Not damaged | Real |

Real hazards: isolation care and supplies, medication buffers, masks, routines for children.

**Hazardous materials release** _(new)_

| Level | What happens | Lasts | Reach | Services out | Home | Label |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | A shelter-in-place order after a release nearby | Hours | Neighborhood | Roads into the area | Not damaged | Real |
| 3 | An evacuation order | Days | Town | Everything inside the evacuation zone | Unknown until return | Real |

Real hazards: sealing a room, listening for official updates, leaving when told to, and not before.

### Fictional and speculative

**When the systems turn** (pilot, see [Scenario sets §3](scenario-sets.md#3-pilot-storyline-when-the-systems-turn))

Each level has **two labels**. The **cause**, an AI-driven attack, is speculative or fictional at every level: real payment failures and grid attacks don't show that an AI could cause them. The **disruption** separately cites a real precedent where one exists.

| Level | What happens | Lasts | Reach | Services out | Home | Cause | Disruption precedent |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Payments down | About 1 day | Region | Card payments, bank apps, ATMs | Not damaged | Speculative | Real: the July 2024 CrowdStrike software failure (not an attack) |
| 2 | Grid takeover: rolling outages, slow manual repairs; payments unreliable | 2–4 days | Region | Power on and off; payments intermittent | Not damaged | Speculative | Real: the December 2015 Ukraine grid attack (outages lasted hours) |
| 3 | Cascade: grid, payments, fuel distribution and water treatment fail together | 1–2 weeks | Multi-state | Power, payments, fuel, safe tap water; information unreliable | Not damaged | Speculative | Partial: the 2021 Colonial Pipeline ransomware attack (fuel only) |
| 4 | Judgment Day: connected systems can't be trusted | Weeks | Multi-state | Everything networked | Not damaged | Fictional | None |

Multi-day payment loss belongs to level 2 and above; level 1 stays within the one-day baseline.

**Other fictional candidates (aliens, zombies) are deferred** until the pilot shows that fictional framing produces useful learning.

## 4. Where and when (layer 3)

**Region fit.** Each scenario level declares where it's plausible. The region in the profile, a state today and a county later (R8), sorts the library. Nothing is hidden.

| Fit | Example | Behavior |
| --- | --- | --- |
| Likely here | Tornado in Oklahoma, wildfire in California | Shown first; "Common where you live" |
| Possible here | Winter storm in Texas, earthquake in Missouri | Shown; "Less common here; worth practicing" |
| Unlikely here | Hurricane landfall in Colorado | Shown last, with a note and an explicit choice (below) |
| Anywhere | Power outage, home fire, water advisory, the AI storyline | No label |

**Adaptations are offered, never silent.** Choosing "Hurricane" in an inland state asks: "Hurricanes don't make landfall here, but their remnants can flood inland areas. Practice remnant flooding instead?" The participant picks the adaptation or the original, and the exercise header shows which.

The first version uses a hand-written state table. FEMA's National Risk Index county scores replace it later (R8). Only the coarse region is ever used, never an address.

**Season.** Ask nothing new: use the current month and the region. A winter storm in July stays available but shifts to "practice for the coming season". Heat and cold change every scenario: an outage in January is a heating problem; in August it's a cooling problem.

**The starting situation.** Before the first decision, the exercise shows a short card the participant can correct:
- **When:** time of day and day of week. Random by default.
- **Who's home:** generated from each person's usual pattern, if given, and the time. "Usually at work or school" in the profile is a habit, not a fact about this exercise; the card states who is actually home this time.
- **Shelter and transport:** what the household has said, or "Not set" with a brief question if the scenario needs it (§5).

Corrections apply to this exercise only. The card is visible from the first exercise, not unlocked later.

## 5. The household (layers 4–7)

**Unknown is not "none".** A missing optional fact is unknown. The engine never assumes the household has no vehicle, no shelter or no care plan. When the distinction matters for this scenario, the starting situation asks one brief question ("Is there a sturdy building you could reach before a tornado?"); otherwise the story avoids depending on it. Profile fields are added progressively and stay optional.

What each profile detail changes. Rows marked _(new)_ need a profile addition.

### Home and shelter

| Detail | Changes |
| --- | --- |
| Where you would shelter _(new)_ | Stated by the participant, per hazard, or asked in the starting situation. Never inferred from the home type alone |
| Apartment, upper floor | Elevators stop in an outage. Tornado shelter options depend on the building: an interior hallway on the lowest floor may not be accessible or suitable, so the exercise asks rather than assumes. Neighbors are close: help, or need |
| Mobile or manufactured home | Tornado and high wind: the exercise first establishes an alternative sturdy shelter, and gives the opportunity to reach it early, at the watch rather than the warning ([NWS mobile home guidance](https://www.weather.gov/media/ohx/PDF/MobileHomesEnglish.pdf)). If none is known, finding one is what the exercise tests. Flood: leave earlier |
| Basement | Tornado shelter, if accessible to everyone. Flood risk, and sump pumps fail without power |
| Gas furnace (needs power) | No heat in an outage despite gas. Carbon monoxide risk if someone improvises |
| Electric heat or heat pump | No heat in an outage |
| Wood stove | Heat without power; fire and carbon monoxide safety |
| Private well | No water when the power is out. Testing needed after a flood. Utility advisories don't apply |
| Septic | Use limits in floods (existing guidance `sanitation.septic`) |
| Backup power and its rating | What can run, for how long (existing device runtime math). Generator safety |
| Rural, suburban or urban | Distance to services, road access, neighbors, how fast services return |
| Renter or owner _(new)_ | Who fixes what; renter's insurance; landlord contact |

### Getting out

| Detail | Changes |
| --- | --- |
| Transport options _(new)_ | A household vehicle, accessible transport, or needing assistance (a neighbor, family, a local registry). Determines how early leaving has to start, not whether it's possible |
| A destination _(new)_ | Somewhere to go: family, friends, a hotel, a shelter. Whether it's accessible, and whether it accepts the household's animals |
| Contact and reunification plan _(new)_ | An out-of-area contact and a meeting point. Tested whenever people are apart at the start |

### People

| Detail | Changes |
| --- | --- |
| Infant | Formula and clean water, warmth, diapers. Heat and cold risk |
| Children | Reunification if apart, fear and routine, supervision during cleanup |
| Teen | Can help; may be away from home; has their own phone |
| Older adult | Heat and cold risk, medication, mobility, hearing (existing needs) |
| Pregnancy | Heat, travel, access to care (existing need) |
| Refrigerated medication | Cold chain, days of supply (existing math) |
| Powered medical device | Runtime on backup power (existing math). How urgent losing power is comes from a **care-plan dependency the participant supplies**: "can go without it for: hours / overnight / not at all; per their care plan". Never inferred from the device name. Unknown: the exercise asks, and the debrief suggests confirming it with their clinician. Eval finding 10 |
| Mobility or stairs | Leaving, upper floors without elevators, shelter access, accessible destinations |
| Hearing or vision | Getting warnings: sirens, alerts and broadcasts |
| Air-quality sensitivity | Smoke, mold, dust from cleanup |
| Household size | Supply math (existing), coordination, who's responsible for whom |
| Usual pattern _(new, optional)_ | "Usually at work or school" during the day. Feeds the starting situation; no schedules or places |
| Language _(new, optional)_ | Two separate facts: the **exercise language**, and whether the household can **get official alerts** in a language they understand |

### Pets and animals

| Detail | Changes |
| --- | --- |
| Service animal _(new)_ | Stays with its handler; shelters must admit it. Its own food, water and documentation |
| Dogs and cats | Food and water (existing math), carriers, shelters that turn pets away, stress and bolting |
| Giant breeds | Water and food at scale (Charlotte), transport |
| Birds | Heat, cold and air quality sensitivity |
| Horses and livestock | Leaving needs a trailer and a place to go, and must start early. Water at scale |

### Supplies

Every inventory gap (F15) is a candidate inject at levels 2 and above: water short, no radio, medication days below the outage length. The rule from G1 still applies: setbacks are proportionate, and a gap is tested once, not punished repeatedly.

Scenarios add supplies the current list lacks _(new)_:
- Cash on hand and paper copies of key documents (the AI storyline, home fire, leaving home).
- Fire extinguisher and smoke alarms (home fire).
- N95 masks (smoke, cleanup, pandemic).
- Sandbags or flood barriers (flood).
- Vehicle fuel (leaving home).

## 6. Worked examples

The same world, three households.

**Tornado, level 2 (touchdown nearby, 1–3 days without power)**

| | Alex: Illinois apartment, 4th floor, alone | Sam: Ohio house with basement, 2 kids, large dog | Charlotte: NC house, CPAP, two Great Danes |
| --- | --- | --- | --- |
| Starting situation | 9 p.m., home. Shelter not set: "Where in your building would you go?" | 3 p.m. on a school day: one adult home, kids at school | 2 a.m., asleep. Care plan: CPAP "overnight" |
| Warning | Getting to the chosen shelter; a phone alert at night | Basement with the anxious dog; contacting the school, using the reunification plan | Waking to the alert; sheltering with two 130 lb dogs |
| First hours | Elevator out; checking on neighbors | Gas smell from a damaged line? Shut-off decisions | Trees down across the road; the CPAP on the power station |
| First day | One flashlight, a power bank, 1 gallon of water: tested | Furnace off without power; the child with asthma and cleanup dust | Device runtime; dog water at scale |
| Look-fors that apply | Shelter, light, communication | Shelter, reunification, gas safety, pets, breathing | Shelter, device power, pets, water |

**When the systems turn, level 1 (payments down for a day)**

| | Alex | Sam | Priya: Texas townhouse, mother on oxygen |
| --- | --- | --- | --- |
| Tests | Cash on hand: unknown, asked. Food: 2 days | Groceries for 4 and dog food without a card | A prescription refill due today; care plan: oxygen "not at all" without power, so the power-station runtime matters if the story escalates |
| Carries over | Keep some cash; know who you'd borrow from | A cash envelope; a paper contact list | A medication buffer; pharmacy payment options |

## 7. Sources to add before use

Each needs a record in `data/rules/sources.json` and a guidance or precedent record:
- CDC drinking water advisory types (boil, do not drink, do not use).
- NWS guidance for mobile homes in tornadoes and high wind.
- Texas February 2021 winter storm: official after-action reports.
- Hurricane Helene's inland flooding, 2024. Partly covered by `noaa-inland-flooding` and `nhc-2025-season-lessons`.
- Camp Fire (2018) and Lahaina (2023): official reports.
- USGS ShakeOut scenario, and FEMA Cascadia Rising.
- Solar storm grid-risk assessments.
- Tornado sheltering for apartments. Partly covered by `tornado.shelter`.
- NFPA or USFA home-fire escape guidance. Any claim about how common home fires are needs a source before it appears.
- Hazmat shelter-in-place guidance (Ready.gov).
- Service animals in shelters (ADA guidance).
- The AI storyline's disruption precedents: the CrowdStrike outage (2024), the Ukraine grid attack (2015) and Colonial Pipeline (2021).

## 8. Decisions

Decided in review, 2026-10-30.

| Question | Decision |
| --- | --- |
| Do levels change the clock? | Yes, as defaults that scenarios can override, with time jumps. Decision count bounded separately (§2). Levels 3–4 wait for G6 |
| Region fit | Label and sort, never hide. Adaptations, such as an inland hurricane, are offered explicitly |
| Onset | Random by default. The starting situation is visible and editable from the first exercise |
| New profile fields | Added progressively and optionally. Transport access rather than vehicle ownership. Language separates the exercise language from access to official alerts |
| Home fire | Added to Everyday. The power outage stays the sample. No predetermined outcome |
| Fictional candidates | Aliens and zombies deferred until the pilot shows useful learning |
| More scenarios | None for now. Long grid failure merged into power outage; dam and levee failure is a flood variant |
| Build order | 1. Reliability fixes (G4, G6 groundwork). 2. Power outage, winter storm and tornado at levels 1–2. 3. G6, then their levels 3–4. 4. The AI pilot |
