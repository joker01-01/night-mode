const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("repository separates the user runner skill from the maintainer skill", () => {
  const skillFile = path.join(__dirname, "..", "SKILL.md");
  const skill = fs.readFileSync(skillFile, "utf8");
  assert.match(skill, /^---\nname: night-mode\ndescription: \S.*\n---\n/);
  assert.match(skill, /scripts\/night-mode/);
  assert.match(skill, /do not use for maintaining/i);

  const maintainerFile = path.join(__dirname, "..", ".agents", "skills", "night-mode-maintainer", "SKILL.md");
  const maintainer = fs.readFileSync(maintainerFile, "utf8");
  assert.match(maintainer, /^---\nname: night-mode-maintainer\ndescription: \S.*\n---\n/);
  assert.match(maintainer, /PRODUCT_REQUIREMENTS\.md/);
  assert.match(maintainer, /do not use merely to run/i);
});
