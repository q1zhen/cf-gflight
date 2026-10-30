import { createQuery, type StructuredQueryInput } from "google-flights-scraper";
import { z } from "zod";

const airport = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const stops = z.number().int().min(0).max(0x7fffffff).optional();
const count = z.number().int().min(0).max(9).optional();
const timeWindow = z.strictObject({
  earliest: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  latest: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
}).refine((window) => !window.earliest || !window.latest || window.earliest <= window.latest, {
  message: "earliest must not exceed latest; overnight windows are not supported.",
});

const searchSchema = z.strictObject({
  flights: z.array(z.strictObject({
    date: z.iso.date(),
    fromAirport: airport,
    toAirport: airport,
    maxStops: stops,
    airlines: z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,32}$/)).max(50).optional(),
  })).min(1).max(6),
  trip: z.enum(["one-way", "round-trip", "multi-city"]).default("one-way"),
  seat: z.enum(["economy", "premium-economy", "business", "first"]).optional(),
  passengers: z.strictObject({
    adults: count, children: count, infantsInSeat: count, infantsOnLap: count,
  }).optional(),
  currency: z.string().trim().toUpperCase().regex(/^(?:[A-Z]{3})?$/).optional(),
  language: z.string().regex(/^(?:[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)?$/).optional(),
  region: z.string().trim().toUpperCase().regex(/^(?:[A-Z]{2})?$/).optional(),
  maxStops: stops,
  filters: z.strictObject({
    departureTime: timeWindow.optional(),
    arrivalTime: timeWindow.optional(),
    layover: z.strictObject({
      minMinutes: z.number().int().nonnegative().optional(),
      maxMinutes: z.number().int().nonnegative().optional(),
    }).optional(),
    connectionAirports: z.strictObject({
      allow: z.array(airport).max(50).optional(),
      block: z.array(airport).max(50).optional(),
    }).optional(),
  }).optional(),
}).superRefine((input, ctx) => {
  if (input.flights.some((flight) => flight.fromAirport === flight.toAirport)) {
    ctx.addIssue({ code: "custom", path: ["flights"], message: "Departure and arrival airports must differ." });
  }
  if (input.flights.some((flight, i) => i > 0 && flight.date < input.flights[i - 1].date)) {
    ctx.addIssue({ code: "custom", path: ["flights"], message: "Flight dates must be chronological." });
  }
  if (input.trip === "round-trip" && input.flights.length === 2) {
    const [outbound, inbound] = input.flights;
    if (outbound.fromAirport !== inbound.toAirport || outbound.toAirport !== inbound.fromAirport) {
      ctx.addIssue({ code: "custom", path: ["flights", 1], message: "The return leg must reverse the outbound airports." });
    }
  }
});

export function parseQuery(body: unknown): StructuredQueryInput {
  const input = searchSchema.parse(body);
  // Use upstream validation for passenger totals, leg counts and filter bounds.
  createQuery(input);
  return input;
}
