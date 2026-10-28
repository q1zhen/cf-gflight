import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFlights, HttpError, TimeoutError, type FlightResults } from "fast-flights-ts";
import worker from "../src/index";

vi.mock("fast-flights-ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("fast-flights-ts")>(),
  getFlights: vi.fn(),
}));

const leg = { date: "2027-01-20", from_airport: "JFK", to_airport: "LAX" };
const returnLeg = { date: "2027-01-27", from_airport: "LAX", to_airport: "JFK" };
const search = (body: unknown) => worker.fetch(new Request("https://example.com/flights", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

beforeEach(() => vi.resetAllMocks());

describe("flight API", () => {
  it("checks health without calling Google", async () => {
    const response = await worker.fetch(new Request("https://example.com/health"));
    expect(await response.json()).toEqual({ ok: true });
    expect(getFlights).not.toHaveBeenCalled();
  });

  it("returns 404 and 405 for unsupported routes and methods", async () => {
    expect((await worker.fetch(new Request("https://example.com/missing"))).status).toBe(404);
    const response = await worker.fetch(new Request("https://example.com/flights"));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("rejects non-JSON and malformed JSON", async () => {
    expect((await worker.fetch(new Request("https://example.com/flights", {
      method: "POST", body: "hello",
    }))).status).toBe(415);
    expect((await worker.fetch(new Request("https://example.com/flights", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    }))).status).toBe(400);
    expect(getFlights).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { flights: [] },
    { flights: [{ ...leg, date: "2027-02-30" }] },
    { flights: [{ ...leg, from_airport: "INVALID" }] },
    { flights: [{ ...leg, to_airport: "JFK" }] },
    { flights: [leg], trip: "round-trip" },
    { flights: [leg, returnLeg] },
    { flights: [leg, { ...returnLeg, date: "2027-01-01" }], trip: "round-trip" },
    { flights: [leg, { ...returnLeg, to_airport: "BOS" }], trip: "round-trip" },
    { flights: [leg], seat: "standing" },
    { flights: [leg], max_stops: -1 },
    { flights: [leg], passengers: { adults: 0 } },
    { flights: [leg], passengers: { adults: -1 } },
    { flights: [leg], passengers: { adults: 1.5 } },
    { flights: [leg], passengers: { adults: 9, children: 1 } },
    { flights: [leg], passengers: { adults: 1, infants_on_lap: 2 } },
  ])("rejects invalid input before contacting Google: %j", async (body) => {
    const response = await search(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid search parameters" });
    expect(getFlights).not.toHaveBeenCalled();
  });

  it("normalizes airports, applies defaults, and preserves metadata", async () => {
    const metadata = { airlines: [], alliances: [] };
    const results = Object.assign([{ price: 123, airlines: ["Example Air"] }], { metadata });
    vi.mocked(getFlights).mockResolvedValue(results as unknown as FlightResults);
    const response = await search({ flights: [{ ...leg, from_airport: " jfk " }] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ flights: [...results], metadata });
    const [query, options] = vi.mocked(getFlights).mock.calls[0];
    expect(query).toMatchObject({
      flightData: [leg], trip: 2, seat: 1, passengers: [1], currency: "USD", language: "en-US",
    });
    expect(options).toEqual({ timeout: 20_000, maxRetries: 0 });
  });

  it.each(["round-trip", "multi-city"])("supports %s and optional filters", async (trip) => {
    vi.mocked(getFlights).mockResolvedValue(Object.assign([], { metadata: { airlines: [], alliances: [] } }));
    const response = await search({
      flights: [{ ...leg, airlines: ["AA"], max_stops: 0 }, returnLeg],
      trip, seat: "business", max_stops: 1, currency: "eur", language: "de",
      passengers: { adults: 2, children: 1 },
    });
    expect(response.status).toBe(200);
    expect(vi.mocked(getFlights).mock.calls[0][0]).toMatchObject({
      flightData: [{ ...leg, airlines: ["AA"], max_stops: 0 }, { ...returnLeg, max_stops: 1 }],
      seat: 3, trip: trip === "round-trip" ? 1 : 3, currency: "EUR", language: "de",
      passengers: [1, 1, 2],
    });
    expect(await response.json()).toMatchObject({ flights: [] });
  });

  it.each([
    [new TimeoutError(20_000), 504, "Flight search timed out"],
    [new HttpError(429, 0), 502, "Unable to fetch flights from Google"],
    [new Error("private upstream details"), 502, "Unable to fetch flights from Google"],
  ])("maps upstream failures to JSON errors", async (error, status, message) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(getFlights).mockRejectedValue(error);
      const response = await search({ flights: [leg] });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
    } finally {
      log.mockRestore();
    }
  });
});
