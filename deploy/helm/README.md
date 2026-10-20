# bbm Helm chart

`deploy/helm/bbm` deploys the marketplace to the staging and prod AKS clusters
(release `bbm`, namespace `bbm`). It contains:

- `web` (Next.js, port 3000, `/healthz`) and `api` (Fastify, port 3001,
  `/health`): Deployments, Services, optional HPA and PDB.
- Migrations as a Helm hook Job (`node dist/migrate-cli.js`).
- ServiceAccounts with workload identity, plus Key Vault secrets through the
  Secrets Store CSI driver.
- An Ingress with an AKS app-routing `NginxIngressController` bound to the
  static public IP, and NetworkPolicies.
- Off by default: the `analysis` worker (with KEDA) and the `sandbox`
  namespace stub.

The default `values.yaml` is safe for any cluster, including kind. The
Azure-specific behaviour is switched on by the env files.

## Value layering

```
values.yaml                       # safe defaults (kind-friendly, Azure features off)
  -> values-<env>.yaml            # staging | prod: feature switches, sizes, replicas
  -> values-infra.yaml            # generated, never committed (terraform compute output)
  -> --set global.image.tag=sha-xxxxxxx
```

`values-infra.yaml` holds everything terraform knows:

- the ACR registry
- the tenant, client IDs, Key Vault and storage
- the ingress host and public IP
- the Postgres subnet CIDR

Generate it with:

```sh
infra/terraform/scripts/tf.sh compute <env> output -raw helm_values > values-infra.yaml
```

Expected keys (see `docs/adr/0001-azure-environment-topology.md`):

```yaml
global:   { image: { registry: <acr>.azurecr.io } }
azure:    { tenantId, keyVaultName, apiClientId, workerClientId, migrationsClientId,
            sandboxClientId, storageAccountName, storageBlobEndpoint, queueName }
ingress:  { host, publicIpName, publicIpResourceGroup }
networkPolicy: { postgresCidr }
```

The env files never hardcode these. Set `global.requireInfraValues=true` in
deploys, so a missing key fails rendering instead of producing a broken
SecretProviderClass or Ingress.

| file | used by | highlights |
|---|---|---|
| `values.yaml` | everything | plain Secret, no WI/ingress/netpol/HPA, 1 replica, migrations on api boot |
| `values-staging.yaml` | `deploy.yml` (staging) | csi + WI, ingress + app routing, netpol + egress lockdown, migrations hook, web HPA 1–3, api pinned to 1 |
| `values-prod.yaml` | `deploy.yml` (prod) | as staging + `bbm.io/pool=apps` nodeSelector, web HPA 2–5 + PDB, api pinned to 1 |
| `values-ci.yaml` | `ct install`, kind smoke tests | plain Secret with dummy `DATABASE_URL`, everything optional off |

> **API replicas.** Uploaded sources are stored on a per-pod `emptyDir`
> (`SOURCE_STORAGE_DIR=/data/sources`). Because of that, the api must stay at
> exactly one replica in every environment until a Blob storage adapter
> lands. Both env files pin the api HPA to `min 1 / max 1`.

## Secrets (`secrets.provider`)

| provider | what happens | use for |
|---|---|---|
| `plain` | the chart renders Secret `bbm-secrets` from `secrets.plain.*` | **dev/CI only**: values are stored in clear text in the Helm release |
| `csi` | SecretProviderClass `bbm-kv` syncs Key Vault `database-url` / `llm-api-key` into `bbm-secrets` | staging/prod |
| `existing` | a pre-created Secret named `secrets.name` is used | anything else |

The CSI driver only creates the synced Kubernetes Secret while a pod mounts
the CSI volume. For that reason, every pod that reads it mounts the volume at
`/mnt/secrets`.

Each SecretProviderClass uses the identity federated with the
ServiceAccount of the pods that mount it:

| SecretProviderClass | identity | synced Secret | mounted by |
|---|---|---|---|
| `bbm-kv` | `apiClientId` | `bbm-secrets` | api |
| `bbm-kv-migrations` (hook) | `migrationsClientId` | `bbm-secrets-migrations` | migrations Job |
| `bbm-kv-analysis` | `workerClientId` | `bbm-secrets-analysis` | analysis (only when enabled) |

## Migrations and hook ordering

When `migrations.enabled` is true:

- The api runs with `MIGRATE_ON_BOOT=false`.
- A `pre-install,pre-upgrade` hook Job runs `node dist/migrate-cli.js` with
  the api image.

Hooks run **before** any regular release resource exists. On first install
that includes the ConfigMap, `bbm-secrets` and `bbm-kv`. So everything the
Job needs is itself a hook:

| weight | resource | delete policy |
|---|---|---|
| -10 | ServiceAccount `bbm-migrations` | `before-hook-creation` + `resource-policy: keep` |
| -10 | Secret `bbm-secrets-migrations` (plain) **or** SecretProviderClass `bbm-kv-migrations` (csi) | same |
| -5 | Job `bbm-migrations` (`backoffLimit 1`, `activeDeadlineSeconds 300`) | `before-hook-creation,hook-succeeded` |

The hook copies have their own names, and `bbm-migrations` is never rendered
as a regular resource. This prevents a clash between a hook-owned object and
a release-owned object with the same name. With `existing`, the Job reads the
pre-created Secret directly.

A failed migration fails the `helm upgrade`. With `--atomic`, the release is
then rolled back. The failed Job is kept for `kubectl logs` until the next
deploy recreates it.

## Ingress and app routing

- The Ingress (`ingressClassName: bbm-nginx`) routes:
  - `/api` (Prefix) and `/health` (Exact) to `bbm-api:3001`
  - `/` to `bbm-web:3000`
- `ingress.tls.mode: certManager` adds the `cert-manager.io/cluster-issuer`
  annotation and a TLS block. cert-manager itself is not installed by this
  chart.
- `ingress.appRouting.enabled` renders the **cluster-scoped**
  `NginxIngressController` named `bbm`
  (`approuting.kubernetes.azure.com/v1alpha1`). Its LoadBalancer Service binds
  `pip-bbm-<env>-ingress` in `rg-bbm-<env>-data-eus2` through the
  `azure-pip-name` and `azure-load-balancer-resource-group` annotations.

## Local validation

```sh
cd deploy/helm

# lint every values layer (global.image.tag is required)
for f in "" values-staging.yaml values-prod.yaml values-ci.yaml; do
  helm lint --strict bbm ${f:+-f bbm/$f} --set global.image.tag=test
done

# render + schema-validate (CRDs from the datreeio catalog)
for f in values-staging.yaml values-prod.yaml values-ci.yaml; do
  helm template bbm bbm -n bbm -f bbm/$f --set global.image.tag=test \
    --set analysis.enabled=true --set sandbox.enabled=true --set migrations.enabled=true |
  kubeconform -strict -summary -kubernetes-version 1.31.0 \
    -schema-location default \
    -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' \
    -skip NginxIngressController
done

# rendering without a tag must fail
helm template bbm bbm -n bbm   # Error: ... global.image.tag is required

# chart-testing (from the repo root)
ct lint --config deploy/helm/ct.yaml --charts deploy/helm/bbm
```

`NginxIngressController` is not in the datreeio CRD catalog. To validate it,
convert the `openAPIV3Schema` of
[the operator's CRD](https://github.com/Azure/aks-app-routing-operator/blob/main/config/crd/bases/approuting.kubernetes.azure.com_nginxingresscontrollers.yaml)
to JSON and pass it as an extra `-schema-location`.

`ct` reads `bbm/ci/ci-values.yaml`, which is a symlink to `values-ci.yaml`.
`.helmignore` excludes it from the packaged chart. `ct install` needs the
image tag that was loaded into kind:

```sh
ct install --config deploy/helm/ct.yaml --charts deploy/helm/bbm \
  --helm-extra-set-args "--set=global.image.tag=<tag>"
```

## Deploy (as run by `.github/workflows/deploy.yml`)

```sh
infra/terraform/scripts/tf.sh compute "$ENV" output -raw helm_values > values-infra.yaml
az aks get-credentials -g "rg-bbm-$ENV-compute-eus2" -n "aks-bbm-$ENV-eus2"   # then kubelogin convert-kubeconfig -l azurecli
helm upgrade --install bbm deploy/helm/bbm \
  --namespace bbm --create-namespace \
  -f "deploy/helm/bbm/values-$ENV.yaml" \
  -f values-infra.yaml \
  --set global.image.tag="sha-${GITHUB_SHA::7}" \
  --set global.requireInfraValues=true \
  --atomic --wait --timeout 10m
helm test bbm -n bbm --timeout 5m
```

`helm test` runs a curl pod against `bbm-api:3001/health` and
`bbm-web:3000/healthz`.

## Cluster prerequisites (provided by the terraform compute stack)

- **AKS add-ons:**
  - OIDC issuer and workload identity
  - `azure-keyvault-secrets-provider` (with `secretObjects` sync)
  - app routing (`web_app_routing`)
  - KEDA, only when `analysis.keda.enabled`
- **Network policy:** Cilium enforces NetworkPolicies (CNI Overlay + Cilium).
- **Federated credentials:**
  - `system:serviceaccount:bbm:bbm-api` on the api identity
  - `system:serviceaccount:bbm:bbm-migrations` on the api identity (same as `migrationsClientId`)
  - `system:serviceaccount:bbm:bbm-analysis` on the worker identity
  - `system:serviceaccount:bbm-sandbox:bbm-sandbox-runner` on the sandbox identity
- **KEDA:** the `azure-workload` TriggerAuthentication makes the **KEDA
  operator** request a token as the worker identity. That identity therefore
  also needs a federated credential for
  `system:serviceaccount:kube-system:keda-operator`, plus
  `Storage Queue Data Reader` on the storage account.
- **Role assignments:**
  - `Key Vault Secrets User` on the env Key Vault for the api identity.
  - The same role for the worker identity when analysis is enabled.
  - `Network Contributor` on the data RG for the AKS cluster identity, so the
    app-routing LoadBalancer can use the static PIP.
- **Node pools:**
  - Node label `bbm.io/pool=apps` on the apps pool (prod `nodeSelector`).
  - `bbm.io/pool=sandbox` plus taint `bbm.io/sandbox=true:NoSchedule` and
    the Kata runtime on the sandbox pool.
- **Image user:** the images must run as a non-root numeric `USER` that
  matches `*.runAsUser`:
  - 1000 for web and api
  - 10001 for analysis

  Next.js must be able to write `.next/cache` (an `emptyDir` is mounted at
  `web.nextCacheDir`).
