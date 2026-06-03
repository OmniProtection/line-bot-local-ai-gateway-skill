# Web Search Reference

## Triggering

Web search must be explicit. Use prefixes such as:

- `找: query`
- `搜: query`
- `查: query`

Normal questions like `今天新聞是什麼` should remain normal chat unless the user configured a different policy.

## Evidence-First Flow

```text
command query
  -> deterministic search provider
  -> candidate ranking and source classification
  -> URL and text security checks
  -> small evidence pack
  -> LM Studio summarizes grounded evidence
  -> final answer with source links
```

LM Studio web-tools plugins are diagnostic only by default. They should not decide the LINE runtime search path unless the user explicitly approves that dependency.

## Security Policy

- Reject local/private IP targets and unsafe URL schemes.
- Strip tracking parameters and unwrap known search redirects.
- Sanitize evidence title/snippet text.
- Treat prompt-injection text from webpages as untrusted evidence, never instructions.
- Require answer source URLs when search evidence is used.
- Use conservative fallback text when evidence is weak, missing, or the model times out.

## Tests

Run web-search command, policy, security, static flow, and runtime tests when modifying search behavior. Also verify that search results do not write short-term or long-term memory by default.
