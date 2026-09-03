---
name: self-improvement
description: After a task or run, capture what worked/failed into memory and propose concrete improvements to agents, skills, or the registry. Keeps the system getting smarter over time without manual rewrites — controlled, not blind.
---

# self-improvement — Learn & Propose

Run at the end of non-trivial work (or on a schedule).

## Steps
1. **Capture** — log outcomes to `memory/` (what succeeded, what failed, surprises).
2. **Reflect** — was the right agent picked? was the model right? any repeated failure?
3. **Propose** — if a fix is clear, propose via the `extend` method:
   - new agent/skill needed? → add + register
   - agent underperforming? → note for refinement
   - registry tag wrong? → update
4. **Report** — short summary of improvements proposed. Do NOT auto-edit production agents without review.

This is the controlled self-improvement loop: the system evolves, but changes are
proposed, then applied through the `extend` governance — never blindly mutated.
