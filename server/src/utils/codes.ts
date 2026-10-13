import { Schema, model } from 'mongoose';

const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = model('Counter', counterSchema);

/** Human-readable sequential codes such as PH-000123 or WO-000045 (atomic per prefix). */
export async function nextCode(prefix: string, count = 1): Promise<string[]> {
  const doc = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: count } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  const end = doc!.seq;
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(end - count + 1 + i).padStart(6, '0')}`);
}
