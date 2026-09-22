# Instructions — RoutineWebApp

## Language
Always respond to the user in Thai (ภาษาไทย), regardless of what language the prompt is written in. Code comments, variable names, and commit messages stay in English as normal — this rule is about your conversational replies/summaries only.

## Before touching UI
Read `design.md` at the repo root first. It defines the visual system (color tokens, typography, layout hierarchy principles). Follow it; if a task conflicts with it, ask instead of guessing. If you find design.md doesn't match what's actually in the code, trust the code and flag the mismatch in your report — don't silently follow stale docs.

## Working style
- End every round with: a summary of what changed, and a checklist of what the user needs to test herself.
- Do not commit unless explicitly asked to.
- Do not change database schema or sync architecture without explicit evidence that it's the actual root cause of a bug — presentation-layer bugs are common in this codebase; verify with direct data inspection before assuming a data/sync problem.

## Context note
This project was built collaboratively across Codex (chat), Codex, and Google Antigravity at different points — if something looks unfamiliar or inconsistent with what's described here, it may be from a session with different tooling. Check the actual code over assumptions.
