import fs from "node:fs";

const [reportPath, maxErrorsRaw, maxWarningsRaw] = process.argv.slice(2);
if (!reportPath || !maxErrorsRaw || !maxWarningsRaw) {
  console.error("usage: check-lint-baseline.mjs <report.json> <max-errors> <max-warnings>");
  process.exit(2);
}

const maxErrors = Number(maxErrorsRaw);
const maxWarnings = Number(maxWarningsRaw);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

let errors = 0;
let warnings = 0;
for (const file of report) {
  errors += Number(file.errorCount ?? 0);
  warnings += Number(file.warningCount ?? 0);
}

console.log(`Legacy lint debt: ${errors} errors, ${warnings} warnings`);
console.log(`Allowed baseline: <= ${maxErrors} errors, <= ${maxWarnings} warnings`);

if (errors > maxErrors || warnings > maxWarnings) {
  console.error("Lint debt increased. New code must not worsen the legacy baseline.");
  process.exit(1);
}

console.log("Lint debt ratchet passed.");
