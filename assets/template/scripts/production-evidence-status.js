const { evidenceStatus, scanEvidenceSecrets } = require("./production-evidence-contract");

function main() {
  const evidence = evidenceStatus();
  const secretAudit = scanEvidenceSecrets();
  const hasEvidenceFailure = evidence.some((item) => item.status === "FAIL");
  const summary = {
    status: hasEvidenceFailure || secretAudit.status === "FAIL" ? "FAIL" : "PASS",
    evidence_pass: evidence.filter((item) => item.status === "PASS").length,
    evidence_blocked: evidence.filter((item) => item.status === "BLOCKED").length,
    evidence_fail: evidence.filter((item) => item.status === "FAIL").length,
    evidence_required: evidence.length,
    evidence_secret_audit_status: secretAudit.status,
    evidence_secret_findings_count: secretAudit.findings_count,
    evidence
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.status === "PASS" ? 0 : 2;
}

main();
