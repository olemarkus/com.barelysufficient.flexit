const fs = require('node:fs');
const path = require('node:path');

const testDir = path.join(__dirname, '..', 'test');
const titlePattern = /\b(it|describe)\s*\(\s*(['"`])([^'"`]+)\2/;
const disallowedTitleRules = [
  {
    pattern: /^should\b/i,
    message: 'avoid "should" phrasing; describe the observable behavior instead.',
  },
  {
    pattern: /^covers\b/i,
    message: 'avoid coverage-oriented phrasing; describe the observable behavior instead.',
  },
  {
    pattern: /\bbranches?\b/i,
    message: 'avoid branch-oriented phrasing; describe the observable behavior instead.',
  },
];

function listTestFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function checkFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  const violations = [];
  const seenTitles = new Map();
  const relativePath = path.relative(process.cwd(), filePath);

  lines.forEach((line, index) => {
    const match = line.match(titlePattern);
    if (!match) return;

    const kind = match[1];
    const title = match[3].trim();
    if (kind !== 'it') return;

    for (const rule of disallowedTitleRules) {
      if (rule.pattern.test(title)) {
        violations.push(`${relativePath}:${index + 1} "${title}" ${rule.message}`);
      }
    }

    const firstSeenLine = seenTitles.get(title);
    if (firstSeenLine) {
      violations.push(
        `${relativePath}:${index + 1} "${title}" duplicates an earlier test title on line ${firstSeenLine}.`,
      );
      return;
    }

    seenTitles.set(title, index + 1);
  });

  return violations;
}

const violations = listTestFiles(testDir).flatMap((filePath) => checkFile(filePath));

if (violations.length > 0) {
  console.error('Test title check failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
