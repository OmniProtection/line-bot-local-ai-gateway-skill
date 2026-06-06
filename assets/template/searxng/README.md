# SearXNG MCP Experimental Package

This directory is an experimental local-search diagnostic package for the LINE Bot project.

Current boundary:

- It is not part of the production LINE Bot runtime.
- It does not change the existing production web-search behavior.
- It is intended for local SearXNG + MCP compatibility testing and diagnostics only.
- `docker-compose.searxng.yml` binds SearXNG to `127.0.0.1:8080`.
- `scripts/mcp-searxng-server.js` exposes a bounded `web_search` MCP tool over stdio for local tests.

Validation used during the 2026-06-05 stage closeout:

- `node --check scripts/diagnose-lmstudio-mcp-searxng.js`
- `node --check scripts/diagnose-lmstudio-tool-web-search.js`
- `node --check scripts/mcp-searxng-server.js`
- `node scripts/test-mcp-searxng-server.js`

Do not wire this package into production runtime without a separate ticket, acceptance criteria, evidence, and approval gate.
