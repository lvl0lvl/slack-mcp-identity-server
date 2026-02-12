# PHASE 6: Dual-Token Support for Search

**Date**: 2026-02-12
**Status**: Planning
**Version Target**: 0.6.0

---

## Overview

Wire `SLACK_USER_TOKEN` env var support for the `slack_search_messages` tool. The functional implementation was largely completed in Phases 4-5 (DD-013). Phase 6 adds `searchMessages` tests to `slack-client.test.ts` for completeness and confirms all validation criteria are met.

**Goal**: Verified dual-token support with full test coverage for search token routing.

**Requirements Addressed**: R9 (Dual-Token Support)

**Success Criteria**:
1. `SlackClient.searchMessages()` uses user token when provided
2. `searchMessages()` returns clear error when no user token is configured
3. Bot token is never used for search API calls
4. `slack-client.test.ts` has searchMessages tests (parity with tools.test.ts coverage)
5. All existing 59 tests still pass
6. New tests bring total to ~63

---

## Dependency Graph

```
Wave 1: Tests (single task -- add searchMessages tests to slack-client.test.ts)
   +-- Task 1.1 (tests/unit/slack-client.test.ts mod) --+
                                                         |
                                                         v
                                                     DONE
```

---

## Wave Structure

### Wave 1: Add searchMessages Tests to slack-client.test.ts

#### Task 1.1: searchMessages Test Coverage

- **Description**: Add a `describe("searchMessages", ...)` block to `tests/unit/slack-client.test.ts` with tests covering: (1) returns error when no userToken provided, (2) uses user token in Authorization header (not bot token), (3) sends correct query params, (4) caps count at 100. These mirror the existing tests in `tools.test.ts` but test the `SlackClient` method directly, matching the testing pattern of all other SlackClient methods in this file.
- **Files**:
  - Modifies: `tests/unit/slack-client.test.ts`
- **Dependencies**: None (Wave 1)
- **Context Needed**:
  - `src/slack-client.ts` -- `searchMessages()` method signature and implementation
  - `tests/unit/slack-client.test.ts` -- existing test patterns, `mockFetch`/`mockResponse` helpers
  - `tests/unit/tools.test.ts` -- existing searchMessages tests (lines 253-298) for reference
- **Implementation Notes**:
  - Add a new `describe("searchMessages", () => { ... })` block at the end of the existing `describe("SlackClient", ...)` block
  - Test 1: `searchMessages("query")` with no userToken returns `{ ok: false, error: "user_token_required" }` and does NOT call fetch
  - Test 2: `searchMessages("query", "timestamp", "desc", 20, "xoxp-test-user")` calls fetch with `Authorization: "Bearer xoxp-test-user"` (not `xoxb-test-token`)
  - Test 3: `searchMessages("query", "score", "asc", 50, "xoxp-test-user")` sends correct URL params (`sort=score`, `sort_dir=asc`, `count=50`, `query=query`)
  - Test 4: `searchMessages("query", "timestamp", "desc", 200, "xoxp-test-user")` caps count at 100 in URL params
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "searchMessages" tests/unit/slack-client.test.ts && echo "searchMessages tests exist" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npx vitest run tests/unit/slack-client.test.ts 2>&1 | tail -15
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm test 2>&1 | tail -15
  ```
- **Done When**:
  1. `tests/unit/slack-client.test.ts` contains a `describe("searchMessages", ...)` block
  2. Test: no userToken returns error object without calling fetch
  3. Test: user token used in Authorization header (not bot token)
  4. Test: correct query params in URL (sort, sort_dir, count, query)
  5. Test: count capped at 100
  6. All new tests pass
  7. All existing 59 tests still pass
  8. `npm run build` compiles without errors

---

## Parallelization Map

| Wave | Tasks | Parallel? | Justification |
|------|-------|-----------|---------------|
| 1 | 1.1 | N/A | Single task |

---

## File Ownership Guarantee

| File | Owner Task | Access |
|------|-----------|--------|
| `tests/unit/slack-client.test.ts` | 1.1 | Write (modify) |
| `src/slack-client.ts` | 1.1 | Read only |

**Conflict check**: Single task, no conflicts. PASS.

---

## Test Plan

| Test File | Tasks Covered | Expected Tests |
|-----------|---------------|----------------|
| `tests/unit/slack-client.test.ts` | 1.1 | 17 (existing 13 + 4 new searchMessages) |
| `tests/unit/tools.test.ts` | (existing) | 14 (unaffected) |
| `tests/unit/identity.test.ts` | (existing) | 13 (unaffected) |
| `tests/unit/rate-limiter.test.ts` | (existing) | 6 (unaffected) |
| `tests/unit/network.test.ts` | (existing) | 5 (unaffected) |
| `tests/unit/message-logger.test.ts` | (existing) | 8 (unaffected) |

**Existing**: 59 tests
**New**: 4
**Total after phase**: 63

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| searchMessages mock setup conflicts with existing mockFetch | Low | Low | Each test resets mockFetch in `beforeEach`. New tests use the same pattern. |
| Rate limiter internal state leaks between tests | Low | Low | Tests are isolated; SlackClient creates a fresh rate limiter per instance. |

---

## Git Checkpoints

| Wave | Commit Message |
|------|----------------|
| 1 | `test(phase-6-w1): add searchMessages tests to slack-client.test.ts` |

---

## Verification Commands

```bash
# Wave 1 verification (build + all tests)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build && npm test

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

- [ ] Task 1.1 complete with "Done When" verified
- [ ] All smoke tests pass
- [ ] `npm run build` compiles without errors
- [ ] `npm test` passes all unit tests (~63 total)
- [ ] `searchMessages()` uses user token when provided (verified by test)
- [ ] `searchMessages()` returns clear error when no user token (verified by test)
- [ ] Bot token never used for search (verified by test)
- [ ] All existing 59 tests still pass
- [ ] Git commit for wave complete
