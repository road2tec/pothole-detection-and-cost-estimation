import { Schema, model } from 'mongoose';

const reportSchema = new Schema(
  {
    kind: { type: String, enum: ['pdf', 'csv'], required: true },
    csvType: { type: String, enum: ['potholes', 'areas', 'severity', 'budget', null], default: null },
    title: String,
    filters: Schema.Types.Mixed,
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    costConfig: { type: Schema.Types.ObjectId, ref: 'CostConfiguration' },
    costConfigSnapshot: Schema.Types.Mixed,
    modelVersions: [String],
    potholeCount: Number,
    totals: Schema.Types.Mixed,
    filePath: String,
    sizeBytes: Number,
    status: { type: String, enum: ['generating', 'ready', 'failed'], default: 'generating' },
    error: String,
    durationMs: Number,
  },
  { timestamps: true },
);
export const Report = model('Report', reportSchema);

/** Evaluation results are stored only when an evaluation was actually run on labelled data. */
const modelEvaluationSchema = new Schema(
  {
    modelVersion: { type: String, required: true, index: true },
    repository: String,
    checkpoint: String,
    datasetDescription: { type: String, required: true },
    imageCount: { type: Number, required: true },
    iouThreshold: { type: Number, default: 0.5 },
    confidenceThreshold: Number,
    precision: Number,
    recall: Number,
    mAP50: Number,
    mAP50_95: Number,
    evaluatedAt: { type: Date, default: Date.now },
    evaluatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: String,
  },
  { timestamps: true },
);
export const ModelEvaluation = model('ModelEvaluation', modelEvaluationSchema);

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: String,
    link: String,
    readAt: Date,
  },
  { timestamps: true },
);
notificationSchema.index({ user: 1, createdAt: -1 });
export const Notification = model('Notification', notificationSchema);

const auditLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userEmail: String,
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true, index: true },
    entityId: String,
    details: Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ createdAt: -1 });
export const AuditLog = model('AuditLog', auditLogSchema);

const analyticsExportJobSchema = new Schema(
  {
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    trigger: { type: String, enum: ['manual', 'cli', 'api'], default: 'manual' },
    includeDemo: { type: Boolean, default: false },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
    directory: String,
    files: [{ name: String, rows: Number, sizeBytes: Number }],
    checks: Schema.Types.Mixed,
    error: String,
    durationMs: Number,
  },
  { timestamps: true },
);
export const AnalyticsExportJob = model('AnalyticsExportJob', analyticsExportJobSchema);

/** Read-only API keys for Power BI scheduled refresh. Only the SHA-256 hash is stored. */
const apiKeySchema = new Schema(
  {
    name: { type: String, required: true },
    prefix: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true },
    scopes: { type: [String], default: ['analytics:read'] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastUsedAt: Date,
    revokedAt: Date,
  },
  { timestamps: true },
);
export const ApiKey = model('ApiKey', apiKeySchema);
