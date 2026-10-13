// Prints "yes" if an active administrator exists, otherwise "no". Used by setup scripts.
process.env.LOG_LEVEL = 'silent';
const { connectDb, disconnectDb } = await import('../src/config/db.js');
const { User } = await import('../src/models/User.js');
await connectDb();
console.log((await User.exists({ role: 'admin', status: 'active' })) ? 'yes' : 'no');
await disconnectDb();
