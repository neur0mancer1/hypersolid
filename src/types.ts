export type VenueId = "gpt" | "pplx" | "thrad";

export interface Venue {
  id: VenueId;
  name: string;
  short: string;
}

export type HeatShape = "morning" | "midday" | "evening" | "flat";

export interface LegSeed {
  venue: VenueId;
  shape: HeatShape;
  amp: number; // peak demand 0..1
  baseCPC: number; // bid (cost per click) in USD
}

export interface IntentSeed {
  id: string;
  label: string;
  capUSD: number; // hard budget cap
  conversionTarget: number; // conversions we actually want
  quality: number; // purchase intent 0..1 (transactional high, browsing low)
  spendMult?: number; // spend-pace multiplier (controls when a cap is hit)
  askMaxMode?: boolean; // on early overperformance, prompt for MAX MODE
  legs: LegSeed[];
}

// Live, computed state for one intent x venue placement.
export interface Leg {
  venue: VenueId;
  shape: HeatShape;
  amp: number;
  bidCPC: number;
  allocation: number; // share of intent budget routed here (0..1)
  committed: number; // USD spent so far
  conversions: number;
  paused: boolean;
}

export interface Intent {
  id: string;
  label: string;
  capUSD: number;
  conversionTarget: number;
  quality: number;
  legs: Leg[];
  satisfied: boolean; // conversion target met -> stood down
  frozen: boolean; // waiting on a human decision
  topVenue?: VenueId;
}

export type LogKind =
  | "route"
  | "net"
  | "concentration"
  | "persistence"
  | "escalate"
  | "resolve"
  | "info";

export interface LogEntry {
  id: number;
  t: number;
  kind: LogKind;
  autonomous: boolean;
  intentId?: string;
  text: string;
  savedUSD?: number;
}

export type EscalationType = "cap" | "concentration" | "overperform";

export type Decision =
  | "pull"
  | "raise"
  | "deny"
  | "ack"
  | "rebalance"
  | "standdown"
  | "max";

export interface Escalation {
  key: string; // stable id, e.g. "cap:coffee-sub" or "conc:coffee-bank"
  type: EscalationType;
  intentId: string;
  intentLabel: string;
  triggerT: number;
  reason: string;
  question: string;
  venue?: VenueId;
  // cap-breach details
  pullsUSD?: number;
  fillDropPct?: number;
  capRaiseUSD?: number;
  committed?: number;
  capUSD?: number;
  conversions?: number;
  conversionTarget?: number;
  // concentration details
  concentrationPct?: number;
}
