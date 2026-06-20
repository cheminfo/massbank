# Handoff — Local SPLASH implementation (`massbank`)

> **Read this first.** Self-contained orientation for a fresh Claude Code session opened in THIS repo to execute the local-SPLASH work. Everything needed to execute is in this repo. Pointers to broader context (in the separate NoBS app) are marked **context only — not needed to execute**.

## TASK (one line)

Implement the canonical SPLASH algorithm **locally** in this package to replace the external Fiehn Lab API call, making SPLASH computation/validation offline and deterministic.

## START HERE

1. `npm install` — **vitest is NOT installed yet**; tests won't run until you do this.
2. `npm test` — confirm the **existing** suite is green BEFORE any change; record the count (baseline).
3. Execute the plan step by step: **`docs/plans/2026-06-18-local-splash-implementation.md`** (TDD; self-contained — pinned algorithm + reference test vectors + ordered steps + gates).
4. **You (the user) commit.** No git operations by the agent on the working branch.

## WHY (context)

SPLASH (SPectraL hASH, `splash10-…`) is a deterministic content hash of a mass spectrum — a universal spectrum-identity key. This package currently delegates SPLASH to `https://splash.fiehnlab.ucdavis.edu/splash/it` and **fails open** (returns `''` → `validate()` passes) when that service is unreachable, and cannot compute offline. This work owns the algorithm locally and removes the network dependency.

- Broader purpose (**context only**): the NoBS Portal app will use the owned SPLASH for spectrum-level cross-reference to MoNA / MassBank / GNPS. Full GNPS research lives in the NoBS repo at `docs/gnps-integration-preplan.md` — **not needed to execute this plan.**

## VERIFY IT YOURSELF (don't just trust this handoff)

This handoff and the plan are **inputs, not gospel** — confirm understanding by doing your own quick research before/while executing:

- **SPLASH algorithm:** re-open the canonical reference (`berlinguyinca/spectra-hash` → `python/splash/splash.py` + `python/tests/test_splash.py`) and confirm the plan's pinned algorithm and reference vectors match what you read. The vectors are the gate — re-run them yourself.
- **Browser-compat hashing:** confirm `globalThis.crypto.subtle` is available in this package's targets (Node ≥18 + browser) before committing to it.
- **Broader API context (optional — to understand _why_ SPLASH matters):** do a small live check of the GNPS/MoNA/MassBank endpoints (e.g. the USI resolver `https://metabolomics-usi.gnps2.org/json/?usi1=…` returns a `splash`; how MoNA/MassBank key records by InChIKey/accession). Not required to execute SPLASH, but it clarifies the purpose. **Heads-up from NoBS live-tests (2026-06-18):** MoNA's InChIKey REST returned **401**, and FASST works only via **POST `api.fasst.gnps2.org`** (async), not the GET host. So treat all external APIs as things to verify live, never assume.
- **Rule of thumb:** trust live code + the canonical reference over any document, including this one.

## WHAT'S ALREADY DONE (do not redo)

- **Research:** the canonical SPLASH algorithm is pinned verbatim from the reference (`berlinguyinca/spectra-hash`, Wohlgemuth et al. 2016) in the plan's _Algorithm_ section, with 3 reference test vectors as the oracle.
- **Review:** Codex Rescue static review (2026-06-18), 3 findings adjudicated in the plan — FIX-1 (throw on empty/all-zero) ✅ accepted, FIX-3 (`engines: node>=18`) ✅ accepted, **FIX-2 (switch to `node:crypto`) ❌ REJECTED** (breaks browser-compat; interface is already async).
- **Empirical verification (2026-06-18):** a standalone port of the pinned spec reproduces reference vectors 1 & 2 **byte-for-byte** and throws on empty input — the algorithm in the plan is **proven correct before you start**.
- **A prototype was written then fully reverted.** The `src/splash/` working tree is back to its original (API-based) state; there is **no leftover prototype to reconcile** — build fresh from the plan.

## FILES

**In THIS repo (everything needed to execute):**

- `docs/plans/2026-06-18-local-splash-implementation.md` — **THE plan** (algorithm spec, reference vectors, Codex adjudication, TDD steps, gates, risks, roadmap).
- `docs/plans/2026-06-19-HANDOFF-splash.md` — this file.
- `src/splash/splash-validator.ts` — the current API-based validator to replace.
- `src/splash/interfaces.ts` — `ISplashValidator` (`calculate`/`validate` are already `async`).
- `src/record.ts` — `Peak` / `PK$PEAK` shape and `PK$SPLASH`.
- `src/__tests__/data/MSBNK-test-*.txt` — records carrying `PK$SPLASH` (a second oracle).

**In the NoBS repo (context only — NOT needed here):**

- `docs/gnps-integration-preplan.md` — full GNPS / MoNA / MassBank research + live-endpoint test results.

**Related repos on this machine (reference only):**

- `/Users/yashwanth/Desktop/UIC-Work/MassBank_P/MassBank-cli-tools` — the **original Java** MassBank validator this TS package was ported from. Reference it for overall validator / record-format / validation-rule fidelity. **IMPORTANT: it does NOT contain SPLASH** (grep confirms "splash" appears only in its test record files; no spectra-hash dependency in `pom.xml`). SPLASH was added later in the TS port (API-delegated) — so for the SPLASH algorithm the oracle is `berlinguyinca/spectra-hash`, NOT the Java code. Its `src/test/resources/recordfiles/MSBNK-test-*.txt` are useful extra oracle records (they carry `PK$SPLASH`).

## KEY DECISIONS (locked — do not re-litigate)

- **Hashing:** `globalThis.crypto.subtle` (Web Crypto), **NOT `node:crypto`** — this package is browser-compatible and `node:crypto` breaks the browser build. The interface is already async, so no migration.
- **Empty/all-zero spectra:** throw `RangeError` (matches the reference's div-by-zero failure).
- **`engines: { "node": ">=18" }`.**
- **Testing:** committed gate = reference vectors + this package's `PK$SPLASH` records (offline, deterministic). The API cross-check is **dev-only, env-gated, NEVER in `npm test`** (it is the network dependency we are removing).

## GOTCHAS

- vitest not installed → `npm install` first (this is why an earlier ad-hoc `npx vitest` failed).
- The working tree has substantial **unrelated WIP** (other in-progress work). Your SPLASH changes are additive — do not touch unrelated files.
- **Byte-exact fidelity is critical:** `Math.trunc` (not round); m/z ×1e6; do NOT round m/z to 4 dp; do NOT drop zero-intensity peaks; block3 sort is (mzInt asc, intInt desc); `translateBase` is BigInt-safe.
- **Browser compatibility is non-negotiable** — it is the reason this package exists.
