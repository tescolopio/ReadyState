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

## 3. Report what you find

Open a GitHub issue with the browser, the steps, what you expected and what happened. Include the masked text, never real details.
