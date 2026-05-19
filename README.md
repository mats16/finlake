# FinLake - FinOps Lakehouse

A FinOps web app for Databricks, deployed as a Databricks App.

- React 19 + Vite SPA (`apps/web`)
- Express + AppKit API (`apps/api`)
- Drizzle ORM with **Lakebase** (Postgres) or **SQLite** fallback (`packages/db`)
- npm workspaces + Turborepo

## Quick start (local dev)

```sh
# Use the pinned Node version
nvm use   # 22.16

npm install

# Optional: copy the env example and fill in Databricks credentials if you
# want to hit a real workspace. Without these the API still boots and serves
# empty rows for /api/usage/* endpoints. Both the API (loadEnv) and the Vite
# dev proxy read .env.local from the repo root.
cp .env.example .env.local

npm run dev
# Vite dev server: http://localhost:3000  (proxies /api -> :8080)
# Express API:    http://localhost:8080/api/health
```

By default, FinLake uses SQLite and writes to `./data/finlake.db` locally and
`/home/app/data/finlake.db` on Databricks Apps. If `LAKEBASE_ENDPOINT` is set,
the API uses Lakebase instead.

## Deploying to Databricks Apps

```sh
npm run build
databricks bundle validate -t prod
databricks bundle deploy   -t prod
```

The `app.yaml` runs `npm run start --workspace=apps/api`. Bind a SQL warehouse
in `resources/app.yml` (already templated as `warehouse`) and grant the app
service principal `SELECT` on `system.billing.usage` / `system.billing.list_prices`.

## Database backend selection

The API selects its database backend from `LAKEBASE_ENDPOINT`:

| Environment                    | Behavior                                                                   |
| ------------------------------ | -------------------------------------------------------------------------- |
| `LAKEBASE_ENDPOINT` is set     | Use Lakebase. Boot fails if Lakebase initialization or health check fails. |
| `LAKEBASE_ENDPOINT` is not set | Use SQLite. `SQLITE_PATH` can override the local database path.            |
