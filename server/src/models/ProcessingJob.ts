import { Schema, model } from 'mongoose';

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;

/**
 * MongoDB-backed job queue. Workers claim jobs with an atomic findOneAndUpdate, so a job
 * is processed by one worker at a time; `attempts` and `lockedUntil` make retries safe.
 */
const processingJobSchema = new Schema(
  {
    type: { type: String, enum: ['detect-image', 'detect-video'], required: true },
    upload: { type: Schema.Types.ObjectId, ref: 'Upload', required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: JOB_STATUSES, default: 'queued', index: true },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    stage: String,
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lockedUntil: Date,
    workerId: String,
    aiJobId: String,
    startedAt: Date,
    finishedAt: Date,
    error: String,
    errorCode: String,
    result: Schema.Types.Mixed,
  },
  { timestamps: true },
);
processingJobSchema.index({ status: 1, createdAt: 1 });
export const ProcessingJob = model('ProcessingJob', processingJobSchema);
