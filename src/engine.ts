import { DAY_END, DAY_START, INTENT_SEEDS, VENUES, heatAt } from "./seed";
import type {
  Decision,
  Escalation,
  Intent,
  Leg,
  LogEntry,
  VenueId,
} from "./types";

export const venueName = (id: VenueId) =>
  VENUES.find((v) => v.id === id)?.short ?? id;

// --- tuning -----------------------------------------------------------------
const STEP = 0.05; // sim resolution in hours
const DAY_HOURS = DAY_END - DAY_START;
const OVERSPEND = 1.15; // unmanaged spend would burn 1.15x cap over the day
const CONV_SCALE = 0.42; // clicks -> conversions scalar (with per-intent quality)
const CONC_RAISE = 0.6; // a venue above this share of budget -> human review
const CONC_CLAMP = 0.55; // "rebalance" caps the hot venue here
const PERSIST_THRESHOLD = 0.5; // sustained share that counts as concentrated
const PERSIST_HOURS = 1.0; // ... for this long -> heads-up alert
const CAP_RAISE_USD = 1000;

export function legEfficiency(leg: Leg, t: number): number {
  return heatAt(leg.shape, leg.amp, t) / leg.bidCPC;
}

interface RaiseInfo {
  t: number;
  venue?: VenueId;
  pct?: number;
  committed?: number;
  cap?: number;
  conversions?: number;
  pullsUSD?: number;
  fillDropPct?: number;
  worstVenue?: VenueId;
}

interface Work {
  intent: Intent;
  spendMult: number;
  askMaxMode: boolean;
  capExtra: number;
  satisfied: boolean;
  maxMode: boolean;
  nettedT: number | null;
  concRaised: RaiseInfo | null;
  capRaised: RaiseInfo | null;
  overRaised: RaiseInfo | null;
  pullApplied: boolean;
  topVenue?: VenueId;
  persist: Record<string, number>;
  persistLogged: Record<string, boolean>;
}

export interface SimResult {
  intents: Intent[];
  logs: LogEntry[]; // most-recent-first
  saved: number;
  pending: Escalation | null;
  pendingCount: number;
}

function freshWork(): Work[] {
  return INTENT_SEEDS.map((s) => {
    const legs: Leg[] = s.legs.map((l) => ({
      venue: l.venue,
      shape: l.shape,
      amp: l.amp,
      bidCPC: l.baseCPC,
      allocation: 1 / s.legs.length,
      committed: 0,
      conversions: 0,
      paused: false,
    }));
    return {
      intent: {
        id: s.id,
        label: s.label,
        capUSD: s.capUSD,
        conversionTarget: s.conversionTarget,
        quality: s.quality,
        legs,
        satisfied: false,
        frozen: false,
      },
      spendMult: s.spendMult ?? 1,
      askMaxMode: s.askMaxMode ?? false,
      capExtra: 0,
      satisfied: false,
      maxMode: false,
      nettedT: null,
      concRaised: null,
      capRaised: null,
      overRaised: null,
      pullApplied: false,
      persist: {},
      persistLogged: {},
    };
  });
}

const concKey = (id: string) => `conc:${id}`;
const capKey = (id: string) => `cap:${id}`;
const overKey = (id: string) => `over:${id}`;
const OVER_FRAC = 0.5; // target met under this share of cap = stellar -> ask MAX

export function simulate(
  T: number,
  decisions: Record<string, Decision>,
): SimResult {
  const work = freshWork();
  const logs: LogEntry[] = [];
  let logId = 1;
  let saved = 0;

  const push = (e: Omit<LogEntry, "id">) => logs.push({ ...e, id: logId++ });
  push({
    id: 0,
    t: DAY_START,
    kind: "info",
    autonomous: true,
    text: "Desk armed. Agent routes, nets, and escalates within policy.",
  } as LogEntry);

  for (let t = DAY_START; t <= T + 1e-9; t += STEP) {
    for (const w of work) {
      const { intent } = w;
      const cap = intent.capUSD + w.capExtra;
      const concDec = decisions[concKey(intent.id)];
      const capDec = decisions[capKey(intent.id)];
      const overDec = decisions[overKey(intent.id)];

      // apply decided cap-breach effects (persistent from decision onward)
      if (w.capRaised) {
        if (capDec === "pull" && !w.pullApplied) {
          const active = intent.legs.filter((l) => !l.paused);
          const worst = [...active].sort(
            (a, b) => legEfficiency(a, t) - legEfficiency(b, t),
          )[0];
          if (worst) {
            worst.paused = true;
            worst.allocation = 0;
          }
          w.satisfied = true;
          w.pullApplied = true;
          saved += w.capRaised.pullsUSD ?? 0;
          push({
            t,
            kind: "resolve",
            autonomous: false,
            intentId: intent.id,
            savedUSD: w.capRaised.pullsUSD,
            text: `Human approved pull on "${intent.label}" - held under cap, saved ~$${(w.capRaised.pullsUSD ?? 0).toFixed(0)}.`,
          });
        }
        if (capDec === "raise" && w.capExtra === 0) {
          w.capExtra = CAP_RAISE_USD;
          push({
            t,
            kind: "resolve",
            autonomous: false,
            intentId: intent.id,
            text: `Human raised cap on "${intent.label}" by $${CAP_RAISE_USD} - keep chasing fill.`,
          });
        }
        if (capDec === "deny" && !w.pullApplied) {
          w.pullApplied = true; // mark logged
          push({
            t,
            kind: "resolve",
            autonomous: false,
            intentId: intent.id,
            text: `Human held spend at cap on "${intent.label}".`,
          });
        }
      }

      const concPending = !!w.concRaised && !concDec;
      const capPending = !!w.capRaised && !capDec;
      const overPending = !!w.overRaised && !overDec;
      const frozen = concPending || capPending || overPending;
      intent.frozen = frozen;
      intent.satisfied = w.satisfied;

      // parked (target met / stood down) or frozen (awaiting human): hold state
      if (w.satisfied || frozen) continue;

      // --- routing ---
      const active = intent.legs.filter((l) => !l.paused);
      const effs = active.map((l) => legEfficiency(l, t));
      const effSum = effs.reduce((a, b) => a + b, 0) || 1;
      active.forEach((l, i) => {
        const target = effs[i] / effSum;
        l.allocation += (target - l.allocation) * Math.min(1, STEP * 1.8);
      });
      // "rebalance" decision clamps the hot venue
      if (concDec === "rebalance" && active.length > 1) {
        const top = [...active].sort((a, b) => b.allocation - a.allocation)[0];
        if (top.allocation > CONC_CLAMP) {
          const excess = top.allocation - CONC_CLAMP;
          top.allocation = CONC_CLAMP;
          const others = active.filter((l) => l !== top);
          const oSum = others.reduce((a, b) => a + b.allocation, 0) || 1;
          others.forEach((l) => (l.allocation += excess * (l.allocation / oSum)));
        }
      }
      intent.legs.forEach((l) => {
        if (l.paused) l.allocation = 0;
      });

      // top venue + rotation log
      const top = [...active].sort((a, b) => b.allocation - a.allocation)[0];
      if (top && top.venue !== w.topVenue) {
        if (w.topVenue) {
          push({
            t,
            kind: "route",
            autonomous: true,
            intentId: intent.id,
            text: `Routed budget into ${venueName(top.venue)} for "${intent.label}" - hottest converting venue at ${fmtHour(t)}.`,
          });
        }
        w.topVenue = top.venue;
      }

      // --- concentration review (blocking) --- only while all venues are open,
      // so it reads as a deliberate "pile-in", not a post-netting artifact.
      if (
        !w.concRaised &&
        top &&
        top.allocation > CONC_RAISE &&
        active.length === intent.legs.length
      ) {
        w.concRaised = {
          t,
          venue: top.venue,
          pct: top.allocation,
        };
        push({
          t,
          kind: "concentration",
          autonomous: false,
          intentId: intent.id,
          text: `Concentration: ${(top.allocation * 100).toFixed(0)}% of "${intent.label}" budget on ${venueName(top.venue)} - flagged for human review.`,
        });
      }

      // --- persistence heads-up (non-blocking) ---
      for (const l of active) {
        if (l.allocation > PERSIST_THRESHOLD) {
          w.persist[l.venue] = (w.persist[l.venue] ?? 0) + STEP;
        } else {
          w.persist[l.venue] = 0;
        }
        if (
          w.persist[l.venue] > PERSIST_HOURS &&
          !w.persistLogged[l.venue]
        ) {
          w.persistLogged[l.venue] = true;
          push({
            t,
            kind: "persistence",
            autonomous: true,
            intentId: intent.id,
            text: `Heads-up: "${intent.label}" has leaned on ${venueName(l.venue)} for >1h - single-venue exposure building.`,
          });
        }
      }

      // --- spend + conversions --- (reached only when active + spending)
      const spendRate = (cap * OVERSPEND * w.spendMult) / DAY_HOURS;
      const spendTick = spendRate * STEP;
      active.forEach((l) => {
        const spend = spendTick * l.allocation;
        l.committed += spend;
        const clicks = spend / l.bidCPC;
        l.conversions +=
          clicks * heatAt(l.shape, l.amp, t) * intent.quality * CONV_SCALE;
      });

      const committed = intent.legs.reduce((a, l) => a + l.committed, 0);
      const conversions = intent.legs.reduce((a, l) => a + l.conversions, 0);

      // --- target met: net (autonomous) OR prompt MAX MODE (overperformance) ---
      if (
        w.nettedT == null &&
        !w.maxMode &&
        conversions > intent.conversionTarget &&
        active.length > 1
      ) {
        const wantsMax = w.askMaxMode && committed < OVER_FRAC * cap;
        const doNet = () => {
          const worst = [...active].sort(
            (a, b) => legEfficiency(a, t) - legEfficiency(b, t),
          )[0];
          worst.paused = true;
          worst.allocation = 0;
          w.satisfied = true;
          w.nettedT = t;
          const s = Math.max(0, cap - committed);
          saved += s;
          push({
            t,
            kind: "net",
            autonomous: true,
            intentId: intent.id,
            savedUSD: s,
            text: `Target met on "${intent.label}" at ${((committed / cap) * 100).toFixed(0)}% of budget - paused ${venueName(worst.venue)}, netted out $${s.toFixed(0)} of duplicate demand.`,
          });
        };

        if (wantsMax) {
          if (!w.overRaised) {
            w.overRaised = { t, committed, cap, conversions };
            push({
              t,
              kind: "escalate",
              autonomous: false,
              intentId: intent.id,
              text: `Target smashed on "${intent.label}" at ${((committed / cap) * 100).toFixed(0)}% of budget - agent is asking whether to stand down or go MAX MODE.`,
            });
          } else if (overDec === "max") {
            w.maxMode = true;
            w.nettedT = t;
            push({
              t,
              kind: "resolve",
              autonomous: false,
              intentId: intent.id,
              text: `MAX MODE engaged on "${intent.label}" - rinsing the rest of the budget to mop up demand. No mercy.`,
            });
          } else if (overDec === "standdown") {
            doNet();
          }
        } else {
          doNet();
        }
      }

      // MAX MODE: keep spending until the budget is actually rinsed
      if (w.maxMode && committed >= cap) {
        w.satisfied = true;
        push({
          t,
          kind: "net",
          autonomous: true,
          intentId: intent.id,
          text: `Budget fully rinsed on "${intent.label}" - MAX MODE complete.`,
        });
      }

      // --- cap-breach escalation (blocking) ---
      if (
        !w.capRaised &&
        !w.satisfied &&
        committed >= cap * 0.9 &&
        conversions < intent.conversionTarget * 0.95
      ) {
        const active2 = intent.legs.filter((l) => !l.paused);
        const worst = [...active2].sort(
          (a, b) => legEfficiency(a, t) - legEfficiency(b, t),
        )[0];
        const pulls = Math.max(
          150,
          (worst ? worst.allocation : 0.3) * (cap - committed + 350),
        );
        const fillDrop = 5 + Math.round((worst?.allocation ?? 0.3) * 12);
        w.capRaised = {
          t,
          committed,
          cap,
          conversions,
          worstVenue: worst?.venue,
          pullsUSD: pulls,
          fillDropPct: fillDrop,
        };
        push({
          t,
          kind: "escalate",
          autonomous: false,
          intentId: intent.id,
          text: `ESCALATION: "${intent.label}" at ${((committed / cap) * 100).toFixed(0)}% of cap with only ${conversions.toFixed(0)}/${intent.conversionTarget} conversions. Agent paused, asking the human.`,
        });
      }

      intent.satisfied = w.satisfied;
      const topNow = [...intent.legs.filter((l) => !l.paused)].sort(
        (a, b) => b.allocation - a.allocation,
      )[0];
      intent.topVenue = topNow?.venue;
    }
  }

  // build escalations + find earliest undecided (pending)
  const escalations: Escalation[] = [];
  for (const w of work) {
    if (w.concRaised) {
      escalations.push(buildConcEscalation(w));
    }
    if (w.capRaised) {
      escalations.push(buildCapEscalation(w));
    }
    if (w.overRaised) {
      escalations.push(buildOverEscalation(w));
    }
  }
  const undecided = escalations
    .filter((e) => !decisions[e.key])
    .sort((a, b) => a.triggerT - b.triggerT);

  return {
    intents: work.map((w) => w.intent),
    logs: logs.sort((a, b) => b.id - a.id),
    saved,
    pending: undecided[0] ?? null,
    pendingCount: undecided.length,
  };
}

function buildConcEscalation(w: Work): Escalation {
  const r = w.concRaised!;
  return {
    key: concKey(w.intent.id),
    type: "concentration",
    intentId: w.intent.id,
    intentLabel: w.intent.label,
    triggerT: r.t,
    venue: r.venue,
    concentrationPct: r.pct,
    reason: `${((r.pct ?? 0) * 100).toFixed(0)}% of "${w.intent.label}" budget is now on ${venueName(r.venue!)}. High conversion, but a single-venue concentration risk.`,
    question: `Allow the concentration on ${venueName(r.venue!)}, or rebalance to cap it at ${(CONC_CLAMP * 100).toFixed(0)}%?`,
  };
}

function buildCapEscalation(w: Work): Escalation {
  const r = w.capRaised!;
  return {
    key: capKey(w.intent.id),
    type: "cap",
    intentId: w.intent.id,
    intentLabel: w.intent.label,
    triggerT: r.t,
    committed: r.committed,
    capUSD: r.cap,
    conversions: r.conversions,
    conversionTarget: w.intent.conversionTarget,
    pullsUSD: r.pullsUSD,
    fillDropPct: r.fillDropPct,
    capRaiseUSD: CAP_RAISE_USD,
    venue: r.worstVenue,
    reason: `"${w.intent.label}" hit ${(((r.committed ?? 0) / (r.cap ?? 1)) * 100).toFixed(0)}% of its $${(r.cap ?? 0).toFixed(0)} cap with only ${(r.conversions ?? 0).toFixed(0)}/${w.intent.conversionTarget} conversions.`,
    question: `Pull the ${venueName(r.worstVenue ?? "gpt")} leg to stay under cap (est. fill -${r.fillDropPct}%), or raise the cap $${CAP_RAISE_USD}?`,
  };
}

function buildOverEscalation(w: Work): Escalation {
  const r = w.overRaised!;
  const left = Math.max(0, (r.cap ?? 0) - (r.committed ?? 0));
  return {
    key: overKey(w.intent.id),
    type: "overperform",
    intentId: w.intent.id,
    intentLabel: w.intent.label,
    triggerT: r.t,
    committed: r.committed,
    capUSD: r.cap,
    conversions: r.conversions,
    conversionTarget: w.intent.conversionTarget,
    pullsUSD: left,
    reason: `Stellar day: "${w.intent.label}" already hit ${(r.conversions ?? 0).toFixed(0)}/${w.intent.conversionTarget} conversions at just ${(((r.committed ?? 0) / (r.cap ?? 1)) * 100).toFixed(0)}% of budget. $${left.toFixed(0)} still unspent.`,
    question: `Stand down and bank $${left.toFixed(0)}, or go MAX MODE and rinse the rest of the budget for extra conversions?`,
  };
}

export function fmtHour(t: number): string {
  const h = Math.floor(t);
  const m = Math.floor((t - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function intentCommitted(intent: Intent): number {
  return intent.legs.reduce((a, l) => a + l.committed, 0);
}
export function intentConversions(intent: Intent): number {
  return intent.legs.reduce((a, l) => a + l.conversions, 0);
}
