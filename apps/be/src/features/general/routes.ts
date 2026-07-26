import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

const app = new OpenAPIHono();

// ── GET /api ────────────────────────────────────────────────
// Moved off `/` so the FE static handler in `app.ts` can serve the
// SPA's `index.html` at the root path. `/api` keeps the welcome JSON
// for SDK probes / API sanity checks.
const welcomeRoute = createRoute({
  method: 'get',
  path: '/api',
  tags: ['General'],
  summary: 'Welcome',
  responses: {
    200: {
      description: 'Success',
      content: {
        'application/json': {
          schema: z.object({
            message: z.string(),
            timestamp: z.string(),
            version: z.string(),
          }),
        },
      },
    },
  },
});

app.openapi(welcomeRoute, (c) =>
  c.json({
    message: 'Welcome to the ThinkCocoa API',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }),
);

// ── GET /health ──────────────────────────────────────────────
const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['General'],
  summary: 'Health check',
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({ status: z.string() }),
        },
      },
    },
  },
});

app.openapi(healthRoute, (c) => c.json({ status: 'ok' }));

export { app as generalRoutes };
