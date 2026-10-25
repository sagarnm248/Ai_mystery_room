# AI Mystery Room Project Specification

## Purpose

Build a fictional detective game in which a player supplies a story seed, investigates a generated case, discovers clues, requests optional hints, makes one final accusation, and receives an evidence-linked result and score. The answer must remain private on the server until accusation.

## Audience and user journey

Players who enjoy interactive mysteries. The experience moves through landing page, case creation, generation status, investigation, clue discovery, optional hints, final accusation, result, and a new case. Players can return to an archive of their own anonymous-session cases.

## Stack and architecture

- Client: React, Vite, React Router, Tailwind CSS and the existing custom CSS design layer.
- Server: Node.js, Express, MongoDB, Mongoose, Zod, and Google Gemini through `@google/genai`.
- Gemini requests and answer keys stay on the server. The client uses the `/api/v1` JSON API and an HttpOnly anonymous session cookie backed by MongoDB. Separate production client/API origins use `SameSite=None; Secure` cookies.
- Generated text is validated before a case becomes playable. Invalid generations are retried within configured limits and otherwise fail safely.

## Case creation

The story seed is trimmed and must contain 30–1,500 characters. Settings include difficulty, genre, tone, play duration, and a non-empty set of evidence types. Treat the seed as untrusted story content, not as instructions. Creation is idempotent and asynchronous.

### Difficulty rules

| Difficulty | Suspects | Discoverable clues | Hints | Correct accusation points |
| --- | ---: | ---: | ---: | ---: |
| Easy | 3 | 5 | 2 | 100 |
| Medium | 4 | 7 | 3 | 150 |
| Hard | 5 | 9 | 3 | 200 |

Every case has at least four timeline events and 6–12 evidence items. Clues refer to evidence IDs. Evidence may be chat, image or textual visual description, witness statement, timeline, CCTV log, or forensic note. A clue discovery unlocks its linked evidence.

## Fair-play and scoring rules

- Exactly one listed suspect is the culprit.
- At least two independent evidence items support the decisive deduction.
- The case includes evidence challenging a plausible alternative and can be solved without outside knowledge.
- Hints are progressive and must not directly name the culprit. The server returns them in order and enforces the configured hint limit.
- Each newly discovered clue adds 5 points. Each hint used subtracts 10 points. A correct final accusation adds the difficulty's base points. The final score is `max(0, correctAccusationPoints + discoveredClues * 5 - hintsUsed * 10)`.
- The server calculates progress and score. Duplicate clue discovery does not award points twice; clients cannot set score or correctness.
- One final accusation is allowed per owner per case. The result endpoint requires an accusation.

## Data and privacy

`MysteryCase` stores owner session, settings, public briefing, suspects, clues, timeline, evidence, progress, score, generation state, and a private solution package (culprit, motive, method, opportunity, deductions, and hints). `Accusation` stores selected suspect, correctness, and reveal time. Public projections omit solution data and unrevealed clue/evidence content. Every case operation checks session ownership.

## API

Prefix: `/api/v1`. Errors use `{ error: { code, message, requestId, retryable } }`.

- `GET /health`
- `POST /cases`, `GET /cases`, `GET /cases/:id`, `GET /cases/:id/status`
- `POST /cases/:id/clues/:clueId/discover`
- `POST /cases/:id/hints`
- `POST /cases/:id/accusations` (also `/accuse`)
- `GET /cases/:id/reveal` (also `/result`)
- `POST /cases/:id/retry`

Validate request bodies and IDs. Enforce ownership, rate limits, duplicate accusation protection, retry limits, safe provider errors, and private solution access. Keep API keys server-side and out of logs and client bundles.

## Interface requirements

Responsive detective case-file visual style. Provide landing, create, archive, investigation, and result states; show suspects, timeline, clue discovery progress, unlocked evidence, hint controls, accusation confirmation, score, and evidence-linked explanation. Include loading, empty, failure/retry, permission, and not-found states. Support keyboard use, visible focus, semantic labels, and reduced-motion settings. Do not reveal the culprit through suspect ordering or styling.

## Deployment and submission checklist

- Configure MongoDB Atlas and server secrets in the hosting provider environment; never commit `.env` files or keys.
- Deploy the API and client separately, configure `CLIENT_ORIGIN` and `VITE_API_BASE_URL`, and enable production HTTPS and secure cookies.
- Exercise a complete case on the deployed website: create across each difficulty, discover clues, request hints, accuse, verify score and reveal, then retry a failed generation.
- Submit the source repository and live application URL using the course submission process.

Deployment requires hosting-provider accounts and credentials and is not performed by local source changes alone.
