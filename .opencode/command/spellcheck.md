---
description: spellcheck all markdown file changes
---

Look at all the uncommited changes to markdown (.md, .mdx) files, pull out the lines that have changed, and check for spelling and grammar errors.
Use your own reasoning on what might be a spelling mistake.

## Reporting Style Guide

1. Structure:
   - Single-Line Preference: Present the finding and the suggested change in a single, concise line whenever the context allows.
   - Clarity: Always state the file path and the nature of the error (e.g., "Capitalization," "Grammar," "Spelling").
   - Minimal: Only include the immediate surrounding text necessary to understand the change. Do not include the full paragraph or long sentences if the the error can be isolated to a short phrase or line.
2. Diff Presentation (Markdown Only):
   - Original Context: Strip all markdown formatting and present the original text as plain, unformatted text.
   - Removal: Use strikethrough (~~text~~) to indicate text that is being removed.
   - Addition: Use italisc (*text*) to indicate text that is being added.
   - Context: Always include line numbers.
3. Example Format (Markdown):
   - If the original line was: This Project is not performance-oriented
   - The output should look like:
**Finding 1: Capitalization**:
File: README.md, Line 10

> Original: This Project is not performance-oriented
> Change: This ~~Project~~ *project* is not performance-oriented

Outputs like `$\rightarrow$` dont work, use ASCII alternatives.
