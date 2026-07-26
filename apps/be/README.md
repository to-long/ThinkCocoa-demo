# Backend API

A REST API built with Hono and SQL.js for managing stacks and cards.

## Tech Stack

- **Runtime**: Node.js with tsx
- **Framework**: [Hono](https://hono.dev/) - Fast, lightweight web framework
- **Database**: [SQL.js](https://sql.js.org/) - SQLite in JavaScript
- **Documentation**: Swagger/OpenAPI (auto-generated from JSDoc)

## Getting Started

### Install dependencies

```bash
pnpm install
```

### Run database migrations

```bash
bun run db:migrate
```

### Start development server

```bash
bun run dev
```

Server runs at http://localhost:8100

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server with hot reload |
| `bun run start` | Start production server |
| `bun run build` | Build TypeScript |
| `bun run db:migrate` | Run database migrations |
| `bun run generate:swagger` | Generate OpenAPI spec from JSDoc |

## API Endpoints

### General

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Welcome message |
| GET | `/health` | Health check |

### Stacks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stacks` | Get all stacks with card counts |
| GET | `/api/stacks/:id` | Get stack by ID with cards |
| POST | `/api/stacks` | Create a new stack |
| PUT | `/api/stacks/:id` | Update a stack |
| DELETE | `/api/stacks/:id` | Delete a stack and its cards |

### Cards

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cards` | Get all cards |
| GET | `/api/cards/:id` | Get card by ID |
| GET | `/api/stacks/:stackId/cards` | Get cards in a stack |
| POST | `/api/stacks/:stackId/cards` | Create a card in a stack |
| PUT | `/api/cards/:id` | Update a card |
| DELETE | `/api/cards/:id` | Delete a card |
| PATCH | `/api/cards/:id/move` | Move card to another stack |

## Swagger Documentation

Access interactive API docs at: http://localhost:8100/swagger

To regenerate after route changes:

```bash
bun run generate:swagger
```

## Project Structure

```
apps/be/
├── db/
│   ├── index.ts          # Database initialization
│   ├── migrate.ts        # Migration runner
│   └── migrations/       # SQL migrations
├── public/
│   ├── swagger.html      # Swagger UI
│   └── swagger.json      # OpenAPI spec
├── src/
│   ├── main.ts           # Entry point
│   ├── generate-swagger.ts
│   ├── data/             # Data stores
│   │   ├── db.ts
│   │   ├── stacks.store.ts
│   │   └── cards.store.ts
│   └── routes/           # API routes
│       ├── general.route.ts
│       ├── stacks.route.ts
│       └── cards.route.ts
├── data.db               # SQLite database file
├── package.json
└── tsconfig.json
```

## Database

SQLite database stored in `data.db`. Tables:

- **stacks**: id, name, cover_type, cover_value, created_at
- **cards**: id, stack_id, name, cover, description, created_at

## ThinkCocoa PostgreSQL/PostGIS skeleton

The current runnable backend still uses the existing `sql.js` sample app.

For the ThinkCocoa architecture work, a new PostgreSQL/PostGIS migration skeleton has been added under `apps/be/db/postgres/`.

It includes:

- a `pg`-based SQL migration runner
- schema-per-service ownership
- PostGIS-ready tables for `iam`, `farmer`, `field_ops`, `gis`, `traceability`, `reporting`, `integration`, and `audit`

Run it with:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5539/thinkcocoa bun run --filter be db:pg:migrate
```

See:

- `apps/be/db/postgres/README.md`
- `docs/thinkcocoa-erd.en.md`
- `docs/thinkcocoa-erd.vi.md`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8100` | Server port |


## Database

SQLite database stored at `apps/be/data.db`. Migrations run automatically before server start.

```bash
# Run migrations manually
cd apps/be && pnpm db:migrate
### Resetting the Database

If you need to reset the development database to a clean state, you can run:

```bash
cd apps/be && pnpm db:reset
```

This will drop all tables and re-run all migrations.

_**Note:**_ Only use this in development/testing. Running `db:reset` will erase **all** data from the database.

```
