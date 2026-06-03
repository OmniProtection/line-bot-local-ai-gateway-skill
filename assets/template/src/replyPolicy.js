const LINE_TEXT_SAFE_HARD_LIMIT = 4500;

function effectiveMaxReplyChars(maxChars) {
  const configured = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : LINE_TEXT_SAFE_HARD_LIMIT;
  return Math.min(configured, LINE_TEXT_SAFE_HARD_LIMIT);
}

function clampReply(text, maxChars) {
  const normalized = String(text || "").trim();
  const limit = effectiveMaxReplyChars(maxChars);

  if (!normalized) {
    return "Sorry, I cannot answer right now. Please try again later.";
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function shouldHandleEvent(event) {
  return event.type === "message" && event.message?.type === "text" && Boolean(event.replyToken);
}

function unsupportedReply(maxChars) {
  return clampReply("Please send a text message.", maxChars);
}

module.exports = {
  clampReply,
  effectiveMaxReplyChars,
  LINE_TEXT_SAFE_HARD_LIMIT,
  shouldHandleEvent,
  unsupportedReply
};
