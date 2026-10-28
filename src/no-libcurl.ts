// Workers cannot load native addons. The library catches this and uses fetch.
throw new Error("node-libcurl is unavailable in Cloudflare Workers");
export {};
