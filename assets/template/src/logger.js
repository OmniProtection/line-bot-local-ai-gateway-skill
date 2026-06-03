function logEvent(event, fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...fields
  };

  console.log(JSON.stringify(entry));
}

function errorClass(error) {
  if (error?.name === "AbortError") {
    return "timeout";
  }

  const code = error?.code || error?.cause?.code;
  if (code === "ECONNREFUSED") {
    return "connection_refused";
  }

  return error?.name || "unknown_error";
}

module.exports = {
  errorClass,
  logEvent
};
