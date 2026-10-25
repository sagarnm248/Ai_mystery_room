# AI Mystery Room

AI Mystery Room turns a short story seed into a fictional detective game. Players investigate suspects, discover clues, open linked evidence, request progressive hints, make one final accusation, and see an evidence-based result with a score.

## Requirements

- Node.js 20 or newer and npm
- MongoDB running locally or a MongoDB connection string
- A Google Gemini API key for case generation

## Run locally

1. Copy `.env.example` to `server/.env` and set `MONGODB_URI`, `SESSION_SECRET`, and `GEMINI_API_KEY`. Choose a model available to your Google GenAI account in `GEMINI_MODEL`.
2. Install workspace dependencies at the repository root with `npm install`.
3. Start MongoDB, then run `npm run dev` from the repository root.
4. Open `http://localhost:5173`.

The API listens on port 5000 by default. The client uses `http://localhost:5000/api/v1`; set `VITE_API_BASE_URL` in `client/.env` to change it. Keep Gemini credentials on the server. Configure `CLIENT_ORIGIN` to the client origin.

If Gemini is not configured, the API records a failed case with a safe message. It does not substitute a fake case. Failed cases can be retried within the configured generation limit.

## Game rules

| Difficulty | Suspects | Clues | Hints | Correct accusation |
| --- | ---: | ---: | ---: | ---: |
| Easy | 3 | 5 | 2 | 100 points |
| Medium | 4 | 7 | 3 | 150 points |
| Hard | 5 | 9 | 3 | 200 points |

Each discovered clue adds 5 points and each hint used subtracts 10. A correct accusation earns the difficulty points. Final score is clamped to zero. The API enforces scoring and one final accusation per case.

## Architecture

- `client/`: React, Vite, React Router, Tailwind CSS, and the custom detective case-file CSS theme.
- `server/`: Express API, MongoDB/Mongoose persistence, anonymous session ownership, Gemini generation adapter, Zod validation, and deterministic consistency checks.
- `SPEC.md`: product and engineering requirements, gameplay/scoring rules, API overview, and deployment checklist.
- `server/src/models.js`: case, clue, progress, private solution, and accusation models.
- `server/src/generator.js`: structured Gemini generation with difficulty-specific counts and validation.
- `server/src/server.js`: API routes, ownership checks, clue discovery, hint use, scoring, accusations, and guarded reveals.

Generation starts asynchronously after the case record is saved. Players discover clues to unlock linked evidence. Images and CCTV entries use textual descriptions; no image or video provider is configured.

## API and deployment

See [docs/API.md](docs/API.md) for routes and request rules. `vercel.json` configures the client SPA build. `render.yaml` describes an API service. Follow the deployment section in the API guide to configure production environment variables and origins. Actual deployment and course submission require your hosting accounts and repository access.

## Security notes and current limits

- Anonymous ownership uses an HttpOnly cookie backed by MongoDB session storage. Production cookies use `SameSite=None; Secure` so the separate Vercel client can call the Render API.
- Generation runs in the Express process rather than a durable background queue.
- `.env` files and live keys must never be committed. `GEMINI_API_KEY` is never a client variable.
- The app has not been deployed or exercised against a live Gemini key and production MongoDB.
