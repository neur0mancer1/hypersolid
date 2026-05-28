import { useEffect, useReducer, useRef } from "react";
import { COMPANY, DAY_END, DAY_START, PRODUCT, heatAt } from "./seed";
import {
  fmtHour,
  intentCommitted,
  intentConversions,
  simulate,
  venueName,
} from "./engine";
import type { Decision, Escalation, Intent, Leg, LogEntry } from "./types";

interface UiState {
  t: number;
  playing: boolean;
  speed: number; // sim hours per real second
  decisions: Record<string, Decision>;
  showModal: boolean;
}

function freshState(): UiState {
  return {
    t: DAY_START,
    playing: false,
    speed: 0.6,
    decisions: {},
    showModal: false,
  };
}

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function App() {
  const st = useRef<UiState>(freshState());
  const [, force] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const interval = setInterval(() => {
      const s = st.current;
      if (!s.playing || s.showModal) return;
      const dt = (120 / 1000) * s.speed;
      s.t = Math.min(DAY_END, s.t + dt);
      const sim = simulate(s.t, s.decisions);
      if (sim.pending) {
        s.playing = false;
        s.showModal = true;
      }
      if (s.t >= DAY_END) s.playing = false;
      force();
    }, 120);
    return () => clearInterval(interval);
  }, []);

  const s = st.current;
  const sim = simulate(s.t, s.decisions);

  const setScrub = (v: number) => {
    s.t = v;
    s.showModal = false;
    force();
  };
  const togglePlay = () => {
    if (s.t >= DAY_END) {
      s.t = DAY_START;
      s.decisions = {};
    }
    s.playing = !s.playing;
    force();
  };
  const setSpeed = (v: number) => {
    s.speed = v;
    force();
  };
  const reset = () => {
    st.current = freshState();
    force();
  };
  const decide = (key: string, d: Decision) => {
    s.decisions = { ...s.decisions, [key]: d };
    s.showModal = false;
    s.playing = true;
    force();
  };
  const openReview = () => {
    s.playing = false;
    s.showModal = true;
    force();
  };

  const totalCommitted = sim.intents.reduce((a, i) => a + intentCommitted(i), 0);
  const totalCap = sim.intents.reduce((a, i) => a + i.capUSD, 0);

  return (
    <div className="min-h-screen bg-ink text-[#ededf0] flex flex-col">
      <Header
        saved={sim.saved}
        committed={totalCommitted}
        cap={totalCap}
        onReset={reset}
      />
      <Controls
        t={s.t}
        playing={s.playing}
        speed={s.speed}
        onScrub={setScrub}
        onPlay={togglePlay}
        onSpeed={setSpeed}
      />
      {sim.pending && !s.showModal && (
        <PendingBanner count={sim.pendingCount} esc={sim.pending} onReview={openReview} />
      )}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3 px-4 pb-4 overflow-hidden">
        <div className="flex flex-col gap-2.5 overflow-auto pr-1">
          {sim.intents.map((intent) => (
            <IntentRow key={intent.id} intent={intent} t={s.t} />
          ))}
          <Legend />
        </div>
        <ActivityLog logs={sim.logs} />
      </div>
      {s.showModal && sim.pending && (
        <EscalationModal esc={sim.pending} onDecide={decide} />
      )}
    </div>
  );
}

function Header({
  saved,
  committed,
  cap,
  onReset,
}: {
  saved: number;
  committed: number;
  cap: number;
  onReset: () => void;
}) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-edge">
      <div>
        <div className="text-[11px] tracking-[0.3em] text-accent2">
          {PRODUCT.toUpperCase()}
        </div>
        <h1 className="text-lg font-semibold leading-tight">
          {COMPANY}{" "}
          <span className="text-muted font-normal">
            / buy-side exposure desk
          </span>
        </h1>
      </div>
      <div className="flex items-center gap-6">
        <Stat label="WASTED SPEND PREVENTED" value={usd(saved)} accent="good" />
        <Stat
          label="COMMITTED / CAP"
          value={`${usd(committed)} / ${usd(cap)}`}
        />
        <button
          onClick={onReset}
          className="text-xs border border-edge rounded px-3 py-2 hover:border-accent text-muted hover:text-accent2"
        >
          RESET
        </button>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "good" | "accent";
}) {
  const color =
    accent === "good" ? "text-good" : accent === "accent" ? "text-accent" : "";
  return (
    <div className="text-right">
      <div className="text-[10px] tracking-[0.18em] text-muted">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}

function Controls({
  t,
  playing,
  speed,
  onScrub,
  onPlay,
  onSpeed,
}: {
  t: number;
  playing: boolean;
  speed: number;
  onScrub: (v: number) => void;
  onPlay: () => void;
  onSpeed: (v: number) => void;
}) {
  return (
    <div className="px-4 py-3 border-b border-edge flex items-center gap-4">
      <button
        onClick={onPlay}
        className="w-28 text-sm font-semibold rounded px-3 py-2 bg-accent text-ink hover:bg-accent2"
      >
        {playing ? "❚❚ PAUSE" : t >= DAY_END ? "↻ REPLAY DAY" : "▶ PLAY DAY"}
      </button>
      <div className="flex-1">
        <div className="flex justify-between text-[10px] text-muted mb-1">
          <span>TIME OF DAY — drag to travel the day; watch the agent re-route</span>
          <span className="text-accent2 font-semibold tabular-nums">
            {fmtHour(t)}
          </span>
        </div>
        <input
          type="range"
          min={DAY_START}
          max={DAY_END}
          step={0.05}
          value={t}
          onChange={(e) => onScrub(parseFloat(e.target.value))}
          className="w-full accent-accent cursor-pointer"
        />
        <div className="flex justify-between text-[9px] text-muted mt-0.5">
          <span>06:00 morning</span>
          <span>13:00 midday</span>
          <span>20:00 evening</span>
        </div>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-muted">
        <span className="mr-1">SPEED</span>
        {[
          { l: "1x", v: 0.3 },
          { l: "2x", v: 0.6 },
          { l: "4x", v: 1.2 },
        ].map((o) => (
          <button
            key={o.l}
            onClick={() => onSpeed(o.v)}
            className={`px-2 py-1 rounded border ${
              speed === o.v
                ? "border-accent text-accent2"
                : "border-edge hover:border-muted"
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function PendingBanner({
  count,
  esc,
  onReview,
}: {
  count: number;
  esc: Escalation;
  onReview: () => void;
}) {
  return (
    <div className="mx-4 mt-3 bg-warn/10 border border-warn rounded-lg px-4 py-2.5 flex items-center justify-between slide-in">
      <div className="text-sm">
        <span className="text-warn font-semibold">
          {count} decision{count > 1 ? "s" : ""} pending
        </span>
        <span className="text-muted">
          {" "}
          — agent paused on “{esc.intentLabel}” (
          {esc.type === "cap"
            ? "budget cap"
            : esc.type === "overperform"
              ? "target smashed · MAX MODE?"
              : "venue concentration"}
          )
        </span>
      </div>
      <button
        onClick={onReview}
        className="text-sm font-semibold bg-warn text-ink rounded px-3 py-1.5 hover:opacity-90"
      >
        Review →
      </button>
    </div>
  );
}

function IntentRow({ intent, t }: { intent: Intent; t: number }) {
  const committed = intentCommitted(intent);
  const conversions = intentConversions(intent);
  const capPct = Math.min(1, committed / intent.capUSD);
  const targetPct = Math.min(1, conversions / intent.conversionTarget);
  const nearCap = capPct >= 0.9;

  const state = intent.frozen
    ? { label: "FROZEN · AWAITING HUMAN", cls: "text-warn border-warn" }
    : intent.satisfied
      ? { label: "TARGET MET · STOOD DOWN", cls: "text-good border-good/60" }
      : null;

  return (
    <div
      className={`bg-panel border rounded-lg p-3 ${
        intent.frozen ? "border-warn" : "border-edge"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-[236px] max-w-[236px]">
          <div className="text-sm font-semibold leading-tight">
            “{intent.label}”
          </div>
          {state && (
            <div
              className={`mt-1 inline-block text-[10px] border rounded px-1.5 py-0.5 ${state.cls}`}
            >
              {state.label}
            </div>
          )}
          <div className="mt-3 space-y-2">
            <Meter
              label="SPEND"
              value={`${usd(committed)} / ${usd(intent.capUSD)}`}
              pct={capPct}
              color={nearCap ? "bad" : "accent"}
            />
            <Meter
              label="CONVERSIONS"
              value={`${conversions.toFixed(0)} / ${intent.conversionTarget}`}
              pct={targetPct}
              color="good"
            />
          </div>
        </div>
        <div className="flex-1 grid grid-cols-3 gap-2">
          {intent.legs.map((leg) => (
            <VenueCell key={leg.venue} leg={leg} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function VenueCell({ leg, t }: { leg: Leg; t: number }) {
  const heat = heatAt(leg.shape, leg.amp, t);
  const isTop = leg.allocation > 0.5 && !leg.paused;
  return (
    <div
      className={`rounded-md border p-2.5 transition-colors ${
        leg.paused
          ? "border-edge/50 bg-panel2/40 opacity-50"
          : isTop
            ? "border-accent bg-panel2"
            : "border-edge bg-panel2"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide">
          {venueName(leg.venue)}
        </span>
        {leg.paused ? (
          <span className="text-[9px] text-bad border border-bad/60 rounded px-1">
            PAUSED
          </span>
        ) : (
          <span className="text-[9px] text-muted">CPC {usd(leg.bidCPC)}</span>
        )}
      </div>

      <div className="mt-2">
        <div className="text-[9px] text-muted">CONVERSION HEAT</div>
        <div className="h-1.5 rounded bg-edge mt-1 overflow-hidden">
          <div
            className="h-full rounded transition-all duration-200"
            style={{
              width: pct(heat),
              background:
                heat > 0.66 ? "#ff7a18" : heat > 0.4 ? "#ffcf5c" : "#7a7a85",
            }}
          />
        </div>
      </div>

      <div className="mt-2 flex items-end justify-between">
        <div>
          <div className="text-[9px] text-muted">BUDGET</div>
          <div
            className={`text-lg font-semibold tabular-nums ${
              isTop ? "text-accent2" : ""
            }`}
          >
            {leg.paused ? "—" : pct(leg.allocation)}
          </div>
        </div>
        <div className="text-right text-[10px] text-muted leading-tight">
          <div>{usd(leg.committed)}</div>
          <div className="text-good">{leg.conversions.toFixed(0)} conv</div>
        </div>
      </div>
    </div>
  );
}

function Meter({
  label,
  value,
  pct: p,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  color: "accent" | "good" | "bad" | "warn";
}) {
  const bg = {
    accent: "#ff7a18",
    good: "#3ddc97",
    bad: "#ff5d5d",
    warn: "#ffcf5c",
  }[color];
  return (
    <div>
      <div className="flex justify-between text-[9px] text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded bg-edge mt-1 overflow-hidden">
        <div
          className="h-full rounded transition-all duration-200"
          style={{ width: pct(Math.min(1, p)), background: bg }}
        />
      </div>
    </div>
  );
}

function ActivityLog({ logs }: { logs: LogEntry[] }) {
  return (
    <div className="bg-panel border border-edge rounded-lg flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-edge text-[10px] tracking-[0.2em] text-muted">
        AGENT ACTIVITY LOG
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {logs.slice(0, 60).map((l) => (
          <LogRow key={l.id} log={l} />
        ))}
      </div>
    </div>
  );
}

function LogRow({ log }: { log: LogEntry }) {
  const color = {
    route: "border-l-accent",
    net: "border-l-good",
    concentration: "border-l-warn",
    persistence: "border-l-[#5aa9ff]",
    escalate: "border-l-bad",
    resolve: "border-l-[#8a7bff]",
    info: "border-l-edge",
  }[log.kind];
  return (
    <div
      className={`slide-in text-[11px] leading-snug bg-panel2 border-l-2 ${color} rounded-r px-2 py-1.5`}
    >
      <div className="flex justify-between text-[9px] text-muted mb-0.5">
        <span>{fmtHour(log.t)}</span>
        <span className={log.autonomous ? "text-good" : "text-warn font-semibold"}>
          {log.autonomous ? "AUTONOMOUS" : "HUMAN-IN-LOOP"}
        </span>
      </div>
      <div>{log.text}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="text-[10px] text-muted flex flex-wrap gap-x-5 gap-y-1 px-1 pt-1">
      <span>
        <b className="text-accent">Routing</b> — budget chases the hottest
        converting venue by intent × time.
      </span>
      <span>
        <b className="text-good">Netting</b> — stand down once the target is met.
      </span>
      <span>
        <b className="text-warn">Concentration</b> — human review when one venue
        dominates.
      </span>
      <span>
        <b className="text-bad">Cap breach</b> — human signs off before
        overspending.
      </span>
    </div>
  );
}

function EscalationModal({
  esc,
  onDecide,
}: {
  esc: Escalation;
  onDecide: (key: string, d: Decision) => void;
}) {
  const accent =
    esc.type === "cap"
      ? "border-bad"
      : esc.type === "overperform"
        ? "border-good"
        : "border-warn";
  const banner =
    esc.type === "cap"
      ? { cls: "text-bad", text: "⚠ CAP BREACH · AGENT PAUSED · NEEDS A HUMAN" }
      : esc.type === "overperform"
        ? { cls: "text-good", text: "★ TARGET SMASHED · AGENT PAUSED · NEEDS A HUMAN" }
        : { cls: "text-warn", text: "⚠ CONCENTRATION REVIEW · NEEDS A HUMAN" };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div
        className={`slide-in bg-panel border rounded-xl max-w-lg w-full mx-4 p-5 ${accent}`}
      >
        <div className={`text-[11px] tracking-[0.2em] mb-1 ${banner.cls}`}>
          {banner.text}
        </div>
        <div className="text-sm mb-3 text-[#cfcfd6]">{esc.reason}</div>
        <div className="text-base font-semibold mb-4">{esc.question}</div>

        {esc.type === "cap" && (
          <>
            <div className="bg-panel2 border border-edge rounded-md p-3 mb-4 text-[11px] text-muted space-y-1">
              <div>
                Pull lowest fill-per-$ leg ({venueName(esc.venue ?? "gpt")}) → save{" "}
                <span className="text-good">{usd(esc.pullsUSD ?? 0)}</span>, est. fill{" "}
                <span className="text-bad">-{esc.fillDropPct}%</span>
              </div>
              <div>
                Raise cap by{" "}
                <span className="text-accent2">{usd(esc.capRaiseUSD ?? 0)}</span> →
                keep chasing the fill target (more spend)
              </div>
            </div>
            <div className="flex gap-2">
              <Choice
                onClick={() => onDecide(esc.key, "pull")}
                primary
                main="Approve pull"
                sub="no — pick me up i'm scared pls"
              />
              <Choice
                onClick={() => onDecide(esc.key, "raise")}
                main={`Raise cap ${usd(esc.capRaiseUSD ?? 0)}`}
                sub="yes — get mum's credit card"
              />
              <button
                onClick={() => onDecide(esc.key, "deny")}
                className="border border-edge text-muted rounded px-3 py-2.5 hover:border-muted text-sm"
              >
                Hold
              </button>
            </div>
          </>
        )}

        {esc.type === "concentration" && (
          <>
            <div className="bg-panel2 border border-edge rounded-md p-3 mb-4 text-[11px] text-muted space-y-1">
              <div>
                Acknowledge → keep routing budget to {venueName(esc.venue ?? "gpt")}{" "}
                (best conversion, higher single-venue exposure)
              </div>
              <div>
                Rebalance → cap {venueName(esc.venue ?? "gpt")} at 55% and spread
                the rest (lower exposure, slightly lower fill)
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onDecide(esc.key, "ack")}
                className="flex-1 border border-accent2 text-accent2 rounded px-3 py-2.5 hover:bg-panel2 text-sm"
              >
                Acknowledge concentration
              </button>
              <button
                onClick={() => onDecide(esc.key, "rebalance")}
                className="flex-1 bg-accent text-ink font-semibold rounded px-3 py-2.5 hover:bg-accent2 text-sm"
              >
                Rebalance to 55%
              </button>
            </div>
          </>
        )}

        {esc.type === "overperform" && (
          <>
            <div className="bg-panel2 border border-edge rounded-md p-3 mb-4 text-[11px] text-muted space-y-1">
              <div>
                Stand down → bank the unspent{" "}
                <span className="text-good">{usd(esc.pullsUSD ?? 0)}</span>, target
                already in the bag
              </div>
              <div>
                MAX MODE → keep spending the full budget to mop up every extra
                conversion (no savings, max volume)
              </div>
            </div>
            <div className="flex gap-2">
              <Choice
                onClick={() => onDecide(esc.key, "standdown")}
                main={`Stand down · bank ${usd(esc.pullsUSD ?? 0)}`}
                sub="sensible. boring. correct."
              />
              <Choice
                onClick={() => onDecide(esc.key, "max")}
                primary
                main="MAX MODE 🔥"
                sub="rinse the whole budget"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Choice({
  onClick,
  main,
  sub,
  primary,
}: {
  onClick: () => void;
  main: string;
  sub: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded px-3 py-2 text-sm ${
        primary
          ? "bg-accent text-ink font-semibold hover:bg-accent2"
          : "border border-accent2 text-accent2 hover:bg-panel2"
      }`}
    >
      <div>{main}</div>
      <div
        className={`text-[10px] font-normal italic ${
          primary ? "text-ink/70" : "text-muted"
        }`}
      >
        {sub}
      </div>
    </button>
  );
}
