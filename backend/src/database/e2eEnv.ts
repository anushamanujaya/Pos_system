// Imported first by e2eStack.ts so config/env.ts sees these values. Test stack only.
process.env.NODE_ENV = 'development';
process.env.JWT_ACCESS_SECRET ??= 'e2e-secret-e2e-secret-e2e-secret';
process.env.CORS_ORIGINS = 'http://localhost:5174';
process.env.UPLOAD_DIR = 'uploads-e2e';
