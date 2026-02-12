# PHASE 3: Rate Limiter + Network Retry

**Date**: 2026-02-12
**Status**: Planning
**Version Target**: 0.3.0

---

## Overview

Add a priority-based rate limiter with per-method tracking and 429 handling, plus `fetchWithRetry()` for network failure resilience. The call chain is: `rateLimiter.enqueue(method, () => fetchWithRetry(url, opts))` — network retries stay within the same rate limit slot.

**Goal**: Working rate limiter with priority queue, per-method token bucket, 429/Retry-After handling, exponential backoff for 5xx/network errors, full wiring into SlackClient, priority parameter on message tools, and test coverage.

**Requirements Addressed**: R5 (priority-based rate limiter), R6 (fetchWithRetry network resilience)

**Success Criteria**:
1. Rate limiter enforces per-method limits (requests above limit are queued, not rejected)
2. Priority 0 messages dequeue before priority 3
3. On 429 response, limiter reads `Retry-After` header and pauses that method
4. `fetchWithRetry` retries on 5xx with exponential backoff
5. `fetchWithRetry` does NOT retry on 4xx (except 429 which is handled by rate limiter)
6. The wiring is correct: `fetchWithRetry` runs INSIDE `rateLimiter.enqueue()`, not wrapping it
7. All unit tests pass

---

## Dependency Graph

```
Wave 1: Foundation (parallel — no shared writes)
   +-- Task 1.1 (src/rate-limiter.ts) ──────┐
   +-- Task 1.2 (src/network.ts) ────────────┘
                                             |
                                             v
Wave 2: Integration (single task — modifies src/slack-client.ts)
   +-- Task 2.1 (src/slack-client.ts mods) ──┐
                                             |
                                             v
Wave 3: Tool Updates + Tests (parallel — no shared writes)
   +-- Task 3.1 (src/tools/messages.ts mods) ┐
   +-- Task 3.2 (tests/unit/rate-limiter.test.ts)
   +-- Task 3.3 (tests/unit/network.test.ts) ┘
```

---

## Wave Structure

### Wave 1: Foundation — Rate Limiter + Network Retry Modules

#### Task 1.1: Rate Limiter Module (`src/rate-limiter.ts`)

- **Description**: Create `SlackRateLimiter` class with per-method token bucket tracking, priority queue (0=highest), 429 handling with `Retry-After` via `_retryAfter` propagation on response objects, queue delay warning logging to stderr. The `enqueue()` method accepts a method name, an execute callback, and optional priority (default 2). The queue is sorted by priority then enqueue time. `processQueue()` checks per-method rate windows before executing, sleeps on 429 `retryAfter`, and re-enqueues rate-limited requests.
- **Files**:
  - Creates: `src/rate-limiter.ts`
- **Dependencies**: None (Wave 1)
- **Context Needed**:
  - `docs/fork-spec.md` Section 4.2 (lines 493-628) — full `SlackRateLimiter` implementation
  - `docs/fork-spec.md` Section 4.3 (lines 631-643) — priority levels
  - `docs/fork-spec.md` Section 4.4 (lines 646-660) — 429 response handling
  - `docs/fork-spec.md` Section 4.7 (lines 733-752) — queue delay warning
  - `BUILD_GUIDE_PHASE_3.md` — design decisions and unclear requirements
- **Implementation Notes**:
  - `METHOD_LIMITS` map with perMinute rates per Slack API method (see fork-spec Section 4.1)
  - `enqueue<T>(method, execute, priority?, channelId?)` returns `Promise<T>`
  - `processQueue()` is async, guarded by `this.processing` flag to prevent re-entrancy
  - 429 detection: check `result.ok === false && result.error === 'ratelimited'` on the parsed response, read `_retryAfter` field (attached by fetchWithRetry)
  - Queue delay warning: log to stderr when queue wait exceeds 10 seconds (not returned as tool content)
  - Export the class as default and named export
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/rate-limiter.ts && echo "rate-limiter.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "export class SlackRateLimiter" src/rate-limiter.ts && echo "SlackRateLimiter exported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "async enqueue" src/rate-limiter.ts && echo "enqueue method exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "processQueue" src/rate-limiter.ts && echo "processQueue exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "METHOD_LIMITS" src/rate-limiter.ts && echo "METHOD_LIMITS defined" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "retryAfter" src/rate-limiter.ts && echo "retryAfter handling present" || exit 1
  ```
- **Done When**:
  1. `src/rate-limiter.ts` exists and exports `SlackRateLimiter` class
  2. `METHOD_LIMITS` contains per-method rate limits matching fork-spec Section 4.1 (16 methods)
  3. `enqueue<T>(method, execute, priority?, channelId?)` returns `Promise<T>` and adds to priority-sorted queue
  4. `processQueue()` respects per-method token bucket windows (60-second sliding window)
  5. `processQueue()` sleeps when `retryAfter` timestamp is in the future
  6. On 429 response (`result.ok === false, result.error === 'ratelimited'`), reads `result._retryAfter`, sets `retryAfter` timestamp, re-enqueues at front
  7. Queue items sorted by priority (ascending) then by `enqueuedAt` (ascending)
  8. Logs queue delay warning to stderr when item wait exceeds 10 seconds
  9. File compiles without errors when imported

---

#### Task 1.2: Network Retry Module (`src/network.ts`)

- **Description**: Create `fetchWithRetry()` function that wraps `fetch()` with exponential backoff for 5xx responses and network errors (DNS, TCP timeout). Does NOT retry on 4xx responses (including 429 — that is handled by the rate limiter). Returns the `Response` object on success. After parsing JSON in the caller, the caller should attach the `Retry-After` header value as `_retryAfter` on the parsed response for the rate limiter to consume.
- **Files**:
  - Creates: `src/network.ts`
- **Dependencies**: None (Wave 1)
- **Context Needed**:
  - `docs/fork-spec.md` Section 4.5 (lines 661-696) — full `fetchWithRetry` implementation
  - `BUILD_GUIDE_PHASE_3.md` — `_retryAfter` propagation design
- **Implementation Notes**:
  - `fetchWithRetry(url: string, options: RequestInit, maxRetries?: number): Promise<Response>`
  - Default `maxRetries = 3` (not 5 — keep it practical for MCP tool latency)
  - Backoff: `Math.min(1000 * Math.pow(2, attempt), 30_000)` — 1s, 2s, 4s, capped at 30s
  - On 5xx: create Error, log to stderr, sleep, continue
  - On network error (catch block): same treatment as 5xx
  - On 4xx: return response immediately (no retry)
  - On 2xx: return response immediately
  - After all retries exhausted: throw Error with message including attempt count and last error
  - Export as named export
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f src/network.ts && echo "network.ts exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "export async function fetchWithRetry" src/network.ts && echo "fetchWithRetry exported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "maxRetries" src/network.ts && echo "maxRetries param found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "Math.pow" src/network.ts && echo "exponential backoff present" || exit 1
  ```
- **Done When**:
  1. `src/network.ts` exists and exports `fetchWithRetry(url, options, maxRetries?)`
  2. Returns `Response` object on 2xx or 4xx (no retry for 4xx)
  3. Retries on 5xx with exponential backoff (1s, 2s, 4s... capped at 30s)
  4. Retries on network errors (fetch throws) with same backoff
  5. Logs each retry attempt to stderr with attempt number and error message
  6. Throws after all retries exhausted with descriptive error
  7. File compiles without errors when imported

---

### Wave 2: Integration — Wire into SlackClient

#### Task 2.1: Wire Rate Limiter + fetchWithRetry into SlackClient

- **Description**: Modify `SlackClient` to create a `SlackRateLimiter` instance in the constructor. Replace every raw `fetch()` call with `rateLimiter.enqueue(method, () => fetchWithRetry(url, opts))`. For each API method, identify the correct Slack API method name for rate limiting (e.g., `getChannels` uses `'conversations.list'`, `postMessage` uses `'chat.postMessage'`). After getting a response from `fetchWithRetry`, parse JSON and attach `Retry-After` header value as `_retryAfter` before returning. This allows the rate limiter to detect 429 responses and back off.
- **Files**:
  - Modifies: `src/slack-client.ts`
- **Dependencies**: Task 1.1 (rate-limiter.ts), Task 1.2 (network.ts)
- **Context Needed**:
  - `src/slack-client.ts` — current implementation (all methods use raw `fetch()`)
  - `src/rate-limiter.ts` — `SlackRateLimiter.enqueue()` API
  - `src/network.ts` — `fetchWithRetry()` API
  - `docs/fork-spec.md` Section 4.1 — method-to-tier mapping
  - `docs/build-plan.md` Phase 3, step 3 — wiring order
- **Implementation Notes**:
  - Add `private rateLimiter: SlackRateLimiter` to class, instantiate in constructor
  - Create a private helper method: `private async apiCall(method: string, url: string, options: RequestInit): Promise<any>` that:
    1. Calls `this.rateLimiter.enqueue(method, async () => { ... })`
    2. Inside the callback: calls `fetchWithRetry(url, options)`
    3. Parses `response.json()`
    4. Reads `response.headers.get('Retry-After')` and attaches as `result._retryAfter` if present
    5. Returns the parsed result
  - Replace each method's `fetch()` + `response.json()` with `this.apiCall(slackMethod, url, opts)`
  - Method name mapping:
    - `authTest` → `'auth.test'`
    - `getChannels` → `'conversations.list'` (or `'conversations.info'` for predefined IDs)
    - `postMessage` → `'chat.postMessage'`
    - `addReaction` → `'reactions.add'`
    - `getChannelHistory` → `'conversations.history'`
    - `getThreadReplies` → `'conversations.replies'`
    - `getUsers` → `'users.list'`
    - `getUserProfile` → `'users.profile.get'`
  - `postMessage` should accept an optional `priority` parameter and pass it to `enqueue`
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "SlackRateLimiter" src/slack-client.ts && echo "SlackRateLimiter imported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "fetchWithRetry" src/slack-client.ts && echo "fetchWithRetry imported" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "rateLimiter" src/slack-client.ts && echo "rateLimiter instance found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "enqueue" src/slack-client.ts && echo "enqueue called" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build 2>&1 | tail -5
  ```
- **Done When**:
  1. `SlackClient` imports `SlackRateLimiter` from `./rate-limiter.js` and `fetchWithRetry` from `./network.js`
  2. Constructor creates `new SlackRateLimiter()` and stores as `this.rateLimiter`
  3. Private `apiCall(method, url, options, priority?)` method encapsulates the enqueue + fetchWithRetry + JSON parse + `_retryAfter` attachment pattern
  4. All 8 existing API methods use `this.apiCall()` instead of raw `fetch()`
  5. Each method passes the correct Slack API method name string
  6. `postMessage` accepts optional `priority` parameter and passes it through to `apiCall`
  7. `Retry-After` header is read and attached as `_retryAfter` on the parsed response
  8. `npm run build` compiles without errors

---

### Wave 3: Tool Updates + Tests

#### Task 3.1: Add Priority Parameter to Message Tools

- **Description**: Add `priority` parameter (optional, z.number(), default 2, range 0-3) to `slack_post_message` and `slack_reply_to_thread` tool schemas. Pass the priority through to `client.postMessage()`. Update the tool description to mention priority.
- **Files**:
  - Modifies: `src/tools/messages.ts`
- **Dependencies**: Task 2.1 (postMessage accepts priority)
- **Context Needed**:
  - `src/tools/messages.ts` — current implementation
  - `docs/fork-spec.md` Section 4.3 line 643 — priority Zod schema
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "priority" src/tools/messages.ts && echo "priority param found" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build 2>&1 | tail -5
  ```
- **Done When**:
  1. `slack_post_message` schema includes `priority: z.number().optional().default(2).describe(...)`
  2. `slack_reply_to_thread` schema includes same `priority` parameter
  3. Both handlers pass `priority` to `client.postMessage()` (as part of options or as separate arg)
  4. Priority description mentions: 0=urgent, 1=decision, 2=normal, 3=background
  5. `npm run build` compiles without errors

---

#### Task 3.2: Rate Limiter Unit Tests (`tests/unit/rate-limiter.test.ts`)

- **Description**: Create unit tests for `SlackRateLimiter`. Cover: per-method limits (requests above limit are queued), priority ordering (priority 0 dequeues before priority 3), 429 retry with Retry-After header, queue delay warning logging. Use `vi.useFakeTimers()` for deterministic timing. Mock `console.error` to capture warning logs.
- **Files**:
  - Creates: `tests/unit/rate-limiter.test.ts`
- **Dependencies**: Task 1.1 (rate-limiter.ts must exist)
- **Context Needed**:
  - `src/rate-limiter.ts` — class to test
  - `tests/unit/slack-client.test.ts` — existing test patterns (import style, mock patterns)
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f tests/unit/rate-limiter.test.ts && echo "rate-limiter test file exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "SlackRateLimiter" tests/unit/rate-limiter.test.ts && echo "SlackRateLimiter tested" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npx vitest run tests/unit/rate-limiter.test.ts 2>&1 | tail -10
  ```
- **Done When**:
  1. `tests/unit/rate-limiter.test.ts` exists with Vitest imports (`describe, it, expect, vi, beforeEach, afterEach`)
  2. Test: enqueue and execute a single request successfully
  3. Test: per-method limit enforced — requests beyond limit are queued (not rejected) and execute after window expires
  4. Test: priority 0 items dequeue before priority 3 items when both are queued
  5. Test: 429 response triggers retryAfter, pauses processing, then retries
  6. Test: queue delay warning logged to stderr when item waits > 10 seconds
  7. Uses `vi.useFakeTimers()` for deterministic timing
  8. All rate-limiter tests pass

---

#### Task 3.3: Network Retry Unit Tests (`tests/unit/network.test.ts`)

- **Description**: Create unit tests for `fetchWithRetry()`. Cover: success on first attempt, success on retry after 5xx, max retries exhausted throws, 4xx returns immediately (no retry), network error (fetch throws) triggers retry. Mock `globalThis.fetch` with `vi.fn()`.
- **Files**:
  - Creates: `tests/unit/network.test.ts`
- **Dependencies**: Task 1.2 (network.ts must exist)
- **Context Needed**:
  - `src/network.ts` — function to test
  - `tests/unit/slack-client.test.ts` — existing test patterns
- **Smoke Tests**:
  ```bash
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && test -f tests/unit/network.test.ts && echo "network test file exists" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && grep -q "fetchWithRetry" tests/unit/network.test.ts && echo "fetchWithRetry tested" || exit 1
  cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npx vitest run tests/unit/network.test.ts 2>&1 | tail -10
  ```
- **Done When**:
  1. `tests/unit/network.test.ts` exists with Vitest imports
  2. Test: successful fetch on first attempt returns Response
  3. Test: 5xx on first attempt, 200 on second attempt — returns successfully
  4. Test: all retries return 5xx — throws error with retry count in message
  5. Test: 4xx response returns immediately without retry
  6. Test: network error (fetch throws) triggers retry with backoff
  7. Test: exponential backoff timing is correct (uses `vi.useFakeTimers()` or verifies delay durations)
  8. Mocks `globalThis.fetch` with `vi.fn()` (restored in afterEach)
  9. All network tests pass

---

## Parallelization Map

| Wave | Tasks | Parallel? | Justification |
|------|-------|-----------|---------------|
| 1 | 1.1, 1.2 | Yes | Each creates an independent new file, no shared writes |
| 2 | 2.1 | N/A | Single task |
| 3 | 3.1, 3.2, 3.3 | Yes | Each creates/modifies independent files |

---

## File Ownership Guarantee

| File | Owner Task | Access |
|------|-----------|--------|
| `src/rate-limiter.ts` | 1.1 | Write (create) |
| `src/network.ts` | 1.2 | Write (create) |
| `src/slack-client.ts` | 2.1 | Write (modify) |
| `src/tools/messages.ts` | 3.1 | Write (modify) |
| `tests/unit/rate-limiter.test.ts` | 3.2 | Write (create) |
| `tests/unit/network.test.ts` | 3.3 | Write (create) |
| `src/rate-limiter.ts` | 3.2 | Read only |
| `src/network.ts` | 3.3 | Read only |
| `src/slack-client.ts` | 3.1 | Read only |

**Conflict check**: No two parallel tasks write to the same file. PASS.

---

## Test Plan

| Test File | Tasks Covered | Expected Tests |
|-----------|---------------|----------------|
| `tests/unit/rate-limiter.test.ts` | 3.2 | ~6 (single request, method limit, priority ordering, 429 retry, queue delay warning, re-enqueue) |
| `tests/unit/network.test.ts` | 3.3 | ~5 (success first attempt, success on retry, max retries throws, 4xx no retry, network error retry) |
| `tests/unit/slack-client.test.ts` | (existing) | 13 (should still pass — fetch mock intercepts at bottom layer) |
| `tests/unit/identity.test.ts` | (existing) | 13 (unaffected) |

**Existing**: 26 tests (13 slack-client + 13 identity)
**New**: ~11 (6 rate-limiter + 5 network)
**Total after phase**: ~37

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Existing `slack-client.test.ts` tests break because `fetch` is now called inside `rateLimiter.enqueue()` + `fetchWithRetry()` | Medium | High | The existing tests mock `globalThis.fetch` which still intercepts. `fetchWithRetry` calls the same `fetch`. The rate limiter is async but tests `await` the result. Monitor test output after Wave 2. |
| `vi.useFakeTimers()` in rate-limiter tests interferes with `vi.useFakeTimers()` in network tests | Low | Medium | Each test file manages its own fake timers with `beforeEach`/`afterEach`. Vitest runs files in isolation by default. |
| Rate limiter `processQueue` async loop causes test flakiness | Medium | Medium | Use `vi.useFakeTimers()` and `vi.advanceTimersByTime()` to control timing deterministically. Await promises after advancing timers. |

---

## Git Checkpoints

| Wave | Commit Message |
|------|----------------|
| 1 | `feat(phase-3-w1): add rate limiter and network retry modules` |
| 2 | `feat(phase-3-w2): wire rate limiter and fetchWithRetry into SlackClient` |
| 3 | `feat(phase-3-w3): add priority param to message tools and unit tests` |

---

## Verification Commands

```bash
# Wave 1 verification (structure check)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && ls src/rate-limiter.ts src/network.ts && echo "Wave 1 files exist"

# Wave 2 verification (full build)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm run build 2>&1 | tail -10

# Wave 2 regression (existing tests still pass)
cd /Users/waltermcgivney/Documents/Projects/slack-mcp-identity-server && npm test

# Wave 3 verification (all tests including new ones)
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
- [ ] `npm test` passes all unit tests (~37 total)
- [ ] `SlackRateLimiter` class exists with per-method token bucket
- [ ] Priority queue sorts by priority then enqueue time
- [ ] 429 response triggers retryAfter pause and re-enqueue
- [ ] `fetchWithRetry` retries on 5xx with exponential backoff
- [ ] `fetchWithRetry` does NOT retry on 4xx
- [ ] `fetchWithRetry` runs INSIDE `rateLimiter.enqueue()`, not wrapping it
- [ ] `Retry-After` header propagated as `_retryAfter` on parsed response
- [ ] Queue delay warning logged to stderr for >10s waits
- [ ] `slack_post_message` and `slack_reply_to_thread` accept `priority` parameter
- [ ] All existing tests (26) still pass
- [ ] Git commits per wave complete
