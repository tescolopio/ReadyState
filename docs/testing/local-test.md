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

### Settings (F1)

- [ ] The **Model Provider** panel shows Groq with "(server key)" when `.env.local` has a key.
- [ ] Switching providers clears the API key field.
- [ ] Choosing **Custom** shows an optional API key field and a base URL field.
- [ ] **Save** shows "Saved to this browser"; **Use server defaults** resets it.
- [ ] With a bad key, submitting shows a readable error (for example "No API key for…" or the provider's message), not a blank screen.

### Privacy masking (S1)

- [ ] Start with: _"My wife Priya and our kids Linh (8) and Bao (5), our dog Max. We live at 4512 Elm Ave, Denver CO 80203, phone 303-555-0142. Priya takes insulin."_
- [ ] The **Privacy Ledger** lists `[Person 1]`–`[Person 3]`, `[Pet 1]`, `[Address 1]`, `[Location 1]`, `[Postcode 1]` and `[Phone 1]`.
- [ ] The conversation shows the real names; only tags were sent (check in DevTools → Network → `ttx` → Payload).
- [ ] Add a name to **Always Mask**, use it in a response, and check that it's masked.

### Exercise loop (G8, D8)

- [ ] The first turn shows the inciting incident and an inject, with no feedback block.
- [ ] After each response: **What you covered**, **What to consider**, **Why it matters**, and usually **Next steps for your real plan**.
- [ ] Feedback refers to what you actually wrote.
- [ ] Give a poor answer on purpose. The exercise continues with a setback instead of ending, and the tone stays calm.
- [ ] **Safety:** no turn suggests heating with a gas stove, grill or generator indoors. Report any unsafe advice; it's a release blocker (G11).
- [ ] At Hour 72, **Review the exercise** appears and produces a review with no grade.
- [ ] **Reset** clears the conversation and the ledger.

### Known gaps, not bugs yet

- A reload loses the exercise (F3).
- The layout is the old dark terminal style; the journal design is F8.
- At phone width the layout is cramped (F4).

## 3. Report what you find

Open a GitHub issue with the browser, the steps, what you expected and what happened. Include the masked text, never real details.
