# skills

Personal agent skills.

## Skills

| Skill | Description |
| --- | --- |
| [ui-previews](ui-previews/SKILL.md) | Explains UI changes with before/after screenshots and an annotated HTML report. |

## Install with npx

```sh
npx skills@latest add K4nes/skills
```

The CLI finds `ui-previews`, then asks which agent and scope to install to. Requires Node 22.20+.

Non-interactive project install:

```sh
npx skills@latest add K4nes/skills --skill ui-previews -a universal -y
```

The CLI installs to each agent's skill directory and writes `skills-lock.json` in the project. To keep using an agent that reads `~/.agents/skills` (e.g. OMP), use the manual symlink below.

## Install manually (any agent)

Clone the repository where you keep your skills, then symlink each skill into `~/.agents/skills`:

```sh
git clone https://github.com/K4nes/skills.git ~/skills
ln -s ~/skills/ui-previews ~/.agents/skills/ui-previews
```

The repository is the source of truth; the symlink keeps `~/.agents/skills/<name>` pointing at it.

## ui-previews

Requires Node 18+.

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
