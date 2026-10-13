import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri: string = env.MONGODB_URI): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function dbReady(): boolean {
  return mongoose.connection.readyState === 1;
}
