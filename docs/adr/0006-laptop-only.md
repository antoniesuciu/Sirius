# ADR 0006: laptop only for now, with a Special additions milestone

Status: accepted, 2026-11-02. Decided by the owner. ADR 0007 later built M7 and M8 without deploying them.

There is no homelab at the moment, only the laptop. M7 (remote core) and M8 (phone) depend on
one, so both are parked. Their design stays in the spec, and the core's env-driven config and the
`Notifier` seam still keep that path open, but nothing is built for them now.

The wake word no longer sits with the remote work. It moves to a new milestone, M9, Special
additions: extras that run on the laptop and are not needed for v1. M9 keeps its number because
ADR-8, ADR-9 and ADR-10 refer to M7 and M8, and it does not wait for them.

The avatar credit is dropped at the owner's request, along with the About screen it needed. The
icon came from a free site. Some free licences require attribution, so check this before
publishing the app.
