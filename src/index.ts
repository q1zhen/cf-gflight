import { QueryValidationError, TimeoutError } from "google-flights-scraper";
import { ZodError } from "zod";
import { parseQuery } from "./query";
import { spec } from "./spec";
import { searchFlights } from "./search";

async function handleRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/" && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(request.method === "HEAD" ? null : spec, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
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
    if (error instanceof ZodError) {
      return Response.json({ error: "Invalid search parameters", issues: error.issues }, { status: 400 });
    }
    if (error instanceof QueryValidationError) {
      return Response.json({ error: "Invalid search parameters", issues: [
        { code: "custom", path: [], message: error.message },
      ] }, { status: 400 });
    }
    throw error;
  }

  if (query.trip === "round-trip") {
    return Response.json({ error: "Round-trip searches are temporarily disabled. Use one-way searches." }, { status: 422 });
  }
  // The HTML endpoint does not provide multi-city results.
  if (query.trip === "multi-city") {
    return Response.json({ error: "Multi-city searches are not supported by the HTML transport" }, { status: 422 });
  }

  try {
    return Response.json(await searchFlights(query));
  } catch (error) {
    console.error("Flight search failed:", error);
    const timedOut = error instanceof TimeoutError;
    return Response.json({
      error: timedOut ? "Flight search timed out" : "Unable to fetch flights from Google",
    }, { status: timedOut ? 504 : 502 });
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const response = request.method === "OPTIONS"
      ? new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
          },
        })
      : await handleRequest(request);
    // This public API has no cookies or authentication; allow any browser origin.
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  },
};
