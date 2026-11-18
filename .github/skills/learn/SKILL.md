---
name: learn
description: "Learn durable guidance from a coding chat and update project instructions or suggest private user-level storage. Use to capture reusable lessons, preferences, corrections, workflows, and decisions from a conversation."
argument-hint: "Which chat or lesson should be captured?"
user-invocable: true
---

# Learn

Turn evidence from a conversation into concise guidance that prevents the same lesson from being rediscovered. Distinguish shared project knowledge from private user-specific preferences.

## Procedure

1. **Identify the scope.** Use the current conversation unless another source is specified. Classify each lesson as project-specific, user-specific, or both. This workspace skill may change repository files only for project-specific lessons.
2. **Extract durable rules.** Prefer explicit user requirements, repeated corrections, and verified solutions. For each rule, identify its trigger, expected behavior, supporting chat evidence, and verification.
3. **Exclude temporary or unproven material.** Do not capture task state, branch names, secrets, personal data, incidental choices, copied transcripts, speculative conclusions, or facts obvious from the code or enforced by tooling.
4. **Choose private or shared storage.**
   - for user-specific facts or preferences, suggest persistent user memory for concise context, or a user-level instruction/skill for reusable behavior;
   - never place a user-specific lesson in repository files, and never make it part of project guidance;
   - for project-specific lessons, use `AGENTS.md` or `copilot-instructions.md` for broad guidance, scoped `.instructions.md` files for file-path rules, and project skills for explicitly invoked workflows.
5. **Check for conflicts.** Search the proposed destination for equivalent or contradictory guidance. Update an existing rule rather than duplicate it. Ask the user to resolve unsupported conflicts or ambiguity.
6. **Propose the change first.** Group related rules by destination and scope. Show the proposed wording, storage location, supporting evidence, and any duplicate or conflict. For personal lessons, explicitly confirm that the destination is private and outside the repository. Always wait for approval before storing or editing anything.
7. **Keep it small.** Write imperative, actionable guidance with a condition when relevant. Preserve existing structure and wording, and avoid unrelated rewrites.
8. **Apply and validate.** Edit only approved destinations. Re-read the result, check Markdown/frontmatter, search for duplicates, and verify any referenced commands or paths.

## Completion

Report what was learned, where it was added, how duplication or conflicts were handled, and what was validated. Do not paste the full changed file unless asked.

## Examples

- `Learn from this chat and update AGENTS.md with durable guidance.`
- `Capture the testing lesson without duplicating existing instructions.`
- `Turn this workflow into project guidance, or tell me if it belongs in another skill.`
