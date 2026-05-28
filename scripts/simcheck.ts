import { DAY_END } from "../src/seed";
import { intentCommitted, intentConversions, simulate } from "../src/engine";
import { INTENT_SEEDS } from "../src/seed";
import type { Decision } from "../src/types";

// resolve every possible escalation so the full day plays out
const decisions: Record<string, Decision> = {};
for (const s of INTENT_SEEDS) {
  decisions[`conc:${s.id}`] = "ack";
  decisions[`cap:${s.id}`] = "pull";
  decisions[`over:${s.id}`] = "standdown";
}

const res = simulate(DAY_END, decisions);

console.log("=== STORY (chronological) ===");
[...res.logs]
  .filter((l) => ["net", "concentration", "persistence", "escalate", "resolve"].includes(l.kind))
  .sort((a, b) => a.t - b.t || a.id - b.id)
  .forEach((l) => {
    const tag = l.kind.toUpperCase().padEnd(13);
    console.log(`${l.t.toFixed(1).padStart(4)}  ${tag} ${l.text}`);
  });

console.log("=== END STATE ===");
for (const i of res.intents) {
  console.log(
    `${i.id.padEnd(10)} committed=$${intentCommitted(i).toFixed(0).padStart(5)}/${i.capUSD}  conv=${intentConversions(i).toFixed(0).padStart(3)}/${i.conversionTarget}  satisfied=${i.satisfied}`,
  );
}
console.log(`total saved=$${res.saved.toFixed(0)}  pendingCount=${res.pendingCount}`);
