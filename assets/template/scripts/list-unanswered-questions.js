const { createKnowledgeBaseStore } = require("../src/knowledgeBaseStore");

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg === "--all") {
      args.all = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

function listUnanswered({ dbPath = undefined, limit = 50, includeResolved = false } = {}) {
  const store = createKnowledgeBaseStore(dbPath);
  try {
    return {
      status: "PASS",
      unresolvedOnly: includeResolved !== true,
      questions: store.listUnansweredQuestions({
        limit,
        includeResolved
      })
    };
  } finally {
    store.close();
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  const result = listUnanswered({
    dbPath: args.db,
    limit: args.limit ? Number(args.limit) : 50,
    includeResolved: args.all === true
  });
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  listUnanswered
};
