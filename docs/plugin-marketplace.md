# Plugin Marketplace

Exo now ships a repo-contained Audienti marketplace plugin wrapper so the repo can be installed and referenced as a Codex plugin without splitting Exo into a second codebase.

## Marketplace Files

- Marketplace catalog: `.agents/plugins/marketplace.json`
- Plugin root: `.agents/plugins/plugins/exo`

The marketplace entry uses the normalized plugin name `exo` and exposes it in the `Audienti` marketplace as an `AVAILABLE` `Business` plugin.

## Plugin Contract

The plugin contract is explicit:

- `add plugin` should only add the plugin metadata and skills
- `initialize plugin` should install dependencies if needed, inspect the real Exo onboarding state, and surface recognized runtime services
- the first-run onboarding decision still belongs to Exo itself

That means the wrapper does not invent a second onboarding system. It delegates to:

```bash
exo onboarding --json
```

and, when needed:

```bash
exo onboarding --scope local-folder --apply --json
exo onboarding --scope global-install --apply --json
```

## Local Commands

From the repo root:

```bash
npm run plugin:init -- --json
```

That wrapper will:

1. resolve the real repo root
2. install repo requirements if they are missing
3. run the real Exo onboarding command in the target workspace
4. report recognized runtime services available in the current environment

To continue onboarding through the wrapper:

```bash
npm run plugin:init -- --scope local-folder --apply --json
npm run plugin:init -- --scope local-folder --label william-main --apply --json
```

To verify a true fresh initialization path:

```bash
npm run plugin:verify
```

That verifier creates a temporary empty workspace, confirms that Exo asks for install scope before the first user exists, applies `local-folder`, and confirms that the workspace config persists.
