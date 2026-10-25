import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MysteryCase, Accusation } from './models.js';
import { DIFFICULTY_RULES, generateMystery } from './generator.js';

export const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'mystery.sid',
  secret: process.env.SESSION_SECRET || 'development-only',
  resave: false,
  saveUninitialized: true,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI, collectionName: 'sessions', ttl: 30 * 24 * 60 * 60 }),
  cookie: { httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 60 * 60 * 1000 },
}));
app.use((req, res, next) => { req.requestId = randomUUID(); res.set('X-Request-Id', req.requestId); next(); });
app.use('/api/v1', rateLimit({ windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000), limit: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 20), standardHeaders: true, legacyHeaders: false }));

const router = express.Router();
const ensureOwner = req => req.session.ownerSessionId || (req.session.ownerSessionId = randomUUID());
const sendError = (res, status, code, message, retryable = false) => res.status(status).json({ error: { code, message, requestId: res.get('X-Request-Id'), retryable } });
const parseId = id => mongoose.isValidObjectId(id);
const ownedCase = (id, owner) => MysteryCase.findOne({ _id: id, ownerSessionId: owner }).select('+solution');
const publicCase = (c, accusation = null) => {
  const found = new Set(c.discoveredClueIds || []);
  const clues = (c.clues || []).map((clue, index) => ({
    id: clue.id,
    title: found.has(clue.id) ? clue.title : `Sealed clue ${String(index + 1).padStart(2, '0')}`,
    discovered: found.has(clue.id),
    ...(found.has(clue.id) ? { description: clue.description, evidenceIds: clue.evidenceIds } : {}),
  }));
  const evidence = (c.evidence || []).filter(item => (item.supports || []).some(clueId => found.has(clueId)));
  return {
    _id: c._id, status: c.status, title: c.title, settings: c.settings,
    briefing: c.briefing, suspects: c.suspects, clues, timeline: c.timeline,
    evidence, discoveredClueIds: [...found], clueCount: c.clues?.length || 0,
    hintsUsed: c.hintsUsed || 0, usedHints: c.usedHints || [], hintLimit: c.solution?.hints?.length || 0,
    score: c.score || 0, createdAt: c.createdAt, readyAt: c.readyAt,
    safeMessage: c.safeMessage, hasAccusation: Boolean(accusation),
  };
};
const findOwnedCase = async (req, res, withSolution = false) => {
  if (!parseId(req.params.id)) { sendError(res, 404, 'NOT_FOUND', 'Case not found.'); return null; }
  const c = await ownedCase(req.params.id, ensureOwner(req));
  if (!c) { sendError(res, 404, 'NOT_FOUND', 'Case not found.'); return null; }
  if (!withSolution) c.solution = undefined;
  return c;
};

async function runGeneration(c) {
  try {
    const generated = await generateMystery(c.storySeed, c.settings);
    c.title = generated.title;
    c.briefing = { synopsis: generated.synopsis, incident: generated.incident };
    c.suspects = generated.suspects;
    c.clues = generated.clues;
    c.timeline = generated.timeline;
    c.evidence = generated.evidence;
    c.solution = { ...generated.solution, hints: generated.hints };
    c.status = 'READY';
    c.readyAt = new Date();
    c.safeMessage = undefined;
    await c.save();
  } catch (error) {
    c.status = 'FAILED';
    c.safeMessage = error.safeCode === 'PROVIDER_NOT_CONFIGURED'
      ? 'Case generation is not configured. Add a Gemini API key on the server.'
      : 'We could not assemble a consistent case. Please retry.';
    c.generation = { ...(c.generation || {}), safeFailureCode: error.safeCode || 'GENERATION_FAILED' };
    c.markModified('generation');
    await c.save();
  }
}

router.get('/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

router.post('/cases', async (req, res) => {
  const settingsSchema = z.object({
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
    genre: z.enum(['ANY', 'DETECTIVE', 'THRILLER', 'SCI_FI', 'HISTORICAL', 'FANTASY', 'CAMPUS', 'CORPORATE']).default('ANY'),
    tone: z.enum(['GROUNDED', 'CINEMATIC', 'LIGHT']).default('GROUNDED'),
    targetMinutes: z.union([z.literal(10), z.literal(20), z.literal(30)]).default(20),
    evidenceTypes: z.array(z.enum(['CHAT', 'IMAGE', 'STATEMENT', 'TIMELINE', 'CCTV_LOG', 'FORENSIC_NOTE'])).min(1).default(['CHAT', 'IMAGE', 'STATEMENT', 'TIMELINE', 'CCTV_LOG', 'FORENSIC_NOTE']),
  }).default({});
  const schema = z.object({ storySeed: z.string().trim().min(30).max(1500), settings: settingsSchema, idempotencyKey: z.string().max(100).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  const ownerSessionId = ensureOwner(req);
  if (parsed.data.idempotencyKey) {
    const existing = await MysteryCase.findOne({ ownerSessionId, idempotencyKey: parsed.data.idempotencyKey });
    if (existing) return res.status(202).json({ caseId: existing._id, status: existing.status, pollUrl: `/api/v1/cases/${existing._id}/status` });
  }
  const c = await MysteryCase.create({ ownerSessionId, status: 'GENERATING', storySeed: parsed.data.storySeed, settings: parsed.data.settings, idempotencyKey: parsed.data.idempotencyKey, generation: { attemptCount: 1 } });
  res.status(202).json({ caseId: c._id, status: c.status, pollUrl: `/api/v1/cases/${c._id}/status` });
  setImmediate(() => runGeneration(c));
});

router.get('/cases', async (req, res) => {
  const ownerSessionId = ensureOwner(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const cases = await MysteryCase.find({ ownerSessionId }).sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25);
  res.json({ cases: cases.map(c => ({ _id: c._id, status: c.status, title: c.title, settings: c.settings, createdAt: c.createdAt, safeMessage: c.safeMessage })), page });
});

router.get('/cases/:id/status', async (req, res) => {
  const c = await findOwnedCase(req, res);
  if (!c) return;
  res.json({ caseId: c._id, status: c.status, retryable: c.status === 'FAILED', safeMessage: c.safeMessage });
});

router.get('/cases/:id', async (req, res) => {
  const c = await findOwnedCase(req, res, true);
  if (!c) return;
  const accusation = await Accusation.findOne({ caseId: c._id, ownerSessionId: req.session.ownerSessionId }).select('_id');
  res.json(publicCase(c, accusation));
});

router.post('/cases/:id/clues/:clueId/discover', async (req, res) => {
  const c = await findOwnedCase(req, res, true);
  if (!c) return;
  if (c.status !== 'READY') return sendError(res, 409, 'CASE_NOT_READY', 'This case is not ready to investigate.');
  const clue = c.clues.find(item => item.id === req.params.clueId);
  if (!clue) return sendError(res, 404, 'CLUE_NOT_FOUND', 'Clue not found.');
  const alreadyFound = c.discoveredClueIds.includes(clue.id);
  if (!alreadyFound) {
    c.discoveredClueIds.push(clue.id);
    c.score = Math.max(0, (c.score || 0) + 5);
    await c.save();
  }
  const unlockedEvidence = c.evidence.filter(item => (item.supports || []).includes(clue.id));
  res.json({ clue: { id: clue.id, title: clue.title, description: clue.description, evidenceIds: clue.evidenceIds }, discovered: true, alreadyDiscovered: alreadyFound, score: c.score, unlockedEvidence });
});

router.post('/cases/:id/hints', async (req, res) => {
  const c = await findOwnedCase(req, res, true);
  if (!c) return;
  if (c.status !== 'READY') return sendError(res, 409, 'CASE_NOT_READY', 'Hints are available when the case is ready.');
  const hints = c.solution.hints || [];
  if (c.hintsUsed >= hints.length) return sendError(res, 409, 'NO_HINTS_REMAINING', 'You have used all hints for this case.');
  const hint = hints[c.hintsUsed];
  c.hintsUsed += 1;
  c.usedHints.push(hint);
  c.score = Math.max(0, (c.score || 0) - 10);
  await c.save();
  res.json({ hint, hintsUsed: c.hintsUsed, hintsRemaining: hints.length - c.hintsUsed, score: c.score });
});

const accusationHandler = async (req, res) => {
  const body = z.object({ suspectId: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Select a listed suspect.');
  const c = await findOwnedCase(req, res, true);
  if (!c) return;
  if (c.status !== 'READY') return sendError(res, 409, 'CASE_NOT_READY', 'This case is not ready for an accusation.');
  if (!c.suspects.some(suspect => suspect.id === body.data.suspectId)) return sendError(res, 400, 'INVALID_SUSPECT', 'Choose a suspect in this case.');
  const ownerSessionId = req.session.ownerSessionId;
  const isCorrect = c.solution.culpritId === body.data.suspectId;
  try {
    const accusation = await Accusation.create({ caseId: c._id, ownerSessionId, suspectId: body.data.suspectId, isCorrect });
    const base = isCorrect ? DIFFICULTY_RULES[c.settings.difficulty].correctAccusation : 0;
    c.score = Math.max(0, base + c.discoveredClueIds.length * 5 - c.hintsUsed * 10);
    await c.save();
    return res.status(201).json({ accusationId: accusation._id, submittedAt: accusation.submittedAt, revealAvailable: true });
  } catch (error) {
    if (error.code === 11000) return sendError(res, 409, 'ACCUSATION_ALREADY_SUBMITTED', 'A final accusation has already been submitted.');
    throw error;
  }
};
router.post('/cases/:id/accusations', accusationHandler);
router.post('/cases/:id/accuse', accusationHandler);

const revealHandler = async (req, res) => {
  const c = await findOwnedCase(req, res, true);
  if (!c) return;
  const accusation = await Accusation.findOne({ caseId: c._id, ownerSessionId: req.session.ownerSessionId });
  if (!accusation) return sendError(res, 403, 'REVEAL_LOCKED', 'Submit an accusation before revealing the solution.');
  accusation.revealedAt = new Date();
  await accusation.save();
  const culprit = c.suspects.find(suspect => suspect.id === c.solution.culpritId);
  const evidenceReferences = c.evidence.filter(item => c.solution.deductions.some(step => step.evidenceIds.includes(item.id))).map(item => ({ id: item.id, title: item.title }));
  const correctBase = accusation.isCorrect ? DIFFICULTY_RULES[c.settings.difficulty].correctAccusation : 0;
  const cluePoints = c.discoveredClueIds.length * 5;
  const hintPenalty = c.hintsUsed * 10;
  const score = Math.max(0, correctBase + cluePoints - hintPenalty);
  res.json({ isCorrect: accusation.isCorrect, selectedSuspectId: accusation.suspectId, culprit, motive: c.solution.motive, method: c.solution.method, opportunity: c.solution.opportunity, explanation: c.solution.explanation, deductions: c.solution.deductions, evidenceReferences, score, scoreBreakdown: { correctAccusation: correctBase, discoveredClues: c.discoveredClueIds.length, cluePoints, hintsUsed: c.hintsUsed, hintPenalty, minimum: 0 } });
};
router.get('/cases/:id/reveal', revealHandler);
router.get('/cases/:id/result', revealHandler);

router.post('/cases/:id/retry', async (req, res) => {
  const c = await findOwnedCase(req, res);
  if (!c) return;
  if (c.status !== 'FAILED') return sendError(res, 409, 'CASE_NOT_FAILED', 'Only failed cases can be retried.');
  const maxAttempts = Number(process.env.GENERATION_MAX_ATTEMPTS || 3);
  if ((c.generation?.attemptCount || 1) >= maxAttempts) return sendError(res, 429, 'RETRY_LIMIT_REACHED', 'This case has reached its retry limit.');
  c.status = 'GENERATING';
  c.generation = { ...(c.generation || {}), attemptCount: (c.generation?.attemptCount || 1) + 1 };
  c.safeMessage = undefined;
  c.markModified('generation');
  await c.save();
  res.status(202).json({ caseId: c._id, status: c.status });
  setImmediate(() => runGeneration(c));
});

app.use('/api/v1', router);
app.use((req, res) => sendError(res, 404, 'NOT_FOUND', 'That route does not exist.'));
app.use((err, req, res, _next) => {
  console.error(JSON.stringify({ requestId: req.requestId, category: 'REQUEST_FAILED' }));
  if (!res.headersSent) sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.', true);
});
