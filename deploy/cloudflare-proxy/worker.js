// Serves one of DocSync AI's public domains from Cloud Run. Cloud Run in Mumbai can't map a
// custom domain itself, so this Worker forwards each request to the environment's run.app address
// (ORIGIN) with PROXY_SECRET, which the app requires (core/proxy.ts), and the caller's address in
// x-real-ip for rate limiting. Redirects that name the run.app address are pointed back at the domain.

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, env.ORIGIN);

    const headers = new Headers(request.headers);
    headers.set('x-real-ip', request.headers.get('cf-connecting-ip') ?? '');
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
    headers.set('x-proxy-secret', env.PROXY_SECRET);

    const response = await fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    });

    // Relative redirects (the app's usual "/login") already land on the right domain.
    const location = response.headers.get('location');
    if (!location || !/^https?:\/\//i.test(location)) return response;
    const next = new URL(location);
    if (next.host !== target.host) return response;
    next.protocol = url.protocol;
    next.host = url.host;
    const rewritten = new Response(response.body, response);
    rewritten.headers.set('location', next.toString());
    return rewritten;
  },
};

export default worker;
