# Plan — Local SPLASH implementation in the `massbank` package

- **Repo:** this package (`massbank`, v0.3.0). **Execute here.**
- **Date:** 2026-06-18
- **Status:** Codex-reviewed 2026-06-18 (findings adjudicated below) → ready to execute.
- **Codex review (adjudicated):** FIX-1 (throw on empty/all-zero) ACCEPTED; FIX-3 (`engines: node>=18`) ACCEPTED; **FIX-2 (switch to `node:crypto`) REJECTED** — it breaks browser-compat (this package's core purpose) and assumes an async migration that isn't needed (the `calculate` interface is already `Promise<string>`). Valid kernel kept: a sync pure-JS sha256 is the option _only if_ synchronous pipeline integration is required (Step 7).

## Goal

Replace the network-dependent, fail-open SPLASH validator with a faithful, offline, browser-compatible implementation of the canonical SPLASH algorithm. Afterward, SPLASH computation and validation are deterministic and require no external service.

## Why

`src/splash/splash-validator.ts` currently POSTs peaks to `https://splash.fiehnlab.ucdavis.edu/splash/it` and, on any failure, returns `''` → `validate()` returns `true`. So (a) SPLASH validation silently **passes whenever the API is unreachable** (fail-open — records "validate" without their SPLASH ever checked), and (b) the package cannot compute a SPLASH offline. SPLASH is an open, deterministic spec; owning it removes the runtime dependency and is the same Java→TS port already done for the rest of this validator.

## Scope

- **In:** local SPLASH algorithm in this package; wire the existing `SplashValidator` to it; tests (reference vectors + this package's own records); browser-compatible hashing; pipeline integration where appropriate.
- **Out (separate, later, in the NoBS app repo):** compute + store SPLASH at MassBank ingest, DB column, entry-view display, MoNA/MassBank/GNPS cross-reference. See Roadmap.

## Step 0 — Prerequisite: get the ground green first (do NOT skip)

This working tree currently has `vitest` uninstalled and substantial unrelated WIP.

- Run `npm install` (or `npm ci`), then `npm test`, and confirm the **existing** suite passes **before any change**. Record the baseline pass count. If red, stop and report — do not build on a red baseline.

## Algorithm (pinned — the oracle; do not deviate)

Canonical reference: `berlinguyinca/spectra-hash` (`python/splash/splash.py`), Wohlgemuth et al., _Nat. Biotechnol._ 2016.

Output: `splash10-<block1:4>-<block2:10>-<block3:20>` (four dash-separated parts; `splash10` = MS type `1` + version `0`).

Constants: `EPS = 1e-7`; `INTENSITY_MAP = "0123456789abcdefghijklmnopqrstuvwxyz"` (36 chars); m/z scaled ×`1e6` then `trunc`; intensity `trunc` (no scaling).

- **Block 1 (prefilter, 4 chars):** from peaks with `intensity + EPS ≥ 0.1·basePeak`, take the **top 10** by (intensity desc, m/z asc). Histogram those: 10 bins, `idx = trunc(mz/5) % 10`, sum intensities; normalize each bin `trunc(EPS + (3-1)·x/max)` → 0..2 → `INTENSITY_MAP` → 10-char base-3 string. Then `translateBase(str, fromBase=3, toBase=36, fill=4)` (BigInt-safe).
- **Block 2 (similarity histogram, 10 chars):** ALL peaks, 10 bins, `idx = trunc(mz/100) % 10`, sum; normalize `trunc(EPS + (10-1)·x/max)` → 0..9 → `INTENSITY_MAP`.
- **Block 3 (hash, 20 chars):** for each peak `[trunc((mz+EPS)·1e6), trunc(intensity+EPS)]`; sort by (mzInt asc, intInt desc); join `"mzInt:intInt mzInt:intInt …"`; `SHA-256` (UTF-8) → lowercase hex → **first 20 chars**.

Watch-outs: `Math.trunc` (NOT round); do NOT round m/z to 4 dp; do NOT drop zero-intensity peaks; bins WRAP via `% length`; `translateBase` uses BigInt (10 base-3 digits can exceed 53-bit floats); if a histogram's `max` is 0 (empty or all-zero-intensity spectrum) the reference divides by zero — **throw `RangeError`**, do NOT emit a non-canonical hash.

### Reference test vectors (oracle — from `python/tests/test_splash.py`)

1. `66.0463:2.1827 105.0698:7.9976 103.0541:4.5676 130.065:8.6025 93.0572:0.2544 79.0542:4.4657 91.0541:2.5671 131.0728:2.6844 115.0541:1.3542 65.0384:0.6554 94.0412:0.5614 116.0494:1.2008 95.049:2.1338 117.0572:100 89.0385:11.7808 77.0385:3.3802 90.0463:35.6373 132.0806:2.343 105.0446:1.771` → `splash10-014i-4900000000-889a38f7ace2626a0435`
2. `303.07:100 662.26:1.2111 454.91:1.2023 433.25:0.8864 432.11:2.308 592.89:3.9052 259.99:0.6406 281.14:1.2549 451.34:1.1847 499.85:1.2374 482.14:2.4133 450:23.5191 483:1.0004 285.25:1.448 253.1:46.5731 254.11:3.247 259.13:6.9241 304.14:17.2795` → `splash10-0udi-0049200000-ef488ecacceeaaadb4a2`
3. (`test_spectrum_3`, large) → `splash10-056v-2900000000-f47edee35669c8f014c2` — fetch its input from the reference suite if a third vector is wanted.

(Hand-verified: vector 1's block1 `014i` and block2 `4900000000` fall out by manual calculation. **Empirically verified 2026-06-18:** a standalone port of this exact spec reproduces vectors 1 & 2 byte-for-byte and throws on empty input — the algorithm in this plan is proven correct before execution.)

## Implementation steps (TDD; each ends at a gate)

1. **Failing tests.** Create `src/splash/__tests__/calculate-splash.test.ts` with vectors 1 & 2 (parse `"mz:int …"` → `{mz,intensity}[]`). `npm test` → expect RED (function absent).
2. **Implement.** Create `src/splash/calculate-splash.ts` exporting `async calculateSplash(peaks: SplashPeak[]): Promise<string>` + `SplashPeak`. Hash via `globalThis.crypto.subtle.digest('SHA-256', …)` — zero new dependency, works in browsers (HTTPS/worker) and Node ≥18, and the interface is already async so no signature change. **Do NOT use `node:crypto`** (Codex suggested it — REJECTED: it breaks the browser build). Run → GREEN on vectors 1 & 2.
3. **Edge cases.** `calculateSplash([])` and all-zero-intensity spectra **throw `RangeError`** (matches the reference's div-by-zero failure; `validate()` already skips empty `PK$PEAK` upstream) — assert this. Single peak, duplicate m/z, and very large m/z must each produce a valid hash with no `NaN`.
4. **Wire the validator.** Point `SplashValidator.calculate` at local `calculateSplash`; remove `fetch`/`apiUrl`; `validate()` recomputes and compares (no fail-open). Update `createSplashValidator()` (drop `apiUrl`) — `grep` callers first (`src/index.ts` + consumers).
5. **Export.** Add `calculateSplash` (+ `SplashPeak`) to `src/splash/index.ts`, and `src/index.ts` if splash is public surface.
6. **Validate against this package's own records.** `src/__tests__/data/MSBNK-test-*.txt` carry `PK$SPLASH`. Add a test that parses each and asserts `calculateSplash(peaks) === record.PK$SPLASH`. On mismatch: determine whether the fixture's SPLASH is non-canonical (fix fixture) or the impl is wrong (fix impl) — do NOT loosen the assertion.
7. **Pipeline integration.** Determine whether SPLASH validation is currently invoked in `validateContent`/`validate`. If not wired, wire it (gated like other rules); add tests that a correct `PK$SPLASH` passes and a tampered one fails. **Async caveat (Codex):** if the `IValidationRule` pipeline is synchronous, wiring an async SPLASH check forces an async migration — first check whether the pipeline already supports async rules. If it is sync-only, use an audited **pure-JS sync** sha256 (e.g. `@noble/hashes`) for the in-pipeline check rather than converting the whole pipeline to async — still NOT `node:crypto` (browser). If wiring is out of this package's validation contract, document why and stop at the standalone function.
8. **Dev-only API differential (optional; NOT in `npm test`).** `scripts/verify-splash-vs-api.ts`, env-gated (e.g. only when `SPLASH_API_CHECK=1`): generate N diverse/random spectra, hash locally + via the Fiehn API, assert equal. Document how to run. Breadth confidence only; never a CI gate (it is the network dep we removed).
9. **Full gates.** `npm run build` (tsc, 0 errors), `npm test` (all green incl. baseline), lint.

## Acceptance criteria

- Reference vectors 1 & 2 (and 3 if added) pass.
- This package's `MSBNK-test-*` `PK$SPLASH` records validate against the local impl.
- No network call in the SPLASH path (`grep -r fiehnlab src/` → none; no `fetch` in splash).
- `npm run build` + `npm test` + lint all green; baseline count preserved + new tests added.

## Testing strategy

- **Committed gate (offline, deterministic):** reference vectors + package records.
- **Dev-only differential (opt-in, env-gated):** API cross-check — not in CI.

## Risks / watch-outs

- **Byte-exact fidelity** (watch-outs above). A wrong SPLASH is worse than none — it silently breaks future cross-DB matching.
- **Hashing backend (Codex review adjudicated):** use `globalThis.crypto.subtle` (Web Crypto) — zero new dependency, browsers (HTTPS/worker) + Node ≥18, interface already async. **Do NOT** adopt Codex's `node:crypto` suggestion — it breaks the browser build. Ensure tsconfig `lib` types `crypto` (DOM/WebWorker) or add a typed accessor. Add `"engines": { "node": ">=18" }` (Codex FIX-3). If a sync hash is needed (Step 7) or an older/non-secure-context target appears, use an audited pure-JS sha256 (`@noble/hashes`), never `node:crypto`.
- **Public-API change:** dropping `apiUrl` from `createSplashValidator` — verify exported surface + consumers (NoBS uses `getVariables`/`validateContent`, not the splash validator directly — confirm).
- **Dirty working tree:** unrelated WIP + vitest uninstalled — hence Step 0.

## Roadmap (context; NOT part of this plan)

1. **This plan:** local SPLASH in `massbank`.
2. **Then (from the NoBS session):** live-test the GNPS + MoNA APIs to confirm the research (`NoBS docs/gnps-integration-preplan.md`) holds against the real endpoints.
3. **Then:** brainstorm/plan GNPS + MoNA integration in the NoBS app (alongside EU MassBank) — compute-and-store SPLASH at ingest + cross-reference.
