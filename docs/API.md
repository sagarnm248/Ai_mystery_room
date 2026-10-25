# API contract

All endpoints use JSON under `/api/v1`. The API creates an HttpOnly anonymous session cookie and scopes case reads and writes to that owner. Error responses use `{ "error": { "code", "message", "requestId", "retryable" } }`.

## Routes

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/health` | Reports API and MongoDB connection state. |
| POST | `/cases` | Validates seed/settings, creates a `GENERATING` case and returns `202` with `caseId`, `status`, and `pollUrl`. Accepts an optional `idempotencyKey`. |
| GET | `/cases` | Lists the current owner's cases, newest first, up to 25 per page. |
| GET | `/cases/:id` | Returns the public case, clue discovery state, unlocked evidence, hint count, score progress, and whether an accusation exists. |
| GET | `/cases/:id/status` | Returns safe status information only. |
| POST | `/cases/:id/clues/:clueId/discover` | Discovers one clue, adds 5 points once, and unlocks its related evidence. |
| POST | `/cases/:id/hints` | Returns the next progressive hint, subtracts 10 points (minimum score 0), and enforces the difficulty hint limit. |
| POST | `/cases/:id/accusations` or `/cases/:id/accuse` | Accepts `{ "suspectId": "..." }`; records one final accusation without returning correctness. |
| GET | `/cases/:id/reveal` or `/cases/:id/result` | Returns verdict, culprit, evidence-linked explanation, and score only after an accusation. |
| POST | `/cases/:id/retry` | Retries a failed case within the configured attempt limit. |

Case IDs are checked against the current session on every case route. A session can submit one final accusation per case. Clients cannot set score, discovery progress, hint usage, or correctness.

## Difficulty rules and scoring

| Difficulty | Suspects | Clues | Hints | Correct accusation points |
| --- | ---: | ---: | ---: | ---: |
| EASY | 3 | 5 | 2 | 100 |
| MEDIUM | 4 | 7 | 3 | 150 |
| HARD | 5 | 9 | 3 | 200 |

Each discovered clue is worth 5 points; each used hint costs 10 points. The final score is `max(0, correct accusation points + discovered clues × 5 − hints used × 10)`.

## Create request

```json
{
  "storySeed": "A locked observatory is found open after midnight...",
  "settings": {
    "difficulty": "MEDIUM",
    "genre": "SCI_FI",
    "tone": "GROUNDED",
    "targetMinutes": 20,
    "evidenceTypes": ["CHAT", "STATEMENT", "TIMELINE", "CCTV_LOG"]
  },
  "idempotencyKey": "client-generated-key"
}
```

The trimmed story seed must contain 30–1,500 characters. Settings support `EASY | MEDIUM | HARD`, genres `ANY | DETECTIVE | THRILLER | SCI_FI | HISTORICAL | FANTASY | CAMPUS | CORPORATE`, tones `GROUNDED | CINEMATIC | LIGHT`, play durations 10/20/30 minutes, and a non-empty evidence type subset.

## Deployment

`vercel.json` configures the client build and SPA route fallback. `render.yaml` describes the Express API service. Set `VITE_API_BASE_URL` in Vercel to the deployed API's `/api/v1` URL, and set `CLIENT_ORIGIN` in Render to the deployed Vercel origin. Add the MongoDB Atlas URI and Gemini key in the hosting provider's secret settings; do not commit them. MongoDB stores both case data and anonymous session state. In production the API uses secure cross-site cookies for the separate Vercel and Render origins.
