// A fake fetch for Sources that need more than a GET-by-URL (POST bodies, auth headers, paging).
// Each test describes the HTTP side it expects; anything else fails loudly, so no test reaches the network.
import { loadFixture } from "./harness.ts";

export interface SeenRequest {
  url: string;
  method: string;
  headers: Headers;
  /** The parsed JSON body, or null for a request without one. */
  json: unknown;
}

/** What a route answers: a fixture name, a JSON value, or a full Response. */
export type Answer = { fixture: string } | { json: unknown } | Response;

/**
 * Builds a fetch that hands every request to `route`. Returning undefined fails the request
 * like an unknown host would. `requests` records everything the adapter asked for.
 */
export function routedFetch(route: (req: SeenRequest) => Answer | undefined) {
  const requests: SeenRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body;
    const req: SeenRequest = {
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: new Headers(init?.headers),
      json: typeof body === "string" ? JSON.parse(body) : null,
    };
    requests.push(req);
    const answer = route(req);
    if (!answer) throw new Error(`routedFetch: nothing answers ${req.method} ${url}`);
    if (answer instanceof Response) return answer;
    const text = "fixture" in answer ? loadFixture(answer.fixture) : JSON.stringify(answer.json);
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, requests };
}
