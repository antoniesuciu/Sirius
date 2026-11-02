# ADR 0007: one file chooses local or deployed

Status: accepted, 2026-11-02. Decided by the owner.

Sirius may stay on the laptop forever, or may later serve other devices. The owner wants that to
be a deliberate edit, not a setting in the app.

Decision: `deployment.env` holds `SIRIUS_TARGET=local|remote`, and `scripts/deploy.sh` applies it.
`local` needs no Docker or accounts. Secrets stay in the git-ignored `infra/.env`. Switching never
deletes data, and only one core runs at a time, because ADR-2 allows a single writer.

M7 and M8 are built but not deployed, so the remote path exists and is tested without any
account. The branch `local-only` and tag `v1.0-local` keep a copy from before any of that code.

Also decided here: Cloudflare Access JWTs are verified against the team's keys rather than
trusted, because anything that can reach the origin could set that header.
