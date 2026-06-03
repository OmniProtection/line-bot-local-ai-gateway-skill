const fs = require("fs");
const { EVIDENCE_ROOT, REQUIRED_EVIDENCE, evidencePath, skeleton } = require("./production-evidence-contract");

function hasFlag(name) {
  return process.argv.includes(name);
}

function main() {
  const force = hasFlag("--force");
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const results = [];

  for (const record of REQUIRED_EVIDENCE) {
    const filePath = evidencePath(record);
    const exists = fs.existsSync(filePath);
    if (exists && !force) {
      results.push({
        file: filePath,
        action: "kept",
        reason: "existing file preserved"
      });
      continue;
    }

    fs.writeFileSync(filePath, `${JSON.stringify(skeleton(record), null, 2)}\n`, "utf8");
    results.push({
      file: filePath,
      action: exists ? "overwritten" : "created"
    });
  }

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        force,
        records: results
      },
      null,
      2
    )
  );
}

main();
