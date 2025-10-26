export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response = await env.ASSETS.fetch(request);

    if (response.status === 404 && request.method === "GET") {
      const accept = request.headers.get("accept") || "";
      const isDocumentRequest = accept.includes("text/html") && !url.pathname.includes(".");
      if (isDocumentRequest) {
        const indexUrl = new URL("/index.html", url.origin);
        const indexRequest = new Request(indexUrl, request);
        response = await env.ASSETS.fetch(indexRequest);
      }
    }

    return response;
  },
};
