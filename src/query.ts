import { createQuery, Passengers } from "fast-flights-ts";
import { z } from "zod";

const airport = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const stops = z.number().int().min(0).max(3).nullable().optional();
const count = z.number().int().min(0).max(9);

const searchSchema = z.object({
  flights: z.array(z.object({
    date: z.iso.date(),
    from_airport: airport,
    to_airport: airport,
    max_stops: stops,
    airlines: z.array(z.string().regex(/^[A-Z0-9]{2}$/)).max(50).nullable().optional(),
  })).min(1).max(6),
  trip: z.enum(["one-way", "round-trip", "multi-city"]).default("one-way"),
  seat: z.enum(["economy", "premium-economy", "business", "first"]).default("economy"),
  passengers: z.object({
    adults: count.default(1),
    children: count.default(0),
    infants_in_seat: count.default(0),
    infants_on_lap: count.default(0),
  }).default({ adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("USD"),
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/).default("en-US"),
  max_stops: stops,
}).superRefine((input, ctx) => {
  const { flights, trip, passengers } = input;
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });

  if ((trip === "one-way" && flights.length !== 1) ||
      (trip === "round-trip" && flights.length !== 2) ||
      (trip === "multi-city" && flights.length < 2)) {
    issue("flights", "Use 1 leg for one-way, 2 for round-trip, or 2–6 for multi-city.");
  }
  if (trip === "round-trip" && flights.length === 2 &&
      (flights[0].from_airport !== flights[1].to_airport ||
       flights[0].to_airport !== flights[1].from_airport)) {
    issue("flights", "Round-trip airports must be reversed on the return leg; use multi-city for open-jaw trips.");
  }
  if (flights.some((flight, i) => i > 0 && flight.date < flights[i - 1].date)) {
    issue("flights", "Flight dates must be in chronological order.");
  }
  if (flights.some((flight) => flight.from_airport === flight.to_airport)) {
    issue("flights", "Departure and arrival airports must differ.");
  }
  const total = Object.values(passengers).reduce((sum, value) => sum + value, 0);
  if (total < 1 || total > 9) issue("passengers", "Use 1–9 passengers in total.");
  if (passengers.infants_on_lap > passengers.adults) {
    issue("passengers", "Each infant on lap needs an adult.");
  }
});

export function parseQuery(body: unknown) {
  const input = searchSchema.parse(body);
  return createQuery({ ...input, passengers: new Passengers(input.passengers) });
}
