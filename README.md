# Hypersolid

**A market-maker-style risk desk for conversational-ad bidding.**
Track 01 · Buy-Side Agents · Cursor Hack London 2026

Demo brand: **Cursor Coffee**, running five conversational intents across three
LLM ad venues (ChatGPT, Perplexity, Thrad).

Brands don't place ads by hand — they run auto-bidders across multiple LLM ad
venues. Each algo is optimised in its own silo, so nobody sees the brand's
**total live exposure**. The result is wasted spend: paying multiple venues to
win the same demand, and burning budget off-peak with no conversions.

Hypersolid sits **above** the auto-bidders and does four things, in
market-maker language:

1. **Smart order routing** — budget chases the venue most likely to *convert*
   for a given intent at a given time of day (liquidity-seeking, for ad demand).
2. **Exposure netting** — once an intent hits its conversion target, the agent
   stands down the least-efficient venue so you stop buying the same demand 2x+.
3. **Concentration review** — when one venue takes too large a share of an
   intent's budget, the agent flags it for a human (great conversion, but a
   single-venue exposure risk).
4. **Cap-breach escalation** — when an intent nears its budget cap *below* its
   fill target, the agent freezes and asks a human before committing more money.

The agent acts autonomously **up to a policy line**, then escalates. Every
decision is logged and tagged `AUTONOMOUS` vs `HUMAN-IN-LOOP`. The whole day is
a deterministic function of time, so you can **scrub to any moment** and the
spend, conversions, and allocations are exactly what they'd be then.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

Build / preview:

```bash
npm run build && npm run preview
```

## Demo script (~2 minutes)

1. **Frame it (paused, at 06:00).** "This is Cursor Coffee's exposure desk —
   five conversational intents down the side, three ad venues across the top.
   Each cell: conversion heat, share of budget, spend, conversions. Top-right:
   total committed vs cap, and wasted spend prevented."
2. **Scrub the time-of-day slider** morning → evening. Heat bars swing and budget
   % re-routes. "Morning, 'coffee near Bank station' converts on GPT; evening,
   'coffee subscription' converts on Perplexity. The agent routes budget to the
   hottest converting venue — smart order routing for ad demand. And because the
   day is deterministic, I can jump to any moment and the numbers are real."
3. **Scrub back to 06:00 and hit PLAY (2x).** Narrate the beats as they fire:
   - **~06:36 Concentration review.** "The agent has piled 60% of the Bank-station
     budget into GPT. Great conversion — but that's single-venue concentration
     risk, so it stops and asks me: allow it, or rebalance?" Click.
   - **~09:24 Concentration review** on the Aeropress intent (THRAD). Click.
   - **~10:06 MAX MODE prompt (the fun one).** "Bank station SMASHED its target
     at 30% of budget. The agent checks in: stand down and bank ~$2.1k, or go
     MAX MODE and rinse the whole budget to mop up extra conversions?" Pick
     either live — stand down for the saving, or MAX MODE for the laugh.
   - **~11:00 Autonomous net.** "Aeropress also hits target early — this one the
     agent just stands down on its own and banks the rest. No need to ask."
   - **~13:48 Cap breach (the money shot).** "'Cool coffee shop merch' is
     low-intent browsing — it's burned 90% of its cap with barely half the
     conversions. The agent freezes and asks: pull the weak leg to stay under cap,
     or raise the cap?" Click.
   - **~18:30 Cap breach** on 'coffee subscription'. Click.
4. **Point at the activity log.** "Every action tagged AUTONOMOUS vs
   HUMAN-IN-LOOP — explicit about what it will and won't do on its own. That's
   the whole ask of this track."

Tip: you can also **scrub straight to a moment** (e.g. 13:48) and hit the
**Review** banner to trigger a specific escalation on demand. Use **RESET** /
**REPLAY DAY** to start over.

## Story beats (verified timeline)

| Time | Event | Type |
|------|-------|------|
| 06:36 | Bank-station budget 60% on GPT | Concentration review (human) |
| 09:24 | Aeropress budget 60% on THRAD | Concentration review (human) |
| 10:06 | Bank station smashes target at 30% budget | MAX MODE prompt (human) |
| 11:00 | Aeropress hits target at 36% budget | Net (autonomous) |
| 13:48 | Merch at 90% cap, 47/68 conversions | Cap breach (human) |
| 18:24 | Date intent hits target | Net (autonomous) |
| 18:30 | Subscription at 90% cap, 48/70 | Cap breach (human) |

Run `npx tsx scripts/simcheck.ts` to print this timeline.

## Talking points / Q&A

- **"Two users on two venues at once is rare."** Correct — the waste isn't
  simultaneity, it's **aggregate over-exposure to the same demand pool**. You set
  a conversion target and budget; three silo'd algos each chase it and you buy the
  same demand 2-3x. The desk nets your *net position* across venues, exactly like
  a market-maker managing resting size across exchanges.
- **"Is this real data?"** It's a deterministic simulation (seeded heat curves +
  bid flow). The roadmap swaps the seeded intent stream for a live LLM intent
  classifier and wires routing/netting to real DSP APIs.
- **Why it maps to Track 01:** "auto-bids on conversational intent, escalates
  spend spikes" + "detects wasted spend, pauses unprofitable placements" + "when
  can the agent commit money alone... who signs off."

## How it works (code map)

- `src/seed.ts` — venues, intents, budget caps, conversion targets, time-of-day
  heat curves (`heatAt`).
- `src/engine.ts` — the agent: `step()` runs routing + netting + escalation each
  tick; `resolveEscalation()` applies the human decision.
- `src/App.tsx` — the desk UI: exposure grid, time scrubber, counters, activity
  log, escalation modal.
- `scripts/simcheck.ts` — headless run of a full day to sanity-check the timeline
  (`npx tsx scripts/simcheck.ts`).
