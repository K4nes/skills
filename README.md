# skills

Personal agent skills.

## Skills

| Skill | Description |
| --- | --- |
| [ui-previews](ui-previews/SKILL.md) | Explains UI changes with before/after screenshots and an annotated HTML report. |

## Install

```sh
npx skills@latest add K4nes/skills
```

The CLI finds `ui-previews`, then asks which agent and scope to install to.

Non-interactive project install:

```sh
npx skills@latest add K4nes/skills --skill ui-previews -a universal -y
```

Add `-g` for a global install. If your agent reads `~/.agents/skills` globally, use an agent target that writes there, e.g. `-a codex -g`. The CLI writes `skills-lock.json` in the project for updates.

## Requirements

- `npx skills` installer: Node 22.20+.
- `ui-previews` builder: Node 18+.

## ui-previews

```sh
node ~/.agents/skills/ui-previews/scripts/build-report.mjs <evidence-dir>/deltas.json
```

Writes `report.html` beside `deltas.json`. See [ui-previews/SKILL.md](ui-previews/SKILL.md) for the evidence workflow and the `deltas.json` schema.

## Layout

```text
.gitignore
LICENSE
README.md
ui-previews/
  SKILL.md
  scripts/build-report.mjs
```

Add a skill as a top-level directory with a `SKILL.md`.

## License

MIT
