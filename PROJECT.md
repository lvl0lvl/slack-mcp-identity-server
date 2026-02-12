# slack-mcp-identity-server

MCP server for Slack with per-message agent identity switching, priority-based rate limiting, and message logging. Fork of zencoderai/slack-mcp-server.

## Stack
- TypeScript (ES2022, Node16 module resolution)
- MCP SDK (@modelcontextprotocol/sdk 1.15.1, pinned without caret)
- Vitest for testing (not Jest -- upstream uses `vi.spyOn` patterns)
- Node.js >= 20

## Build Commands
- `npm run build` — TypeScript compilation (tsc)
- `npm test` — Unit tests (vitest run)
- `npm run lint` — Type checking (tsc --noEmit)

## Key References
- `docs/build-plan.md` — 7-phase build plan with implementation details, dependency ordering, and checklist
- `docs/fork-spec.md` — Full technical specification (1,696 lines) with complete TypeScript implementations for all components
- `ROADMAP.md` — GO Build stage definitions
- `REQUIREMENTS.md` — Traceability matrix for Phase H verification
