function shouldUseDirectModelReply(text, config) {
  if (!config?.generalDirectReplyEnabled) {
    return false;
  }

  const normalized = String(text || "").trim();
  if (!normalized) {
    return false;
  }

  const maxChars = Number.isFinite(config.generalDirectReplyMaxInputChars)
    ? config.generalDirectReplyMaxInputChars
    : 20;
  return normalized.length <= maxChars;
}

module.exports = {
  shouldUseDirectModelReply
};
