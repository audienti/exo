---
principles:
  - Contact enrichment is about finding usable contact points, not just guessing an email.
  - Identity resolution matters more than raw handle collection.
  - Exo does not know which MCP servers or agent-side connectors are callable in the current runtime, so the agent must check that live before assuming any provider path exists.
  - Exo should not overfit to one user's provider stack. The agent should discover what is actually available in the current runtime and use that, not assume a fixed configuration.
  - Use owned evidence before external providers. If the email can be found confidently from first-party history or browser/search work, do not spend provider calls just because they exist.
  - Try to get to a verified direct email when the branch would benefit from one, but do not pretend weak evidence is verified.
do:
  - Try first-party history first: Gmail, CRM, prior threads, and any connected account history that can prove the address already exists.
  - After first-party history, use Google searches and browser-based public-web work before paid or external provider paths. If that produces a confident direct address, stop there and validate it rather than escalating to enrichment APIs.
  - Ask the current agent runtime whether it has additional contact-enrichment servers or connectors available. If MCP providers or consumer Composio toolkits are present, discover which relevant email-finding, phone-finding, and validation paths are actually available and connected before choosing one.
  - Anchor the company domain before guessing permutations. Use the official website, company pages, and public references to confirm the real outbound domain.
  - Search the public web second: team pages, PDFs, conference bios, press releases, personal sites, GitHub, and visible page text.
  - When provider tools are needed, use direct MCPs and direct CLIs before consumer Composio. Apply the Audienti preference order across the direct provider paths that are actually available in the current runtime. For direct email, prefer ICYPEAS, then LeadMagic, then Prospeo, then Findymail when those direct paths are actually present.
  - Only after first-party, search/browser, and direct MCP/CLI paths are exhausted should the agent fall back to consumer Composio discovery for connected provider toolkits.
  - When provider tools are available for phone lookup, use the provider path that matches the evidence you already have. Some phone lookups depend on a verified email, some depend on LinkedIn/profile truth, and Audienti does not currently use one single phone-provider order everywhere.
  - Only after the person identity and company domain are anchored, generate a short list of likely direct-email permutations.
  - Validate provider-returned or permutation-generated candidate emails with free or low-cost checks in order: syntax and domain, MX presence, then the best stronger validation path available in the runtime, then SMTP-style checks only if needed. Use Zerobounce only as a validator, not as a source-of-truth discovery database.
  - Store phone, email, and cross-platform profiles only when you can explain why they belong to the same person.
  - Treat explicit cross-links, shared personal domains, matching employer/title cues, and strong image matches as evidence.
avoid:
  - Do not assume a configured MCP server or Composio toolkit is actually callable, connected, or relevant from the current runtime until the agent confirms it can use it.
  - Do not jump to external providers before you have tried the owned-data and search/browser paths.
  - Do not store guessed direct emails as verified.
  - Do not jump to email permutations before you have a defensible company domain.
  - Do not treat MX success, catch-all acceptance, or masked third-party hints as proof of ownership.
  - Do not attach Reddit or other noisy profiles on weak handle similarity alone.
writeback:
  - Write each discovered contact point back with source, verification status, and match rationale.
  - Mark unresolved or rejected candidates explicitly so the same bad lead does not keep resurfacing.
  - If a provider path was unavailable in the runtime, record that as a method attempted so the agent can fall back cleanly without pretending the path ran.
  - If Exo already has this prospect, update that exact prospect id instead of re-adding the person and reasoning about dedupe behavior.
---
Try to find a verified direct email and other usable contact points for {{prospectName}} at {{companyName}}. Use this order. First, check owned evidence: Gmail, CRM, prior threads, and any connected account history that can already prove the address. Second, use Google searches and browser-based public-web work to find a confident direct address from company pages, PDFs, conference bios, press releases, personal sites, GitHub, and visible page text. If that public or first-party work produces a confident address, stop there and validate it rather than escalating to enrichment APIs. Third, if you still need provider help, inspect the current runtime for direct MCP servers and direct CLIs, then apply the Audienti preference order across the direct provider paths that are actually available: ICYPEAS, then LeadMagic, then Prospeo, then Findymail. Only after those direct paths are exhausted should you fall back to consumer Composio discovery for connected provider toolkits. Do not require a Composio developer project for this. For phone lookup, do not pretend there is one universal provider ladder. Use the provider path that matches the prerequisites you actually have, because some paths need a verified email and others can work from LinkedIn/profile truth. For verification, prefer the strongest validator available in the runtime, such as Zerobounce or an equivalent validator, before weaker SMTP-style heuristics, but use Zerobounce only for validation, not for discovery. If all provider paths are unavailable or exhausted, fall back to a small set of domain-anchored email permutations and then validate them. Do not guess blindly. Only treat an email as verified when the evidence ladder supports it, and keep weaker results as structured hints or rejected candidates instead of polluting the active fallback channel. Resolve identity carefully before attaching phone numbers or side-platform profiles. Strong evidence includes explicit cross-links, one profile referencing another, the same personal domain in multiple bios, and convincing image-plus-bio overlap. Treat Reddit more strictly than mainstream social profiles, and write back only structured, evidence-backed contact data into Exo. If this prospect already exists in Exo, update that exact record with `exo companies prospects update {{companyId}} --motion {{motionId}} --prospect {{prospectId}} ...` rather than re-adding the person.
