// Test configuration. Uses a dedicated database on the local MongoDB (never the dev database).
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/pothole_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdefghijklmnop';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdefghijklmno';
process.env.AI_SERVICE_TOKEN = process.env.AI_SERVICE_TOKEN ?? 'test-service-token-123456';
process.env.WORKER_ENABLED = 'false';
process.env.LOG_LEVEL = 'silent';
process.env.STORAGE_DIR = process.env.TEST_STORAGE_DIR ?? `${process.cwd()}/../storage/test-run`;
