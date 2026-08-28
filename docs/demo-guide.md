# Demo guide

This guide presents FinLake as a reusable blueprint while demonstrating a
specific customer outcome. Use synthetic, public, or explicitly approved
sanitized data only.

## Customer scenario

**Northstar Retail** is a fictional multi-brand retailer running commerce and
analytics workloads across AWS, GCP, Databricks, and Snowflake. Finance receives
separate bills after month end, while engineering teams use inconsistent
ownership tags. The result is late budget conversations and a growing pool of
spend that no team owns.

The demo question is:

> How can Finance and Engineering see total platform spend, identify its owner,
> predict a portfolio budget overrun, and decide the next action from one
> governed data product?

The story is deliberately narrower than "optimize all cloud costs":

1. Unify provider costs.
2. Identify cost owners and missing tags.
3. Show the portfolio forecast against budget.
4. Return a concrete investigation or remediation action to the owning team.

## Prerequisites

FinLake does not ship a canonical demo dataset. Before presenting:

- Load synthetic or approved non-sensitive FOCUS-shaped source data.
- Provision the Unity Catalog objects and run each enabled pipeline successfully.
- Select a SQL warehouse and verify Gold daily and monthly tables return data.
- Configure at least one portfolio budget.
- Create and test the FinOps Genie space.
- Check every number and prompt response you plan to show.
- Remove credentials, customer identifiers, and unrelated workspace objects.

Useful illustrative targets are four providers, monthly spend of `$1.2M`, a
`$1.1M` portfolio budget, a `$1.25M` forecast, and `72%` directly attributed
spend. These are story-design targets only; never state them as observed results
unless the loaded data and query output reproduce them.

## Suggested 7-minute flow

| Time | Surface          | Tell and show                                                                                                  |
| ---- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| 0:00 | Opening          | Finance learns about overruns too late because cost and ownership data are fragmented                          |
| 0:45 | Overview         | Show unified spend, trend, forecast, and portfolio budget status across providers                              |
| 2:00 | Cost Explorer    | Drill from the largest provider into service, account, and workload cost drivers                               |
| 3:15 | Tags / ownership | Show attributed spend and isolate the largest unallocated or missing-tag pool                                  |
| 4:15 | Budgets          | Explain the portfolio forecast and the decision deadline it creates                                            |
| 5:00 | Genie            | Ask a governed natural-language question and inspect the supporting result                                     |
| 6:00 | Action           | Assign a tag-remediation or workload investigation to the accountable team and quantify the addressable amount |

Lead with the business outcome, then show the integrated data journey. Keep
architecture for the handoff unless a technical stakeholder asks earlier.

## Genie prompts

Test prompts against the configured space before the demo. Good starting points:

- Which provider and service drove the largest month-over-month increase?
- How much current-month spend is unallocated for the `CostCenter` tag?
- Which teams have the highest spend and the fastest growth this month?
- Break down unallocated spend by provider, sub-account, and service.
- Which Databricks workloads should the platform team investigate first, and why?

Treat Genie as an investigation interface over governed data, not as the system
that authorizes financial actions.

## Claims to keep precise

| Say                                                                           | Do not claim yet                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| FinLake normalizes connected source data for multi-provider visibility        | Every provider invoice has been reconciled automatically          |
| Tags support direct ownership, showback, and missing-tag analysis             | Shared costs are fully allocated by fixed or proportional rules   |
| The dashboard compares portfolio actuals and forecast with configured budgets | Every budget scope has its own evaluated actual and forecast      |
| Recommendations provide directional savings estimates                         | The estimate is realized savings or the exact infrastructure bill |
| Lakebase stores app state while Unity Catalog governs cost facts              | Lakebase replaces the analytical lakehouse                        |

## Blueprint handoff

End by showing what the customer would own and customize:

- approved billing exports and refresh schedule;
- the FOCUS mapping and reconciliation policy;
- ownership tags, hierarchy, and remediation workflow;
- budget scopes and alert thresholds;
- allocation rules for shared services;
- Unity Catalog permissions and app service-principal access;
- validation of recommendations against actual workload behavior.

This frames the repository honestly: the connected Databricks implementation is
the accelerator, while financial policy and operating controls remain customer
decisions.

## Evidence checklist

For a formal review such as FE Bar, screenshots are supporting material, not
execution evidence. Commit readable text showing:

- source row counts and representative sanitized records;
- successful pipeline update IDs and output table row counts;
- Gold query results for the metrics used in the story;
- a real Genie question and answer;
- build, type-check, lint, and test output;
- the exact assumptions behind any value or savings estimate.

Rehearse the same flow for both a business stakeholder and a technical
stakeholder: outcome and decision first for the former; lineage, identity,
governance, failure handling, and extension points for the latter.
