const { scanEvidenceSecrets } = require("./production-evidence-contract");

function main() {
  const summary = scanEvidenceSecrets();
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.status === "PASS" ? 0 : 2;
}

main();
