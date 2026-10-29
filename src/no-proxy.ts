// Proxies are not exposed by this Worker; all requests use native fetch.
export class ProxyAgent {
  constructor() { throw new Error("Proxy dispatchers are not supported in this Worker"); }
}
