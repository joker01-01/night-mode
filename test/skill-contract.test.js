const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("repository exposes a valid Codex skill entry point", () => {
  const skillFile = path.join(__dirname, "..", "SKILL.md");
  const skill = fs.readFileSync(skillFile, "utf8");
  assert.match(skill, /^---\nname: night-mode\ndescription: \S.*\n---\n/);
  assert.match(skill, /# Night-Mode/);
});
