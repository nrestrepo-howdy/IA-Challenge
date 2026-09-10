/**
 * The model proxy — why the product had no AI in it.
 *
 * `ClaudeResolver`, `ClaudeVisualCritic` and `ClaudeRepairAgent` were all built and
 * tested and none of them was reachable from the running app, for one honest reason: a
 * browser cannot hold an API key. So `main.ts` constructed a compiler with no model and
 * the shipped product ran a keyword table — three components passing their own tests
 * while the thing a user actually touched contained no intelligence at all.
 *
 * A key on the server is the ordinary answer, and it is the one that should have been
 * written first. This is a Vite plugin, so `npm run dev` is still one command: the key
 * stays in the Node process, the browser calls same-origin endpoints, and nothing about
 * the offline path changes — with no key these endpoints report that plainly and the
 * deterministic resolver keeps working.
 */
const JSON_HEADERS = { 'content-type': 'application/json' };

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function modelProxy() {
  return {
    name: 'verbo-model-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) {
          // Said out loud rather than 500'd: the client falls back deterministically,
          // and a silent failure here would look identical to a model that answered
          // badly. Those need different fixes.
          res.writeHead(503, JSON_HEADERS);
          res.end(JSON.stringify({ error: 'no ANTHROPIC_API_KEY on the server' }));
          return;
        }

        try {
          const { default: Anthropic } = await import('@anthropic-ai/sdk');
          const client = new Anthropic({ apiKey: key });
          const body = await readBody(req);

          if (req.url.startsWith('/api/resolve')) {
            const { ClaudeResolver } = await import('../../src/intent/model-resolver.ts');
            const out = await new ClaudeResolver({ client }).propose(body.request);
            res.writeHead(200, JSON_HEADERS);
            res.end(JSON.stringify({ raw: out }));
            return;
          }

          if (req.url.startsWith('/api/critique')) {
            const { ClaudeVisualCritic } = await import('../../src/harness/claude-critic.ts');
            const frame = {
              width: body.width, height: body.height,
              data: Uint8ClampedArray.from(atob(body.pixels), (c) => c.charCodeAt(0)),
            };
            const out = await new ClaudeVisualCritic({ client }).judge(frame, body.request);
            res.writeHead(200, JSON_HEADERS);
            res.end(JSON.stringify(out));
            return;
          }

          res.writeHead(404, JSON_HEADERS);
          res.end(JSON.stringify({ error: `no endpoint ${req.url}` }));
        } catch (err) {
          // The message reaches the browser so a failure is legible in the log the
          // user is already reading, rather than only in a terminal they are not.
          res.writeHead(502, JSON_HEADERS);
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}
