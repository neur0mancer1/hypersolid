import type { HeatShape, IntentSeed, Venue } from "./types";

export const DAY_START = 6;
export const DAY_END = 22;

export const COMPANY = "Cursor Coffee";
export const PRODUCT = "Hypersolid";

export const VENUES: Venue[] = [
  { id: "gpt", name: "ChatGPT Ads", short: "GPT" },
  { id: "pplx", name: "Perplexity", short: "PPLX" },
  { id: "thrad", name: "Thrad App", short: "THRAD" },
];

// Conversion propensity 0..1 for a heat shape at hour t.
export function heatAt(shape: HeatShape, amp: number, t: number): number {
  const peak = (() => {
    switch (shape) {
      case "morning":
        return 8.5;
      case "midday":
        return 13.5;
      case "evening":
        return 19.5;
      case "flat":
        return 14;
    }
  })();
  const width = shape === "flat" ? 9 : 4;
  const g = Math.exp(-((t - peak) ** 2) / (2 * width * width));
  const floor = shape === "flat" ? 0.45 : 0.1;
  return Math.min(1, floor + (amp - floor) * g);
}

// One brand (Cursor Coffee) running 5 conversational intents across 3 venues.
export const INTENT_SEEDS: IntentSeed[] = [
  {
    // morning commuter rush -> GPT-dominant -> concentration review + early net
    id: "bank",
    label: "best coffee near Bank station",
    capUSD: 3000,
    conversionTarget: 55,
    quality: 0.82,
    askMaxMode: true, // stellar early win -> prompt for MAX MODE
    legs: [
      { venue: "gpt", shape: "morning", amp: 0.97, baseCPC: 3.8 },
      { venue: "pplx", shape: "morning", amp: 0.2, baseCPC: 3.3 },
      { venue: "thrad", shape: "midday", amp: 0.2, baseCPC: 3.0 },
    ],
  },
  {
    // transactional, shopping-app strong -> concentration on THRAD + fast net
    id: "aeropress",
    label: "buy aeropress filters bank station",
    capUSD: 2200,
    conversionTarget: 42,
    quality: 0.95,
    legs: [
      { venue: "gpt", shape: "midday", amp: 0.3, baseCPC: 3.0 },
      { venue: "pplx", shape: "midday", amp: 0.28, baseCPC: 3.0 },
      { venue: "thrad", shape: "midday", amp: 0.95, baseCPC: 2.7 },
    ],
  },
  {
    // research-y evening intent that lags conversion -> cap-breach escalation
    id: "sub",
    label: "best coffee subscription london",
    capUSD: 3200,
    conversionTarget: 70,
    quality: 0.62,
    legs: [
      { venue: "gpt", shape: "evening", amp: 0.34, baseCPC: 3.1 },
      { venue: "pplx", shape: "evening", amp: 0.52, baseCPC: 3.6 },
      { venue: "thrad", shape: "evening", amp: 0.36, baseCPC: 2.7 },
    ],
  },
  {
    // low purchase-intent browsing -> burns budget, poor fill -> cap escalation
    id: "merch",
    label: "cool coffee shop merch",
    capUSD: 2400,
    conversionTarget: 68,
    quality: 0.27,
    spendMult: 1.6, // browses fast, converts poorly -> trips its cap by midday
    legs: [
      { venue: "gpt", shape: "flat", amp: 0.5, baseCPC: 2.6 },
      { venue: "pplx", shape: "flat", amp: 0.46, baseCPC: 2.7 },
      { venue: "thrad", shape: "flat", amp: 0.52, baseCPC: 2.4 },
    ],
  },
  {
    // evening, balanced across venues -> converts late -> net + persistence heads-up
    id: "date",
    label: "best coffeeshop for a date london",
    capUSD: 2800,
    conversionTarget: 50,
    quality: 0.66,
    legs: [
      { venue: "gpt", shape: "evening", amp: 0.6, baseCPC: 3.4 },
      { venue: "pplx", shape: "evening", amp: 0.64, baseCPC: 3.5 },
      { venue: "thrad", shape: "evening", amp: 0.34, baseCPC: 3.0 },
    ],
  },
];
