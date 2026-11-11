# Cold-author trial: expense approval rules

The Gate 1 trial from the front-door work (PR #156). A Codex agent that had
never seen Forma got only the packed `@forma-language/forma` tarball, `effect`,
and a copy of the README, `docs/authoring.md`, `docs/embedding.md`,
`docs/writing-a-form.md`, `docs/language.md`, `docs/modules.md` and
`docs/agents.md`. Its brief is in `REPORT.md`'s outcome section and in the
orchestrator's plan; its report, sources and evidence are kept as written.
Absolute paths in `evidence/` are replaced with `<trial>`.

To rerun against a local build, pack the distribution
(`pnpm --filter @forma-language/forma pack --out trials/expense-rules/forma-language-forma.tgz`),
then `pnpm install` here and run the commands in `REPORT.md`.
