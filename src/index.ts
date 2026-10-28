import { fetchFlightsHtml, parse, TimeoutError } from "fast-flights-ts";
import { ZodError } from "zod";
import { parseQuery } from "./query";

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") {
      return Response.json({ ok: true });
    }
    if (path !== "/flights") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (request.method !== "POST") {
      return Response.json({ error: "Use POST /flights" }, {
        status: 405, headers: { Allow: "POST" },
      });
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    let query;
    try {
      query = parseQuery(body);
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      return Response.json({ error: "Invalid search parameters", issues: error.issues }, { status: 400 });
    }

    // The HTML endpoint does not provide multi-city results (Google trip enum 3).
    if (query.trip === 3) {
      return Response.json({ error: "Multi-city searches are not supported by the HTML transport" }, { status: 422 });
    }

    try {
      // Google's RPC endpoint returns an error payload from Workers; HTML works.
      const html = await fetchFlightsHtml(query, { timeout: 20_000, maxRetries: 0 });
      const flights = parse(html);
      // JSON.stringify on the library's array would otherwise drop its metadata.
      return Response.json({ flights, metadata: flights.metadata });
    } catch (error) {
      console.error("Flight search failed:", error);
      const timedOut = error instanceof TimeoutError;
      return Response.json({
        error: timedOut ? "Flight search timed out" : "Unable to fetch flights from Google",
      }, { status: timedOut ? 504 : 502 });
    }
  },
};
