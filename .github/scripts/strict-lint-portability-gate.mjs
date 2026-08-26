import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { ESLint } from "eslint";

const [baseSha, ...files] = process.argv.slice(2);

if (!baseSha) {
  console.error("Usage: node strict-lint-portability-gate.mjs <base-sha> <files...>");
  process.exit(2);
}

if (files.length === 0) {
  console.log("No TypeScript files changed since portability baseline.");
  process.exit(0);
}

const eslint = new ESLint();
const authBoundaryMarkers = [
  "requireAdminOrTrustedWorker(",
  "requireUserOrTrustedWorker(",
];

function messageCounts(result) {
  const counts = new Map();
  for (const message of result.messages) {
    const key = `${message.severity}:${message.ruleId ?? "<parser>"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function newLintDebt(currentResult, baselineResult) {
  const current = messageCounts(currentResult);
  const baseline = messageCounts(baselineResult);
  const increases = [];

  for (const [key, count] of current) {
    const inherited = baseline.get(key) ?? 0;
    if (count > inherited) increases.push(`${key}: ${inherited} -> ${count}`);
  }
  return increases;
}

function baselineText(file) {
  try {
    return execFileSync("git", ["show", `${baseSha}:${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

let failed = false;
const currentResults = await eslint.lintFiles(files);

for (const result of currentResults) {
  const relativePath = relative(process.cwd(), result.filePath).replaceAll("\\", "/");
  const findingCount = result.errorCount + result.warningCount;
  if (findingCount === 0) {
    console.log(`PASS strict: ${relativePath}`);
    continue;
  }

  let currentText = "";
  try {
    currentText = readFileSync(result.filePath, "utf8");
  } catch {
    // A missing changed file is not eligible for inherited-debt treatment.
  }

  const isStandardizedAuthHardening = authBoundaryMarkers.some((marker) => currentText.includes(marker));
  if (!isStandardizedAuthHardening) {
    console.error(
      `FAIL strict: ${relativePath} has ${result.errorCount} error(s) / ${result.warningCount} warning(s) and is not a standardized legacy auth-hardening file.`,
    );
    for (const message of result.messages) {
      console.error(`  ${message.line}:${message.column} ${message.ruleId ?? "parser"} ${message.message}`);
    }
    failed = true;
    continue;
  }

  const inheritedText = baselineText(relativePath);
  if (inheritedText === null) {
    console.error(`FAIL auth-debt: ${relativePath} did not exist at portability baseline ${baseSha}.`);
    failed = true;
    continue;
  }

  const [baselineResult] = await eslint.lintText(inheritedText, { filePath: relativePath });
  const increases = newLintDebt(result, baselineResult);
  if (increases.length > 0) {
    console.error(`FAIL auth-debt: ${relativePath} introduces new lint debt:`);
    for (const increase of increases) console.error(`  ${increase}`);
    failed = true;
    continue;
  }

  console.log(
    `PASS inherited auth debt: ${relativePath} current=${result.errorCount}/${result.warningCount} baseline=${baselineResult.errorCount}/${baselineResult.warningCount}`,
  );
}

if (failed) process.exit(1);
console.log(`Strict portability lint gate passed for ${files.length} changed TypeScript file(s).`);
