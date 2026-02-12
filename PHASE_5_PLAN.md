# PHASE 5: Message Logger

**Date**: 2026-02-12
**Status**: Planning
**Version Target**: 0.5.0

---

## Overview

Add optional JSONL message logging, disabled by default. When the `SLACK_MESSAGE_LOG` environment variable is set to a file path, all outbound messages (via `postMessage` and `postReply`) are appended as one JSON object per line. Each entry includes timestamp, channel, agent identity, text, and delivery status. The logger never throws on write failure — it logs a warning to stderr instead.

**Goal**: Working message logger with JSONL output, no-op when disabled, wired into SlackClient, and full test coverage.

**Requirements Addressed**: R8 (Optional JSONL message logging)

**Success Criteria**:
1. When `SLACK_MESSAGE_LOG` is unset, no file is created and no overhead is incurred
2. When set, messages are appended as JSONL (one JSON object per line)
3. Each log entry contains: timestamp, channel, username (agent identity), text, thread_ts, slack_ts, delivered, error
4. Logger does not throw on write failure (logs warning to stderr instead)
5. All existing 51 tests still pass
6. New unit tests cover JSONL format, disabled state, write failure handling, and identity fields

---

## Dependency Graph

```
Wave 1: Foundation (single task — new file)
   +-- Task 1.1 (src/message-logger.ts) ──┐
                                           |
                                           v
Wave 2: Integration (single task — modifies src/slack-client.ts)
   +-- Task 2.1 (src/slack-client.ts mod)──┐
                                           |
                                           v
Wave 3: Tests (single task — new file)
   +-- Task 3.1 (tests/unit/message-logger.test.ts)
```

---

## Wave Structure

### Wave 1: Foundation — Message Logger Module

#### Task 1.1: Message Logger Module (`src/message-logger.ts`)

- **Description**: Create a `MessageLogger` class that writes JSONL entries to a file. When constructed with no path (or `undefined`), all methods are no-ops. When constructed with a file path, `log()` appends a JSON line. The class wraps `appendFileSync` in a try/catch, logging warnings to stderr on write failure rather than throwing.
- **Files**:
  - Creates: `src/message-logger.ts`
- **Dependencies**: None (Wave 1)
- **Context Needed**:
  - `docs/fork-spec.md` Section 4.6 (lines 708-728) — log entry shape and behavior
  - `docs/build-plan.md` Phase 5 — requirements and log rotation note
  - `src/types.ts` — for the `PostMessageOptions` interface (reference for field names)
  - `BUILD_GUIDE_PHASE_5.md` — unclear requirements and design decisions
- **Implementation Notes**:
  - Export `MessageLogger` class
  - Constructor: `constructor(logPath?: string)` — if `logPath` is undefined/empty, set an internal `enabled = false` flag
  - `log(entry: MessageLogEntry): void` — if not enabled, return immediately. Otherwise, `JSON.stringify(entry) + '\n'` and `appendFileSync(this.logPath, ...)`. Wrap in try/catch; on error, `console.error(...)`.
  - `MessageLogEntry` interface:
    ```typescript
    interface MessageLogEntry {
      timestamp: string;      // ISO 8601
      channel: string;        // channel ID
      username?: string;      // resolved agent display name
      icon_emoji?: string;    // agent icon
      text: string;           // message text
      thread_ts?: string;     // if reply
      slack_ts?: string;      // from API response
      delivered: boolean;     // response.ok
      error?: string;         // response.error on failure
    }
    ```
  - Export `MessageLogEntry` type from the module
  - Keep it simple: no buffering, no rotation, no async writes
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/message-logger.ts && echo "message-logger.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "export class MessageLogger" src/message-logger.ts && echo "MessageLogger exported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "appendFileSync" src/message-logger.ts && echo "appendFileSync used" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "MessageLogEntry" src/message-logger.ts && echo "MessageLogEntry defined" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build 2>&1 | tail -5
  ```
- **Done When**:
  1. `src/message-logger.ts` exists and exports `MessageLogger` class and `MessageLogEntry` interface
  2. Constructor accepts optional `logPath` string; if falsy, logger is disabled (no-op)
  3. `log(entry)` appends `JSON.stringify(entry) + '\n'` to the file when enabled
  4. `log(entry)` returns immediately when disabled (no file operations)
  5. Write failures are caught and logged to stderr via `console.error`
  6. `npm run build` compiles without errors

---

### Wave 2: Integration — Wire Logger into SlackClient

#### Task 2.1: Wire MessageLogger into SlackClient

- **Description**: Modify `SlackClient` to accept a `MessageLogger` instance in its constructor and call `logger.log()` after each `postMessage` call. The log entry captures the input options (channel, text, username, icon_emoji, thread_ts) and the result (delivered/slack_ts/error) from the API response.
- **Files**:
  - Modifies: `src/slack-client.ts`
  - Modifies: `src/index.ts` (pass logger to SlackClient constructor)
- **Dependencies**: Task 1.1 (message-logger.ts must exist)
- **Context Needed**:
  - `src/slack-client.ts` — current `postMessage()` implementation
  - `src/message-logger.ts` — `MessageLogger` API
  - `src/index.ts` — `main()` function where `SlackClient` is constructed
- **Implementation Notes**:
  - Add `private logger: MessageLogger` to `SlackClient`
  - Constructor: `constructor(botToken: string, logger?: MessageLogger)` — default to a disabled `MessageLogger` if not provided
  - In `postMessage()`, after the `apiCall()` returns, call:
    ```typescript
    this.logger.log({
      timestamp: new Date().toISOString(),
      channel: opts.channel_id,
      username: opts.username,
      icon_emoji: opts.icon_emoji,
      text: opts.text,
      thread_ts: opts.thread_ts,
      slack_ts: result.ts,
      delivered: result.ok === true,
      error: result.ok ? undefined : result.error,
    });
    ```
  - No changes to `postReply` — it delegates to `postMessage`, so logging happens automatically
  - In `src/index.ts` `main()`: create `MessageLogger` from `process.env.SLACK_MESSAGE_LOG`, pass to `SlackClient` constructor:
    ```typescript
    import { MessageLogger } from "./message-logger.js";
    const logger = new MessageLogger(process.env.SLACK_MESSAGE_LOG);
    const slackClient = new SlackClient(botToken, logger);
    ```
  - If `SLACK_MESSAGE_LOG` is set, log a startup message: `console.error(\`Message logging enabled: ${process.env.SLACK_MESSAGE_LOG}\`);`
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "MessageLogger" src/slack-client.ts && echo "MessageLogger imported in slack-client" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "this.logger.log" src/slack-client.ts && echo "logger.log called in postMessage" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "MessageLogger" src/index.ts && echo "MessageLogger imported in index" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "SLACK_MESSAGE_LOG" src/index.ts && echo "SLACK_MESSAGE_LOG env var read" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build 2>&1 | tail -5
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm test 2>&1 | tail -15
  ```
- **Done When**:
  1. `SlackClient` constructor accepts optional `MessageLogger` parameter
  2. `postMessage()` calls `this.logger.log()` after API call with correct fields
  3. Existing 51 tests still pass (SlackClient tests create client without logger, so the default no-op logger is used)
  4. `src/index.ts` creates `MessageLogger` from `SLACK_MESSAGE_LOG` env var and passes to `SlackClient`
  5. Startup message logged when `SLACK_MESSAGE_LOG` is set
  6. `npm run build` compiles without errors

---

### Wave 3: Tests

#### Task 3.1: Message Logger Unit Tests (`tests/unit/message-logger.test.ts`)

- **Description**: Create unit tests for `MessageLogger`. Cover: disabled state (no file created), JSONL format (correct JSON per line), write failure handling (logs warning, does not throw), identity fields included in log entries. Use `vi.mock('node:fs')` to mock `appendFileSync`.
- **Files**:
  - Creates: `tests/unit/message-logger.test.ts`
- **Dependencies**: Task 1.1 (message-logger.ts), Task 2.1 (integration complete)
- **Context Needed**:
  - `src/message-logger.ts` — class to test
  - `tests/unit/slack-client.test.ts` — existing test patterns (import style, mock patterns)
  - `tests/unit/identity.test.ts` — existing test patterns
- **Implementation Notes**:
  - Import `{ describe, it, expect, vi, beforeEach, afterEach }` from `'vitest'`
  - Mock `node:fs` module: `vi.mock('node:fs', () => ({ appendFileSync: vi.fn() }))`
  - Test cases:
    1. **Disabled logger**: `new MessageLogger()` — calling `log()` does not call `appendFileSync`
    2. **Disabled logger with empty string**: `new MessageLogger('')` — same as above
    3. **Enabled logger writes JSONL**: `new MessageLogger('/tmp/test.jsonl')` — calling `log(entry)` calls `appendFileSync` with the path and `JSON.stringify(entry) + '\n'`
    4. **Log entry format**: Verify the written string is valid JSON and contains expected fields
    5. **Write failure does not throw**: Mock `appendFileSync` to throw, verify `log()` does not throw, verify `console.error` is called
    6. **Identity fields included**: Log entry with `username` and `icon_emoji` — verify they appear in the JSONL output
    7. **Delivery success**: Entry with `delivered: true` and `slack_ts` set
    8. **Delivery failure**: Entry with `delivered: false` and `error` set
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f tests/unit/message-logger.test.ts && echo "message-logger test file exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "MessageLogger" tests/unit/message-logger.test.ts && echo "MessageLogger tested" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npx vitest run tests/unit/message-logger.test.ts 2>&1 | tail -10
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm test 2>&1 | tail -15
  ```
- **Done When**:
  1. `tests/unit/message-logger.test.ts` exists with Vitest imports
  2. Test: disabled logger (no path) does not call `appendFileSync`
  3. Test: disabled logger (empty string) does not call `appendFileSync`
  4. Test: enabled logger calls `appendFileSync` with correct path and JSONL content
  5. Test: written content is valid JSON with expected fields (timestamp, channel, text, delivered)
  6. Test: write failure caught — `log()` does not throw, `console.error` is called
  7. Test: identity fields (username, icon_emoji) appear in output
  8. Test: delivery success entry has `delivered: true` and `slack_ts`
  9. Test: delivery failure entry has `delivered: false` and `error`
  10. All message-logger tests pass
  11. All 51 existing tests still pass
  12. Full test suite runs clean

---

## Parallelization Map

| Wave | Tasks | Parallel? | Justification |
|------|-------|-----------|---------------|
| 1 | 1.1 | N/A | Single task |
| 2 | 2.1 | N/A | Single task |
| 3 | 3.1 | N/A | Single task |

---

## File Ownership Guarantee

| File | Owner Task | Access |
|------|-----------|--------|
| `src/message-logger.ts` | 1.1 | Write (create) |
| `src/slack-client.ts` | 2.1 | Write (modify) |
| `src/index.ts` | 2.1 | Write (modify) |
| `tests/unit/message-logger.test.ts` | 3.1 | Write (create) |
| `src/message-logger.ts` | 3.1 | Read only |
| `src/slack-client.ts` | 3.1 | Read only |

**Conflict check**: No two parallel tasks write to the same file. PASS.

---

## Test Plan

| Test File | Tasks Covered | Expected Tests |
|-----------|---------------|----------------|
| `tests/unit/message-logger.test.ts` | 3.1 | ~8 (disabled no-path, disabled empty, enabled writes, JSONL format, write failure, identity fields, delivery success, delivery failure) |
| `tests/unit/slack-client.test.ts` | (existing) | 13 (unaffected — client constructed without logger) |
| `tests/unit/identity.test.ts` | (existing) | 13 (unaffected) |
| `tests/unit/rate-limiter.test.ts` | (existing) | 6 (unaffected) |
| `tests/unit/network.test.ts` | (existing) | 5 (unaffected) |
| `tests/unit/tools.test.ts` | (existing) | 14 (unaffected) |

**Existing**: 51 tests
**New**: ~8
**Total after phase**: ~59

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Existing `slack-client.test.ts` tests break because `SlackClient` constructor signature changed (new `logger` param) | Low | High | The `logger` param is optional with a default no-op instance. Existing tests that create `new SlackClient('token')` continue to work unchanged. |
| `appendFileSync` mock in message-logger tests leaks into other test files | Low | Medium | Vitest runs each test file in isolation. The `vi.mock('node:fs')` is scoped to the file. Use `beforeEach`/`afterEach` to reset mocks. |

---

## Git Checkpoints

| Wave | Commit Message |
|------|----------------|
| 1 | `feat(phase-5-w1): add MessageLogger class with JSONL output` |
| 2 | `feat(phase-5-w2): wire MessageLogger into SlackClient and entry point` |
| 3 | `test(phase-5-w3): add message logger unit tests` |

---

## Verification Commands

```bash
# Wave 1 verification (structure check + build)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/message-logger.ts && npm run build 2>&1 | tail -5

# Wave 2 verification (build + existing tests)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build && npm test

# Wave 3 verification (all tests including new)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm test

# Full regression
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build && npm test
```

---

## Skill Decision Log

| ID | Decision | Rationale | Phase |
|----|----------|-----------|-------|
| | | | |

---

## Issues Log

| ID | Issue | Status | Resolution |
|----|-------|--------|------------|
| | | | |

---

## Phase Completion Checklist

- [ ] All tasks complete with "Done When" verified
- [ ] All smoke tests pass
- [ ] `npm run build` compiles without errors
- [ ] `npm test` passes all unit tests (~59 total)
- [ ] `MessageLogger` class exists with no-op when disabled
- [ ] `MessageLogger.log()` writes valid JSONL
- [ ] Write failures caught and logged to stderr (not thrown)
- [ ] `SlackClient.postMessage()` calls `logger.log()` after API call
- [ ] `src/index.ts` creates `MessageLogger` from `SLACK_MESSAGE_LOG` env var
- [ ] No file created when `SLACK_MESSAGE_LOG` is unset
- [ ] Log entries include: timestamp, channel, username, text, delivered, slack_ts, error
- [ ] All existing 51 tests still pass
- [ ] Git commits per wave complete
