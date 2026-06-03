const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(PROJECT_ROOT, "data", "linebot-memory.sqlite");
const BACKUP_ROOT = path.join(PROJECT_ROOT, "backups", "linebot-memory");

function hasFlag(name) {
  return process.argv.includes(name);
}

function timestampForPath() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const input = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function assertInsideProject(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.toLowerCase().startsWith(PROJECT_ROOT.toLowerCase() + path.sep.toLowerCase())) {
    throw new Error(`Refusing to write outside project root: ${resolved}`);
  }
}

function inspectDatabase() {
  const db = new Database(SOURCE_DB, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    return { integrity, tables };
  } finally {
    db.close();
  }
}

async function buildManifest(mode, backupDbPath = null) {
  const sourceStat = fs.statSync(SOURCE_DB);
  const inspection = inspectDatabase();
  const manifest = {
    status: "PASS",
    mode,
    created_at: new Date().toISOString(),
    source_db: SOURCE_DB,
    source_size_bytes: sourceStat.size,
    source_sha256: await sha256File(SOURCE_DB),
    backup_db: backupDbPath,
    sqlite_integrity_check: inspection.integrity,
    table_count: inspection.tables.length,
    tables: inspection.tables,
    env_file_included: false,
    secrets_included: false
  };

  if (backupDbPath) {
    const backupStat = fs.statSync(backupDbPath);
    manifest.backup_size_bytes = backupStat.size;
    manifest.backup_sha256 = await sha256File(backupDbPath);
  }

  return manifest;
}

function executeBackup(backupDbPath) {
  assertInsideProject(backupDbPath);
  fs.mkdirSync(path.dirname(backupDbPath), { recursive: true });
  const db = new Database(SOURCE_DB, { readonly: true, fileMustExist: true });
  try {
    db.prepare("VACUUM INTO ?").run(backupDbPath);
  } finally {
    db.close();
  }
}

async function main() {
  if (!fs.existsSync(SOURCE_DB)) {
    throw new Error(`SQLite memory DB not found: ${SOURCE_DB}`);
  }

  const execute = hasFlag("--execute");
  const dryRun = hasFlag("--dry-run") || !execute;
  const backupDir = path.join(BACKUP_ROOT, timestampForPath());
  const backupDbPath = path.join(backupDir, "linebot-memory.sqlite");
  const manifestPath = path.join(backupDir, "backup-manifest.json");

  if (dryRun) {
    const manifest = await buildManifest("dry-run");
    manifest.planned_backup_db = backupDbPath;
    manifest.planned_manifest = manifestPath;
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  executeBackup(backupDbPath);
  const manifest = await buildManifest("execute", backupDbPath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
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
