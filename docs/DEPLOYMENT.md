# Local or deployed

Sirius has one codebase and one switch: the file `deployment.env`. Edit it by hand, then run
`scripts/deploy.sh`. It is a file on purpose, so choosing where your data lives is never a
button in the app.

| | `SIRIUS_TARGET=local` (default) | `SIRIUS_TARGET=remote` |
|---|---|---|
| Runs on | This laptop, as systemd services | Docker, here or on another machine |
| Needs | Nothing beyond the install | Docker, then Cloudflare and ntfy if you want them |
| Reachable from | This laptop only | Your other devices |

Switching target never deletes data, but it does not move data either. To take your data
with you, see "Moving your data" below.

A frozen laptop-only copy of the project also lives at the git branch `local-only` and the tag
`v1.0-local`. It predates any deployment code. `git switch local-only` gets you there, and you can
tweak that branch freely.

## Going remote

1. Add your user to the `docker` group: `sudo usermod -aG docker $USER`, then log in again.
2. In `deployment.env`, set `SIRIUS_TARGET=remote` and `SIRIUS_REMOTE_URL`.
   For a homelab, also set `SIRIUS_DOCKER_HOST=ssh://you@homelab`.
3. For Cloudflare: create a tunnel pointing at `http://core:7337` and an Access application.
   Put `SIRIUS_CF_TEAM_DOMAIN` and `SIRIUS_CF_AUD` in `deployment.env`, add `tunnel` to
   `SIRIUS_PROFILES`, then copy `infra/env.example` to `infra/.env` and fill in the secrets.
   In the Access application, allow CORS preflight so the desktop app can connect.
4. For phone notifications, add `phone` to `SIRIUS_PROFILES`, set `SIRIUS_NTFY_URL`, and subscribe
   to the same topic in the ntfy app.
5. Run `scripts/deploy.sh`, then restart the desktop app.
6. On the phone, open the URL and use "Add to home screen".

The agent runner moves with the core. For chat to work remotely, `claude` and `codex` must be
installed and logged in where the core runs, and the current image does not include them.
Phone voice needs a `sirius-voice` instance started with `SIRIUS_VOICE_PORT=7338`, and the core
needs `SIRIUS_VOICE_URL` pointing at it. Neither is in the compose stack yet.

## Going back

Set `SIRIUS_TARGET=local` and run `scripts/deploy.sh`. That stops the stack, forgets the remote
address and reinstalls the laptop services.

## Moving your data

One core must own the database at a time (ADR-2). Stop both first.

```bash
# laptop to Docker
docker compose -p sirius -f infra/compose.yaml cp ~/.local/share/sirius/sirius.sqlite core:/data/

# Docker to laptop
docker compose -p sirius -f infra/compose.yaml cp core:/data/sirius.sqlite ~/.local/share/sirius/
```

## Restore drill

Litestream keeps a replica in the `sirius-backup` volume.

```bash
docker compose -p sirius -f infra/compose.yaml stop core
docker compose -p sirius -f infra/compose.yaml run --rm litestream \
  restore -o /data/sirius.sqlite -if-replica-exists /backup/sirius
docker compose -p sirius -f infra/compose.yaml start core
```

On the laptop, restoring means copying a file from `~/.local/share/sirius/backups/` over
`sirius.sqlite` with the core stopped.
