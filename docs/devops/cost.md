# Cost estimates

> **Rough estimates only.** Figures are approximate `eastus2` pay-as-you-go list prices in USD
> (730 hours per month), rounded, before taxes, credits or free grants unless stated. Check them
> against the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) and the
> subscription's Cost Management view before relying on them. Prices change.

The design goal is a low floor: nothing runs by default, and staging and prod can be paused or torn
down without losing data. See [architecture.md](architecture.md) for the layers and
[env-lifecycle.md](env-lifecycle.md) for the power actions.

## Unit prices used

| Item                                             | Approx. price                                                                         | Where it's used                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| VM `Standard_B2als_v2` (2 vCPU, 4 GiB)           | ~$0.038/h, ~$27/month                                                                 | every AKS node                                     |
| Managed OS disk, 64 GB Premium SSD (P6)          | ~$10/month per node                                                                   | AKS node OS disks (exist only while nodes exist)   |
| Standard Load Balancer                           | ~$0.025/h for the first 5 rules, ~$18/month                                           | AKS (app-routing ingress + outbound)               |
| Standard static public IP                        | ~$0.005/h, ~$3.65/month each                                                          | `pip-bbm-<env>-ingress` (data RG), AKS outbound IP |
| PG Flexible `B_Standard_B1ms` compute            | ~$0.017/h, ~$12.50/month                                                              | staging and prod databases                         |
| PG Flexible storage                              | ~$0.115/GB-month, 32 GB ≈ $3.70/month                                                 | billed even when the server is stopped             |
| PG backup storage                                | free up to 100% of provisioned storage                                                | 7-day retention, no geo-redundancy                 |
| ACR Basic                                        | ~$0.167/day, ~$5/month (10 GB included)                                               | shared registry                                    |
| Log Analytics ingestion                          | ~$2.30–2.80/GB (first 5 GB/month free per billing account), 30-day retention included | shared and per-env workspaces                      |
| Key Vault (Standard)                             | ~$0.03 per 10,000 operations                                                          | shared and per-env vaults                          |
| Storage (LRS, hot) + queue operations            | cents per month at this scale                                                         | tfstate, `sources`, `analysis-jobs`                |
| AKS control plane, Free tier                     | $0                                                                                    | both clusters                                      |
| ACA Consumption, active                          | ~$0.000024/vCPU-s, ~$0.000003/GiB-s                                                   | test and preview apps                              |
| ACA Consumption, idle (min replicas, no traffic) | ~$0.000003/vCPU-s, ~$0.000003/GiB-s                                                   | test and preview apps                              |
| ACA free grant                                   | 180,000 vCPU-s, 360,000 GiB-s, 2M requests per month per subscription                 | applied first                                      |

## Always-on baseline

Paid every month whether or not any environment is up.

| Item                                             | Approx. per month                                 |
| ------------------------------------------------ | ------------------------------------------------- |
| ACR Basic                                        | $5                                                |
| Shared Log Analytics (ACA logs, cap 0.25 GB/day) | $0–5 typical. At the cap every day: ~7.5 GB ≈ $17 |
| tfstate storage, shared Key Vault                | < $1                                              |
| Budgets, Entra app registrations, RBAC           | $0                                                |
| **Global layer total**                           | **~$5–10**                                        |

Each AKS environment's **data** layer also never goes away. Its cost depends on the power state
and is included in the next table.

## Staging and prod by power state

Per environment, per month if left in that state the whole month. Staging runs everything on one
system node (no `apps` pool, Container Insights off). Prod runs at least one system node and one
`apps` node, with Container Insights on.

| State       | What is billed                                                                                        | Staging              | Prod                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| **running** | nodes + OS disks, LB, 2 public IPs, PG compute + storage, Log Analytics, KV, storage                  | ~$75–85 (~$2.60/day) | ~$120–150 (~$4–5/day), more when the autoscaler adds nodes |
| **paused**  | LB, 2 public IPs, PG storage, KV, storage, idle Log Analytics. Nodes and PG compute stop              | ~$25–30 (~$0.90/day) | ~$25–30 (~$0.90/day)                                       |
| **down**    | ingress public IP, PG storage, KV, storage. Compute stack (cluster, nodes, LB, outbound IP) destroyed | ~$7–9 (~$0.25/day)   | ~$7–9 (~$0.25/day)                                         |

How the running figures break down (staging): node ~$27, OS disk ~$10, LB ~$18, two public IPs
~$7, PG B1ms ~$12.50, PG storage ~$3.70, logs and the rest ~$0–5. Prod adds a second node and disk
(~$37) and Container Insights. Its workspace is capped at 0.5 GB/day, so ingestion is at most
~15 GB/month (~$35) and usually far less.

Notes:

- **A paused cluster still bills the load balancer and the public IPs.** AKS stop deallocates the
  nodes but keeps the Standard LB and its frontend IPs. Only `down` removes them. The ingress IP
  lives in the data RG on purpose, so it survives `down` and keeps the DNS name.
- **Postgres auto-starts after 7 days stopped.** The 06:30 UTC re-pause job stops it again, but up
  to a day of PG compute (~$0.40) can be billed each time.
- The running cost scales with **hours**, not days. A staging cluster up 8 hours a day on weekdays
  and paused otherwise is about $15–20 of running time plus ~$20 of paused time per month.
- The paused figure here (~$0.90/day) is higher than the quick table in
  [env-lifecycle.md](env-lifecycle.md), mainly because it counts the Standard LB at its full
  hourly rate. Treat the LB line as the one to verify in Cost Management.

## Ephemeral ACA environments

Each environment has an `api` app (0.25 vCPU / 0.5 GiB) with a Postgres sidecar (0.25 vCPU /
0.5 GiB), pinned at one replica, and a `web` app (0.25 vCPU / 0.5 GiB). The Consumption
environment itself has no base charge.

| Case                                                                 | Approx. cost                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| One pipeline-test run (~20–30 min alive, ~0.75 vCPU, 1.5 GiB)        | ~$0.03–0.05 at active rates. Usually covered by the free grant.                        |
| Nightly + per-merge test runs (~40 runs/month)                       | ~$1–2, mostly within the free grant                                                    |
| One open PR preview, idle (web scales to 0, api + sidecar stay at 1) | ~$0.40/day at idle rates, so ~$2.75 for a week                                         |
| One open PR preview, in active use                                   | up to ~$2/day while requests keep it active                                            |
| Image builds pushed to ACR                                           | storage within the 10 GB included; the weekly janitor purges old `pr-*` / `sha-*` tags |
| Logs                                                                 | ACA console logs go to the shared workspace, inside its 0.25 GB/day cap                |

A preview lives at most 168 hours after its last push. The janitor deletes anything past its
`expires_on` tag every 6 hours, so a forgotten preview costs at most a few dollars.

## Budget alerts

| Budget                             | Amount         | Scope                                                         | Notifications                        |
| ---------------------------------- | -------------- | ------------------------------------------------------------- | ------------------------------------ |
| `budget-bbm-subscription`          | $50/month      | the whole subscription (`stacks/bootstrap`)                   | 50%, 80%, 100% actual; 100% forecast |
| `budget-rg-bbm-<env>-<layer>-eus2` | $20/month each | `rg-bbm-{staging,prod}-{data,compute}-eus2` (`stacks/global`) | same thresholds                      |

Alerts go to `alert_emails` in `envs/global/*.tfvars`. Budgets only notify; they never stop
anything.

**Gap:** AKS bills nodes, OS disks, the load balancer and the outbound IP in the **node** resource
group `rg-bbm-<env>-aksnodes-eus2`, which has no per-RG budget. The `compute` RG holds only the
Free-tier cluster object, so its $20 budget sees almost nothing. Running cost is caught only by the
subscription budget today. A filtered subscription budget (by `env` tag or by node RG) would close
this. The `test` and `preview` RGs also have no per-RG budget.

## Cost levers

| Lever                                 | Effect                                                                                                      | Where                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Nightly auto-pause** (06:00 UTC)    | turns a forgotten running env (~$2.60–5/day) into a paused one (~$0.90/day)                                 | `env-power.yml` schedule; opt out with `auto-pause=false`     |
| **`down` for long breaks**            | paused → down saves ~$20/month per env and avoids the 12-month stopped-cluster limit                        | `env-power.yml action=down confirm=<env>`                     |
| **Daily PG re-pause** (06:30 UTC)     | undoes Azure's 7-day auto-start of a stopped server                                                         | `env-power.yml` schedule                                      |
| **Log Analytics daily caps**          | worst-case ingestion bounded: shared 0.25 GB/day, each env 0.5 GB/day                                       | `law_daily_quota_gb` in tfvars                                |
| **Container Insights off in staging** | avoids most per-node log ingestion                                                                          | `container_insights = false` in `envs/staging/compute.tfvars` |
| **No `apps` pool in staging**         | one node instead of two                                                                                     | `apps_pool_enabled = false`                                   |
| **Sandbox pool off**                  | no Dsv5 node (a D2s_v5 is roughly 2.5× a B2als_v2 per hour) until PoC execution is needed                   | `sandbox_pool_enabled = false`                                |
| **Burstable SKUs**                    | B-series nodes and PG B1ms are the cheapest that run the stack                                              | `*_vm_size`, `postgres_sku_name`                              |
| **Ephemeral envs always destroyed**   | `integration-azure.yml` destroys with `always()`, `preview.yml` on PR close                                 | workflows                                                     |
| **Janitor** (every 6 h, weekly purge) | removes expired ACA envs and stale state; purges old ACR tags (keeps the 10 newest, protects deployed tags) | `infra-janitor.yml`                                           |
| **Free AKS tier**                     | no control-plane charge (no uptime SLA)                                                                     | `modules/aks`                                                 |

## Typical month

Both environments down, a handful of PRs and the nightly test runs: about **$20–30** (global
layer ~$5–10, two data layers ~$15, ACA ~$1–5).

Bring staging up and run it 8 hours a day on weekdays, paused the rest of the time: about
**$50–60**, which crosses the $50 subscription alert. Prod running around the clock alone would exceed the budget, so keep
prod paused or down except for demos.
