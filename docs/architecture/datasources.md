# ReadyState: Core Data Sources and API Integrations

The following documentation outlines the official data sources required to build the baseline logic, supply constraints and dynamic scenarios for the ReadyState Tabletop Exercise (TTX) simulator.

These sources feed the [Research & Knowledge Base](../roadmap/work-breakdown.md#7-research--knowledge-base) team's records (R3 guidance, R8 regional data, R9 special needs). How medical conditions become simulation constraints is covered in [Dataset bridging](dataset_bridging.md). Before any figure below is used in a prompt or record, check it against the source; see [Review notes](#review-notes).

## 1. Scenario generation and environmental hazards

To generate realistic inciting incidents and weather-related injects, the LLM must be grounded in localized hazard data.

- **FEMA National Risk Index (NRI) API and dataset:** expected annual loss and historical risk data for 18 natural hazards (for example floods, blizzards and earthquakes), mapped down to county and census tract level.
  - Data source: [FEMA NRI map and data portal](https://hazards.fema.gov/nri/)
  - ArcGIS REST service: [National Risk Index ArcGIS endpoint](https://www.arcgis.com/home/item.html?id=39485e8035d446a5bff03259508ae355)
- **NOAA National Weather Service (NWS) API:** a free JSON-LD REST API providing grid-based forecasts, severe weather alerts and historical hazards for real-time scenario modeling.
  - API documentation: [NWS web service API](https://www.weather.gov/documentation/services-web-api)
  - API endpoint: `https://api.weather.gov/`

## 2. Household logistics and supply baselines

The system needs a standard checklist to grade the user's initial supply stash and calculate daily consumption rates.

- **FEMA / Ready.gov Basic Emergency Supply Kit:** the federal baseline for per-person water (1 gallon per day), food, first aid components and shelter-in-place tools (for example N95 masks and utility shutoff tools).
  - Data source: [Ready.gov Build a Kit](https://www.ready.gov/kit)
- **CDC medical and special-needs preparedness:** logistics for vulnerable populations, including power requirements for medical devices, refrigerated medications and mobility constraints.
  - Data source: [CDC disability and health emergency preparedness](https://www.cdc.gov/disability-emergency-preparedness/people-with-disabilities/build-a-kit.html)

## 3. Consequence logic: food spoilage and sanitation

To process the consequences of a user's actions (for example eating day-three refrigerated food during a grid failure, or improvising a toilet), the AI must use strict biological standards.

- **USDA power outage food safety charts:** which foods must be discarded and which can be kept after power is lost, based on time and temperature thresholds.
  - Data source: [FoodSafety.gov power outage chart](https://www.foodsafety.gov/food-safety-charts/food-safety-during-power-outage)
- **CDC emergency sanitation and hand hygiene standards:** protocols for safely handling human waste when municipal plumbing fails, including bleach-to-water ratios for sanitizing surfaces and treating water.
  - Data source: [CDC emergency sanitation solutions](https://archive.cdc.gov/www_cdc_gov/healthywater/global/sanitation/sanitation-emergency-response.html)

## 4. Animal welfare and veterinary constraints

Because generic preparedness often ignores pets, this data lets the simulator track animal food and water needs, stress behaviors and evacuation constraints.

- **FEMA / Ready.gov pet preparedness guidelines:** baseline requirements for emergency pet kits, including water minimums, medication storage and evacuation sheltering rules (many human shelters do not accept pets).
  - Data source: [Ready.gov pet preparedness](https://www.ready.gov/pets)
- **ASPCA disaster preparedness for pets:** how animals react during severe weather (for example thunder phobias and escape attempts), and guidelines for safe confinement, transport and microchip logistics.
  - Data source: [ASPCA disaster preparedness guide](https://www.aspca.org/pet-care/general-pet-care/disaster-preparedness)

## 5. Medical and pharmaceutical constraints

Integrating medical constraint data is one of the most powerful ways to elevate ReadyState from a generic survival game to a realistic logistical simulator. Medical injects are often the primary failure point in real-world disasters.

### 5.1 Medication stability and temperature excursions

When a scenario involves a grid failure, the AI must know how long specific drugs remain viable without refrigeration.

- **Data source:** FDA drug storage and temperature excursion guidelines, and manufacturer stability data (package inserts).
- **Application in ReadyState:** map common refrigerated medications to their room-temperature limits. For example, some insulin products stay usable at room temperature for 14 to 28 days depending on the product, while some biologics or reconstituted solutions degrade much faster. If a household has a refrigerated medication constraint and the power goes out in a summer heat wave, the AI can trigger an inject that forces the user to source ice or risk losing their supply.

### 5.2 Medical equipment power logistics

Many chronic illnesses require hardware that depends on continuous electricity.

- **Data source:** CDC disaster preparedness guidelines for people with disabilities and chronic health needs, plus device manufacturers' power specifications.
- **Application in ReadyState:** if a household includes a functional constraint such as "requires a continuous oxygen concentrator" or "uses powered mobility equipment," the AI can use baseline wattage figures to drain the stated battery or generator capacity over time. That forces hard choices about prioritizing power between medical equipment, refrigeration and communication devices.

### 5.3 Off-grid triage and minor illness protocols

To grade a user's response to injuries and illness (like a bee sting or a stomach bug), the AI needs clinical standards for delayed-care environments.

- **Data source:** Wilderness Medical Society (WMS) clinical practice guidelines, and American Red Cross wilderness first aid material. Both are copyrighted: cite and paraphrase, don't copy.
- **Application in ReadyState:** these sources describe how to manage conditions when emergency services are unavailable. If the AI injects a severe allergic reaction and the user treats it with an over-the-counter antihistamine instead of an epinephrine auto-injector, the AI escalates the respiratory condition on the next turn.

### 5.4 Prescription stockpile baselines

The AI needs to know what a realistic medication stockpile looks like to grade the user's preparations.

- **Data source:** CDC emergency continuity-of-care guidelines.
- **Application in ReadyState:** guidance generally recommends keeping at least a one- to two-week emergency supply of essential daily medications, to bridge sudden-onset disasters that disrupt pharmacies. The AI can ask how many days of buffer the household actually keeps. If they have a 3-day supply and a blizzard traps them for a week, the AI plays out the consequences of running out.

Grounding the AI in these official clinical and pharmacological rules moves the simulator away from guesswork and toward an accurate planning tool.

## Review notes

_Added while formatting (2026-10-27). These need checking against the primary sources, and medical items need sign-off under decision D6, before they're used in prompts or knowledge-base records._

- **Unresolved citations.** The original draft carried `[cite: 1.1.1]`-style markers with no reference list, probably from a research tool. They were removed; each claim needs a real source URL when it becomes a knowledge-base record (R1 requires one).
- **Food safety threshold.** The draft said perishables are discarded "after 4 hours above 40°F." The USDA chart is usually summarized as two separate rules: a closed refrigerator keeps food safe for about 4 hours without power, and perishables held above 40°F for more than 2 hours should be discarded. Confirm against the chart.
- **Insulin room-temperature limits.** The draft said "up to 14 days." Limits vary by product (commonly 14 to 28 days), so records should be per product, from the package insert.
- **Stockpile guidance.** The draft quoted both "7 to 10 days" (in the bridging doc) and "1 to 2 weeks." Pick the CDC wording and use it in both places.
- **Copyright.** WMS guidelines and Red Cross manuals are copyrighted; summarize and link rather than reproducing them.
