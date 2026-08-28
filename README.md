# FinLake

FinLake is a reference blueprint for building a governed FinOps lakehouse on
Databricks. It brings cloud and data-platform cost data into a common FOCUS
model, makes cost ownership visible, and gives finance and engineering teams a
shared place to investigate spend and budgets.

Use it in either of two ways:

| Path          | Best for                                | Starting point                                                                                    |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Blueprint** | Adapting FinLake to a real organization | Connect approved cost sources, define ownership tags, and extend the supplied pipelines and app   |
| **Demo**      | Showing the end-to-end FinOps workflow  | Load synthetic or non-sensitive FOCUS-shaped data and follow the [demo guide](docs/demo-guide.md) |

FinLake is a starting point, not a billing system or a finished FinOps operating
model. Validate its metrics, permissions, allocation rules, and operational
controls before using it for financial decisions.

## What it includes

- Databricks, AWS, GCP, Snowflake, and custom cost-source onboarding
- Unity Catalog setup and serverless Lakeflow pipelines for Bronze/Silver/Gold
  cost data
- Multi-provider cost exploration using FOCUS-aligned dimensions and measures
- Portfolio-level budgets and forecast visibility
- Tag-based direct ownership, showback, and unallocated-cost investigation
- FinOps and performance Genie spaces over governed Gold data
- Databricks optimization recommendations with directional savings estimates
- Lakebase for deployed operational state, with SQLite for local development

See [Architecture](docs/architecture.md) for the data flow, trust boundaries,
and extension points.

## Scope and current boundaries

The repository deliberately distinguishes working capabilities from areas a
customer implementation still needs to complete:

| Area                   | Available now                                                                  | Customer extension                                                       |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Multi-cloud visibility | Normalize and explore connected provider costs                                 | Source-specific reconciliation and reporting controls                    |
| Ownership              | Attribute directly tagged spend and find missing tags                          | Tag policy, remediation workflow, and organizational mappings            |
| Budgets                | Store scoped budgets and compare the total portfolio with actuals and forecast | Scope-specific actual/forecast evaluation and alerts                     |
| Allocation             | Showback from tags and unallocated-cost analysis                               | Shared-cost rules such as fixed or proportional allocation               |
| Optimization           | Identify opportunities and estimate potential savings                          | Validate recommendations against workload behavior and realized invoices |

Do not present directional estimates as realized savings, or tag ownership as
full shared-cost chargeback.

## Quick start

Requirements: Node.js 22.16, npm, and optionally a Databricks workspace for live
data.

```sh
nvm use
npm install
cp .env.example .env.local  # optional; add Databricks credentials for live data
npm run dev
```

- Web app: <http://localhost:3000>
- API health: <http://localhost:8080/api/health>

Without Databricks credentials, the app and local API still start, but
workspace-backed data and setup actions are unavailable. Local state uses
`./data/finlake.db` unless `SQLITE_PATH` is set.

## Deploy to Databricks Apps

```sh
npm run build
databricks bundle validate -t prod
databricks bundle deploy -t prod
```

The bundle provisions the Databricks App and its Lakebase binding. After
deployment:

1. Grant the app service principal the required system-table, catalog, pipeline,
   and Genie permissions for the capabilities you enable.
2. Open **Admin > Catalog** and provision or select the governed catalog.
3. Add cost sources under **Integrations**.
4. Select an accessible SQL warehouse in the app; warehouses are discovered and
   selected at runtime rather than bound in the bundle.
5. Run the source pipelines and verify the Gold tables before configuring Genie
   or budgets.

Never commit customer exports, credentials, tokens, or customer-identifying
screenshots. Use synthetic, public, or explicitly approved sanitized data for a
demo.

## Database backend

The API has one backend-selection point controlled by `LAKEBASE_ENDPOINT`:

| Environment                    | Behavior                                                         |
| ------------------------------ | ---------------------------------------------------------------- |
| `LAKEBASE_ENDPOINT` is set     | Use Lakebase; boot fails if initialization or health checks fail |
| `LAKEBASE_ENDPOINT` is not set | Use SQLite; `SQLITE_PATH` can override the path                  |

The operational database holds settings, budgets, setup state, cache entries,
and Genie configuration. Governed cost facts remain in Unity Catalog.

## Development checks

```sh
npm run build
npm run typecheck
npm run lint
npm test
```

## Repository layout

```text
apps/web        React + Vite user interface
apps/api        Express API and Databricks integrations
packages/shared Shared schemas and SQL templates
packages/db     Lakebase/SQLite repository implementations
resources       Databricks Asset Bundle resources
docs            Blueprint architecture and demo guidance
```

## Documentation

- [Architecture and extension guide](docs/architecture.md)
- [Demo guide](docs/demo-guide.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
