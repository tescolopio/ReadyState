# Local test checklist

How to run ReadyState on your own machine and check it by hand. The automated checks (`npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and the Docker smoke test) run in CI on every PR. This list covers what they can't: the app in a real browser with a real model.

## 1. Start it

You need a model provider. The quickest is a free Groq key from [console.groq.com](https://console.groq.com/keys).

**Option A: Node (for development)**

```bash
conda activate readystate        # or any Node 24
npm ci
cp .env.example .env.local       # then set GROQ_API_KEY=...
npm run dev                      # http://localhost:3000
```

**Option B: Docker (what self-hosters run)**

```bash
docker compose up -d --build     # http://localhost:3000, reads .env.local
docker compose logs -f           # watch for errors
docker compose down              # stop
```

Only one of A and B can use port 3000 at a time.

**No key in `.env.local`?** Open the **Model Provider** panel in the app, pick a provider and paste a key. It's saved in that browser only.

## 2. Check it

Use Chrome, Firefox and Safari (or Edge) at least once each before a release (work breakdown F1). Use made-up names and details, never real ones.

### Website and visual styles (F8, D7)

- [ ] `/` shows the public website; its sample link opens `/exercise?sample=alex`.
- [ ] The website footer's **Visual style** switch, and **Settings → Appearance** in the app, toggle **Style A: Journal** and **Style B: Modern**; the choice survives a reload.

### Navigation (F13)

- [ ] The app shows **Journal**, **Exercises**, **My household**, **Action plan** and **Settings**: a sidebar on wide screens, a bottom bar on phones.

### Settings (F1)

- [ ] On **Settings**, the **Model provider** section (self-hosted only) shows Groq with "(server key)" when `.env.local` has a key.
- [ ] Switching providers clears the API key field.
- [ ] Choosing **Custom** shows an optional API key field and a **Base URL** field.
- [ ] **Save** shows "Saved to this browser."; **Use server defaults** resets it.
- [ ] With a bad key, submitting shows a readable error, not a blank screen or the provider's raw message.

### Household setup

- [ ] **Set up my household** opens the wizard: People, Pets, Home, Health needs, Supplies, Review.
- [ ] After saving, **My household** summarizes it, **Start with my saved household** appears on the exercise screen, and the household survives a reload.
- [ ] Switching backup power from a battery to a generator or none drops the battery capacity from the summary.
- [ ] **Action plan** lists the household check's suggestions, and an added item survives a reload.

### Privacy masking (S1)

- [ ] Use made-up details, for example: _"My wife Priya and our kids Linh (8) and Bao (5), our dog Max. We live at 4512 Elm Ave, Denver CO 80203, phone 303-555-0142. Priya takes insulin."_
- [ ] **Privacy: what stays on this device** lists the tags, such as `[Person 1]`–`[Person 3]`, `[Pet 1]`, `[Address 1]` and `[Phone 1]`, with their real values.
- [ ] The conversation shows the real names; only tags were sent (check in DevTools → Network → `ttx` → Payload).
- [ ] A medication from the household profile, typed on its own in a response, is sent as `[Medical N]`, not as a person.
- [ ] A household name that is also a common word (for example a person named "Will") hides the name but not the ordinary word ("we will leave").
- [ ] Add a name under **Settings → Privacy**, use it in a response, and check that it's masked.

### Reviewing what's sent (S2)

- [ ] Starting an exercise opens **Review what leaves this browser** with the complete masked briefing; DevTools → Network shows no `ttx` request yet.
- [ ] **Back, don't send** returns to the start with nothing sent; for a response, the typed text is still in the box.
- [ ] **Review before sending** (or Ctrl+Enter) on a response opens its review; the request payload's last message matches the review's text exactly after **Send this**.
- [ ] Select a word the masker missed, choose **Mask selected text**, and confirm: the review is rebuilt with it tagged. With edits, it warns first.
- [ ] Delete one bracket of a tag: Send is disabled with an explanation. Deleting a whole tag is fine.
- [ ] Type a phone number into the review's copy and send: it's masked and shown again before anything goes.
- [ ] Double-click **Send this**: one request.
- [ ] After a failed request, **Send the same message again** resends it unchanged, even after changing Settings.
- [ ] Review and Settings explain that keys go to ReadyState's server for provider authentication, not into conversation text. With a synthetic key and mocked transport, confirm retry credentials are separate from message history.
- [ ] Before requesting a debrief, the button's description explains that the existing history includes model-generated events and is sent for another model call; no separate editable preview is promised.
- [ ] On a phone (or a narrow window), the review fits without sideways scrolling and its buttons are easy to tap; with only the keyboard, Tab reaches the copy, Mask, Back and Send.

Mocked browser checks establish transmission behavior only, not real provider responses or debrief quality. Real-phone, Safari and Firefox checks remain outstanding until performed. No-call checks must not use **Send this**, retry or debrief on a provider-connected server; use an isolated mocked transport for transmission assertions.

### Exercise loop (G8, D8)

- [ ] The first turn shows the situation, with no feedback block.
- [ ] After each response: **What you covered**, **What to consider**, **Why it matters**, and usually **Next steps for your real plan**.
- [ ] Feedback refers to what you actually wrote.
- [ ] Give a poor answer on purpose. The exercise continues with a setback instead of ending, and the tone stays calm.
- [ ] **Safety:** no turn suggests heating with a gas stove, grill or generator indoors. Report any unsafe advice; it's a release blocker (G11).
- [ ] At the end, **Debrief: what we learned** appears and produces a debrief with no grade.
- [ ] **Start over** asks first, then clears the conversation and the privacy tags; the action plan stays.

### Known gaps, not bugs yet

- A reload loses the exercise in progress (F3); the household, action plan and settings are kept.

## 3. Scenarios to run

### Available now

**Exercises** lists nine emergencies, plus **Surprise me**, which picks one that fits your region and season. Each runs 72 in-game hours and ends with a debrief.

To run one:
1. Open **My household → Set up my household**, choose **Load a test household (fictional)**, and save. Or enter your own made-up household.
2. Open **Exercises** and start a scenario. Its household is whichever one you saved.

Every response is a model call. A full exercise is usually a dozen or more responses, plus the debrief. As a rough estimate, not an allowance: with Groq's `openai/gpt-oss-120b`, late turns measured about 6,000 tokens each, so a 200,000-token daily quota might cover about two full exercises. Retries (after a rate limit or a malformed turn) and debrief repairs use more, and other models, quotas and households differ.

**Coverage differs by scenario:**
- **Checklists:** power outage, winter storm and heat wave have a checklist of what good responses cover, which grounds the feedback. Hurricane uses parts of it. The other scenarios rely on the general rules and official guidance only.
- **Test households:** they cover six of the nine. Flood, tornado and boil-water notice have none and weren't part of earlier evaluations.

| Scenario | Suggested test household | Watch for |
| --- | --- | --- |
| Extended power outage | Alex (beginner, apartment) | Basic, encouraging advice; safe light (no candles left alone); fridge kept closed; no indoor generator or grill. |
| Winter storm | Sam (family, gas furnace that needs power, large dog) | Never heating with a gas stove, grill or generator indoors; one warm room; pipes; the child with asthma; the dog. |
| Heat wave | Priya (caregiver; oxygen concentrator; older adult on stairs) | Power for the concentrator; heat risk for the older adult; cooling options if the power fails; medication storage. |
| Hurricane | Morgan (generator neighbours rely on) or Charlotte (inland, two Great Danes, CPAP) | Generator outdoors and away from windows; leaving early versus staying; helping others without overextending; battery runtime for the CPAP. |
| Wildfire and smoke | Jordan (well prepared, two horses) | Leaving early with the horses; indoor air; being challenged rather than congratulated. |
| Earthquake | The privacy test household (personal details in free-text notes) | No re-entry after a gas leak; first minutes, then utilities and aftershocks. Also check masking: none of its names, phone number or address appear in the request payload. |
| Flood | Sam or Alex | Not driving or walking through floodwater; when to leave; utilities. Not evaluated before: note anything wrong. |
| Tornado | Sam or Charlotte | Where to shelter with minutes to act; what comes after. Not evaluated before. |
| Water contamination (boil-water notice) | Priya or Sam | Water for drinking, cooking, hygiene and pets; boiling or alternatives. Not evaluated before. |
| Surprise me | The minimal household (one adult, everything else skipped) | The engine treats skipped details as unknown and finds out through the story, rather than assuming. |

For every scenario, also run the **Exercise loop** checks above, and report any unsafe advice as a release blocker.

### Planned, not built

These are designed in [Scenario sets and severity](../product/scenario-sets.md) and the [Scenario catalog](../product/scenario-catalog.md) but aren't in the app:

- scenario sets (everyday, regional, rare but real, fictional) and severity levels 1–4;
- variants, such as the type of water advisory or flood;
- a starting situation shown before the first decision;
- the "When the systems turn" pilot storyline;
- exercises longer than 72 hours.

## 4. Report what you find

Open a GitHub issue with the browser, the steps, what you expected and what happened. Include the masked text, never real details.
