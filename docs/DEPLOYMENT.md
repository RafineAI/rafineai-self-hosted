# Deployment & Distribution

RafineAI ships as versioned container images. You build and push them once; your
customers install with a single command that pulls those images — no Go/Node/
Python toolchain on their machines.

```
   developer push ─► CI builds images ─► registry (GHCR / GCP Artifact Registry / Docker Hub)
                                              │
   customer ── curl install.sh ──────────────┘  (docker compose pull && up)
```

## 1. Build & push images (you)

Images are built from `gateway/Dockerfile`, `api/Dockerfile`, `panel/Dockerfile`.

### Manually
```bash
REGISTRY=ghcr.io/rafineai     # or: us-central1-docker.pkg.dev/<project>/rafineai
VERSION=v0.1.0

docker build -t $REGISTRY/gateway:$VERSION ./gateway
docker build -t $REGISTRY/api:$VERSION    -f api/Dockerfile .
docker build -t $REGISTRY/panel:$VERSION  -f panel/Dockerfile .

docker push $REGISTRY/gateway:$VERSION
docker push $REGISTRY/api:$VERSION
docker push $REGISTRY/panel:$VERSION
```

> The `api` and `panel` Dockerfiles use the **repo root** as build context
> (`-f api/Dockerfile .`) because the api image also needs `db/migrations`.

### Via CI
Pushing a tag like `v0.1.0` triggers `.github/workflows/release.yml`, which builds
all three images and pushes them to GHCR tagged with the version and `latest`.

### Using GCP Artifact Registry
```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
REGISTRY=us-central1-docker.pkg.dev/<project>/rafineai
# build/push as above
```
Set the same `REGISTRY` in the customer's `.env`.

### Using Docker Hub (private repository)

1. Create three **private** Docker Hub repos up front: `gateway`, `api`, `panel`
   (visibility can't be changed to private after the fact on the free tier).
2. Create a Docker Hub access token (Account Settings → Security) with
   Read & Write scope — don't use your account password in CI.
3. Add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` as GitHub Actions repository
   secrets. Pushing a version tag then also runs
   `.github/workflows/dockerhub-release.yml`, which builds and pushes to
   `docker.io/<DOCKERHUB_USERNAME>/<service>:<tag>`. It's a no-op if the secrets
   aren't set.
4. Or push manually:
   ```bash
   docker login
   REGISTRY=docker.io/<your-dockerhub-username>
   # build/push as above, e.g.:
   docker build -t $REGISTRY/gateway:$VERSION ./gateway && docker push $REGISTRY/gateway:$VERSION
   ```
5. Set `REGISTRY=docker.io/<your-dockerhub-username>` in the customer's `.env`.
   Because the repos are private, the customer machine must `docker login` with
   an account that has pull access before `docker compose pull` succeeds.

See the [Docker Hub Deployment section in the README](../README.md#docker-hub-deployment)
for the full step-by-step.

## 2. Customer install

```bash
git clone https://github.com/RafineAI/rafineai-self-hosted.git
cd rafineai-self-hosted
./install.sh
```

`install.sh` generates secrets, writes `.env`, runs `docker compose pull && up -d`,
waits for `/healthz`, and prints the owner credentials.

For a **private** registry, the customer must `docker login` first (or `install.sh`
can be extended to accept a service-account key).

## 3. Upgrades

```bash
# bump RAFINE_VERSION in .env, then:
docker compose pull && docker compose up -d
```
Migrations run automatically on api startup; they are idempotent.

## 4. Operations

| Action            | Command                          |
|-------------------|----------------------------------|
| Status            | `docker compose ps`              |
| Logs              | `docker compose logs -f <svc>`   |
| Stop              | `docker compose down`            |
| Reset everything  | `docker compose down -v` (drops the DB volume!) |

## 5. Backups

All state is in the `pgdata` volume. Back it up with `pg_dump`:
```bash
docker compose exec postgres pg_dump -U rafine rafineai > backup.sql
```
