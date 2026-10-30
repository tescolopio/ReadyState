import { ArrowRight, ClipboardList, Home, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { SimulationLabel, Wordmark } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { SCENARIOS, SCENARIO_SUMMARIES, type ScenarioId } from "@/lib/household";

/**
 * The public website (design brief §3 "Sample experience", Modern treatment
 * §5). Copy describes only what the product actually does: no invented
 * customer counts, testimonials or certifications.
 */
const STEPS = [
  { icon: Sparkles, title: "Situation", text: "A developing emergency, shaped by your household: who's home, your pets, your house and what you have on hand." },
  { icon: MessageSquareText, title: "Your response", text: "Write what you'd do, or start from one of the offered choices. There's no single right answer." },
  { icon: ClipboardList, title: "Feedback", text: "What you covered, what to consider, and why it matters, grounded in guidance from agencies like FEMA and the CDC." },
  { icon: Home, title: "Action", text: "Turn lessons into a practical plan: what to get, what to decide, what to practice." },
];

const sampleHref = "/exercise?sample=alex";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-surface">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Wordmark />
          <div className="flex flex-wrap items-center gap-1 text-sm font-semibold sm:gap-4">
            <a href="#how" className="rounded-control px-2 py-2 text-ink-2 hover:text-ink">
              How it works
            </a>
            <a href="#exercises" className="rounded-control px-2 py-2 text-ink-2 hover:text-ink">
              Exercises
            </a>
            <a href="#run-it" className="rounded-control px-2 py-2 text-ink-2 hover:text-ink">
              Run it yourself
            </a>
            <Link href="/journal" className="rounded-control border border-line-strong px-3 py-2 text-ink hover:bg-action-soft">
              Open the app
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 lg:grid-cols-[0.38fr_0.62fr] lg:py-20">
          <div className="space-y-5">
            <p className="text-sm font-semibold text-action">Personal preparedness, practiced</p>
            <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">Practice the unexpected.</h1>
            <p className="max-w-prose text-lg text-ink-2">
              Explore realistic scenarios. Test your decisions. Build your household plan.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={sampleHref}
                className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 font-semibold text-on-action hover:bg-action-hover"
              >
                Try a sample exercise
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <a href="#how" className="rounded-control px-2 py-2 font-semibold text-ink underline underline-offset-4">
                See how it works
              </a>
            </div>
            <p className="text-sm text-ink-3">No account needed for the sample. It uses a fictional household and saves nothing.</p>
          </div>
          <ExercisePreview />
        </section>

        <section id="how" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-3xl font-semibold">How it works</h2>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon: Icon, title, text }, index) => (
                <li key={title} className="rounded-panel border border-line bg-canvas p-5">
                  <Icon className="h-6 w-6 text-action" aria-hidden />
                  <h3 className="mt-3 text-lg font-semibold">
                    <span className="text-ink-3">{index + 1}. </span>
                    {title}
                  </h3>
                  <p className="mt-2 text-ink-2">{text}</p>
                </li>
              ))}
            </ol>
            <p className="mt-6 max-w-prose text-ink-2">
              There&apos;s no score and no game over. Each exercise ends with a debrief: what you need to know about your
              situation, and what you can do better.
            </p>
          </div>
        </section>

        <section id="exercises" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-3xl font-semibold">Exercises</h2>
          <p className="mt-3 max-w-prose text-ink-2">Pick an emergency, or let ReadyState choose one that fits your region and season.</p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(SCENARIOS) as ScenarioId[])
              .filter((id) => id !== "surprise")
              .map((id) => (
                <li key={id} className="rounded-panel border border-line bg-surface p-5">
                  <h3 className="text-lg font-semibold">{SCENARIOS[id]}</h3>
                  <p className="mt-2 text-ink-2">{SCENARIO_SUMMARIES[id]}</p>
                </li>
              ))}
          </ul>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-2">
            <div className="space-y-4">
              <h2 className="text-3xl font-semibold">Practice that fits your household</h2>
              <p className="text-ink-2">
                A short setup covers who lives with you, pets, your home, health needs and supplies. Skip anything; it stays
                unknown rather than assumed. An inventory check compares your supplies with Ready.gov and CDC guidance, and
                the exercise tests the gaps it finds.
              </p>
              <p className="flex gap-2 text-ink-2">
                <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-success" aria-hidden />
                Names, medication names and addresses stay on your device. The scenario engine sees only what the exercise
                needs, and you can read exactly what it receives before you start.
              </p>
            </div>
            <figure className="rounded-panel border border-line bg-canvas p-5">
              <figcaption className="text-sm font-semibold text-ink-2">What the scenario engine sees (example)</figcaption>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-ink">
                {`People: 2 adults, 2 children (2–12).
- Person 3: [Air Quality Sensitive].
Pets: 1 large dog.
Location: Ohio, suburban.
Home: house, 2 floors, basement. Heating: natural gas furnace.
Stored: 8 gallons of water (about 2 days for 4 people).
Emergency to practice: winter storm.`}
              </pre>
            </figure>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-3xl font-semibold">Practice with family</h2>
          <p className="mt-3 max-w-prose text-ink-2">
            Planned: connect up to three households, each responding to its own situation on its own devices, then decide
            together who checks on whom and where everyone goes.
          </p>
        </section>

        <section id="run-it" className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-2">
            <div className="rounded-panel border border-line bg-canvas p-6">
              <h2 className="text-2xl font-semibold">Run it yourself</h2>
              <p className="mt-3 text-ink-2">
                ReadyState is open source (AGPL-3.0). Run it on your own computer with Docker or Node, and use your own AI
                provider key, or a fully local model with Ollama so nothing leaves your machine.
              </p>
              <a
                href="https://github.com/tescolopio/ReadyState"
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong px-4 font-semibold hover:bg-action-soft"
              >
                Get the code
              </a>
            </div>
            <div className="rounded-panel border border-line bg-canvas p-6">
              <h2 className="text-2xl font-semibold">Hosted service</h2>
              <p className="mt-3 text-ink-2">
                A hosted version, with no setup and no API keys, is in development. Details will be announced when it&apos;s
                ready.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 text-center">
          <h2 className="text-3xl font-semibold">See it for yourself</h2>
          <Link
            href={sampleHref}
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 font-semibold text-on-action hover:bg-action-hover"
          >
            Try a sample exercise
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * A static, clearly labeled illustration of one exercise moment, built from
 * real markup rather than an image (Modern treatment §5). Not interactive.
 */
function ExercisePreview() {
  return (
    <figure aria-label="Illustrative example of an exercise" className="rounded-panel border border-line bg-surface p-5 shadow-panel">
      <div className="flex items-center justify-between gap-2">
        <SimulationLabel />
        <span className="text-xs text-ink-3">Illustrative example</span>
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink-3">Hour 6 · Power outage</p>
      <div className="mt-2 rounded-control border-l-4 border-attention-accent bg-attention-soft p-4">
        <p className="text-sm font-semibold text-attention">What&apos;s happening now</p>
        <p className="mt-1">
          The power has been out since morning. Your refrigerator has been closed, but it&apos;s warming, and the forecast
          says the outage could last two more days.
        </p>
      </div>
      <div className="mt-3 rounded-control border border-line bg-action-soft p-3 text-sm">
        <p className="text-xs font-semibold text-ink-2">Your response</p>
        <p className="mt-1">Keep the fridge shut, move the milk and medication into a cooler with ice, and plan meals around what spoils first.</p>
      </div>
      <div className="mt-3 space-y-2 rounded-control border border-line bg-success-soft p-3 text-sm">
        <p>
          <strong>What you covered:</strong> keeping the fridge closed and starting a cooler early.
        </p>
        <p>
          <strong>What to consider:</strong> a thermometer for the cooler, and how much ice you&apos;ll need for two days.
        </p>
        <p>
          <strong>Why it matters:</strong> a closed fridge keeps food safe for about 4 hours; after that, perishables above 40 °F
          should go.
        </p>
      </div>
      <div className="mt-4 flex items-center gap-2" aria-hidden>
        <span className="h-3 w-3 rounded-full bg-action" />
        <span className="h-0.5 w-8 bg-action" />
        <span className="h-3 w-3 rounded-full bg-action" />
        <span className="h-0.5 w-8 bg-action" />
        <span className="h-4 w-4 rounded-full border-[3px] border-attention-accent bg-surface" />
        <span className="h-0.5 w-16 border-t-2 border-dashed border-line-strong" />
      </div>
    </figure>
  );
}
