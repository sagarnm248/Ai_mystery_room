import mongoose from 'mongoose';

const EvidenceSchema = new mongoose.Schema({
  id: String, type: String, title: String, summary: String,
  content: mongoose.Schema.Types.Mixed, createdAtInStory: String,
  sourceLabel: String, reliability: mongoose.Schema.Types.Mixed,
  supports: [String], isRedHerring: Boolean,
}, { _id: false });

const ClueSchema = new mongoose.Schema({
  id: String, title: String, description: String, evidenceIds: [String],
}, { _id: false });

const SuspectSchema = new mongoose.Schema({
  id: String, name: String, role: String, publicDescription: String,
  motivePossibility: String, initialAlibi: String,
}, { _id: false });

const CaseSchema = new mongoose.Schema({
  ownerSessionId: { type: String, required: true, index: true },
  status: { type: String, enum: ['GENERATING', 'READY', 'FAILED'], default: 'GENERATING' },
  title: String,
  storySeed: String,
  settings: mongoose.Schema.Types.Mixed,
  briefing: mongoose.Schema.Types.Mixed,
  suspects: [SuspectSchema],
  clues: [ClueSchema],
  timeline: [mongoose.Schema.Types.Mixed],
  evidence: [EvidenceSchema],
  solution: { type: mongoose.Schema.Types.Mixed, select: false },
  discoveredClueIds: { type: [String], default: [] },
  hintsUsed: { type: Number, default: 0 },
  usedHints: { type: [String], default: [] },
  score: { type: Number, default: 0 },
  generation: mongoose.Schema.Types.Mixed,
  idempotencyKey: String,
  safeMessage: String,
  readyAt: Date,
}, { timestamps: true });

CaseSchema.index({ ownerSessionId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
export const MysteryCase = mongoose.model('MysteryCase', CaseSchema);

const AccusationSchema = new mongoose.Schema({
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'MysteryCase', required: true },
  ownerSessionId: { type: String, required: true },
  suspectId: { type: String, required: true },
  submittedAt: { type: Date, default: Date.now },
  isCorrect: { type: Boolean, required: true },
  revealedAt: Date,
}, { timestamps: true });

AccusationSchema.index({ caseId: 1, ownerSessionId: 1 }, { unique: true });
export const Accusation = mongoose.model('Accusation', AccusationSchema);
