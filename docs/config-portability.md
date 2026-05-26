# Config Portability

Exo should be portable by design.

If configuration export/import is an afterthought, the product eventually rots into:

- one-machine state
- one-chat state
- invisible local assumptions
- impossible alpha-user reproduction

That is avoidable. So config portability is now a first-class CLI surface.

## Current CLI

- `exo config export`
- `exo config import`

## What the bundle contains

The current config bundle contains:

- motions
- companies
- browser profiles

The bundle is JSON and schema-validated on import.

## Export

Write a file:

```bash
exo config export --out ./exo-config.json
```

Or emit the bundle directly for an agent:

```bash
exo config export --json
```

## Import

Import a saved bundle:

```bash
exo config import ./exo-config.json
exo config import ./exo-config.json --json
```

## Import semantics

The current rules are intentionally simple:

- motions are upserted by id
- browser profiles are upserted by id
- if a browser profile path already exists locally under a different id, Exo treats the local path as the stronger identity and updates that record
- import does not delete local state that is absent from the file

## Browser profile rule

Browser profiles are always re-tested on import.

That matters because a profile that was `ready` on one machine or one day may be:

- missing locally
- moved
- logged out
- pointing at the wrong browser command

Config portability should move the declared profile, not blindly preserve stale trust.

## Why agents care

Agents need portable config for three reasons:

1. handoff between parallel chats
2. reproducible alpha-user setup
3. moving state without copying the SQLite file directly

That is the real role of `exo config export/import`.
