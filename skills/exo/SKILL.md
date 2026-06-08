---
name: exo
description: Use when the user wants to initialize Exo in a folder, reinitialize Exo from live state, inspect governed next moves, or continue Exo motion work from the real system of record.
---

# Exo

This plugin uses the repo's real Exo CLI and the internal wrapper scripts under `.agents/plugins/plugins/exo/scripts`. Do not invent a second onboarding flow.

## Use this skill when

- the user wants to initialize Exo in the current folder or another project folder
- the user wants to reinitialize Exo from live state
- the user wants the governed next move from Exo
- the user wants to inspect or continue real Exo motions, companies, users, inbound state, or reports

## Initialization contract

- Adding the plugin only makes the skill available. It does not silently initialize a workspace.
- Initialization is explicit. Run the plugin init script first:

```bash
node ../../.agents/plugins/plugins/exo/scripts/init-exo-plugin.js --json
```

- The init script must:
  - install repo requirements when needed
  - inspect the real Exo onboarding state in the target workspace
  - ask whether the workspace should use `local-folder` or `global-install` when the install scope has not been chosen yet
  - surface recognized runtime services available in the current environment

- If the user chooses a scope, apply it through the same script:

```bash
node ../../.agents/plugins/plugins/exo/scripts/init-exo-plugin.js \
  --scope local-folder \
  --apply \
  --json
```

- If the user also wants to name the first execution user:

```bash
node ../../.agents/plugins/plugins/exo/scripts/init-exo-plugin.js \
  --scope local-folder \
  --label william-main \
  --apply \
  --json
```

## Reinitialize contract

When the user says `reinitialize`, do not assume empty state. Use the real repo flow:

```bash
cd <workspace-root>
export EXO_STATE_DIR=<workspace-root>/.exo
exo what-is-this --json
exo next --json
exo daily --json
exo inbox --json
```

Lead with the conclusion and the next governed move. Treat Exo as the system of record.
