---
name: amplify
description: Force-multiplier method — make a weak/cheap base model produce high-quality, "high-tier" work by combining fine decomposition, rich agent specs, tool offloading, few-shot scaffolding, and a mandatory verify-fix loop. Use whenever the base model is low-tier (auto/cheap, auto/fast, local) or output quality drops.
---

# amplify — Make a Low Model Punch Above Its Weight

A weak model + smart scaffolding ≈ a strong model. The *agency*, not the model,
carries the intelligence.

## Principles
1. **Shrink the unit of work** — break every task into the smallest single-action
   steps a weak model can nail (one file, one function, one test). Big ambiguous
   prompts are where weak models fail.
2. **Let the prompt do the thinking** — each subagent spec must state: role, exact
   input/output format, constraints, and "reason step-by-step, then self-check."
   The model follows; it does not invent the architecture.
3. **Offload to tools, not memory** — use MCP tools to fetch/verify ground truth
   (playwright = see the UI, github = read the repo, supabase/firebase = real data).
   Weak models hallucinate far less when they can *check* instead of *guess*.
4. **Few-shot scaffolding** — give skeletons / templates / starter code; the model
   fills gaps instead of generating from zero.
5. **Mandatory verify-fix loop** — after any artifact: `code-reviewer` +
   `reality-checker` + `test-results-analyzer` + `codebase-health` must pass; the
   agent iterates until green. This converts 70%-correct weak output into
   shipped-correct.
6. **Rephrase / re-split on failure** — if a step fails, split it smaller or
   rephrase; never silently accept weak output.
7. **Spend the smart model only where it earns** — route only the genuinely hard
   step to `auto/coding`; everything else `auto/cheap` / `auto/fast`.

## Result
Even on the cheapest/free model, the agency delivers high-tier outcomes because
structure, tools, and verification — not raw model brilliance — guarantee correctness.
