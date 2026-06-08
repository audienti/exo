---
name: initialize-exo
description: Use when the user wants a fresh Exo workspace initialized through the real onboarding flow, including dependency installation, install-scope choice, and recognized-service probing.
---

# Initialize Exo

This skill owns first-run setup for Exo. It must use the real Exo onboarding flow instead of a parallel plugin-only setup.

## Workflow

1. Run the plugin init script in the target workspace.

```bash
node ../../.agents/plugins/plugins/exo/scripts/init-exo-plugin.js --json
```

2. If the returned onboarding status is `needs-scope`, ask the install-scope question directly:
   - `local-folder`
   - `global-install`

3. Apply the chosen scope through the same script:

```bash
node ../../.agents/plugins/plugins/exo/scripts/init-exo-plugin.js \
  --scope local-folder \
  --apply \
  --json
```

4. If the user provides the first execution-user label, continue through the same script:

```bash
node ../../.agents/plugins/plugins/exo/scripts/init-exo-plugin.js \
  --scope local-folder \
  --label william-main \
  --apply \
  --json
```

5. Surface the recognized runtime services from the script output so the operator can see what Exo can already use in this environment.

## Fresh-start verification

When the user wants to prove that Exo can be reinitialized cleanly from scratch, run:

```bash
node ../../.agents/plugins/plugins/exo/scripts/verify-fresh-init.js
```

That verifier must prove that a true empty workspace asks for install scope before the first user exists and that a local-folder choice persists correctly.
