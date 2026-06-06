const path = require("path");
const { execFile } = require("child_process");
const { evidenceStatus, scanEvidenceSecrets } = require("./production-evidence-contract");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PRODUCTIONIZATION_ROOT = path.join(
  PROJECT_ROOT,
  "docs",
  "maintenance",
  "GO-LINEBOT-PRODUCTIONIZATION-001"
);
function runReadinessAudit() {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(PROJECT_ROOT, "scripts", "production-readiness-audit.js")],
      { cwd: PROJECT_ROOT, windowsHide: true },
      (error, stdout, stderr) => {
        let parsed = null;
        try {
          parsed = stdout ? JSON.parse(stdout) : null;
        } catch {
          parsed = null;
        }
        resolve({
          code: error?.code || 0,
          parsed,
          stderr: String(stderr || "")
        });
      }
    );
  });
}

async function main() {
  const readiness = await runReadinessAudit();
  const evidence = evidenceStatus();
  const secretAudit = scanEvidenceSecrets();
  const failed = evidence.filter((item) => item.status === "FAIL");
  const blocked = evidence.filter((item) => item.status !== "PASS");
  const readinessPass = readiness.parsed?.status === "PASS" && readiness.parsed?.production_ready === true;
  const status =
    failed.length > 0 || secretAudit.status === "FAIL"
      ? "FAIL"
      : readinessPass && blocked.length === 0 && secretAudit.status === "PASS"
        ? "PASS"
        : "BLOCKED";

  const summary = {
    status,
    checked_at: new Date().toISOString(),
    production_ready: status === "PASS",
    readiness_status: readiness.parsed?.status || "FAIL",
    readiness_production_ready: readiness.parsed?.production_ready === true,
    evidence_pass: evidence.filter((item) => item.status === "PASS").length,
    evidence_required: evidence.length,
    evidence_secret_audit_status: secretAudit.status,
    evidence_secret_findings_count: secretAudit.findings_count,
    evidence,
    evidence_secret_audit: secretAudit,
    blocker_summary: [
      ...(readinessPass
        ? []
        : [
            {
              id: "readiness",
              status: "BLOCKED",
              reason: "npm run prod:readiness has not returned PASS."
            }
          ]),
      ...blocked.map((item) => ({
        id: item.id,
        status: item.status,
        reason: item.purpose,
        file: item.file
      })),
      ...(secretAudit.status === "PASS"
        ? []
        : [
            {
              id: "evidence-secret-audit",
              status: "FAIL",
              reason: "Final evidence records contain secret-like content.",
              findings_count: secretAudit.findings_count
            }
          ])
    ]
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = status === "PASS" ? 0 : status === "FAIL" ? 2 : 3;
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "FAIL",
        error_class: error?.name || "Error",
        error_message: error?.message || String(error)
      },
      null,
      2
    )
  );
  process.exitCode = 2;
});
