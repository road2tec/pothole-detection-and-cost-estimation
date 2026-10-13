/**
 * Create the first administrator. There is no default admin account.
 *
 *   ADMIN_EMAIL=you@org.in ADMIN_NAME="Your Name" npm run bootstrap:admin
 *
 * The password is read from ADMIN_PASSWORD if set, otherwise prompted for (input hidden).
 * It is never accepted as a command-line argument, so it does not land in shell history.
 * The script refuses to run when an active administrator already exists; further admins are
 * created from the Users page.
 */
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { passwordSchema } from '../src/validators/auth.js';
import { AuditLog } from '../src/models/Misc.js';

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = process.stdout as NodeJS.WriteStream & { _write?: unknown };
    let muted = false;
    const original = (rl as any)._writeToOutput;
    (rl as any)._writeToOutput = (s: string) => {
      if (!muted) out.write(s);
    };
    rl.question(question, (answer) => {
      (rl as any)._writeToOutput = original;
      out.write('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim();
  if (!email || !name) {
    console.error('Set ADMIN_EMAIL and ADMIN_NAME environment variables.');
    process.exit(2);
  }
  const password = process.env.ADMIN_PASSWORD ?? (await promptHidden('Administrator password: '));
  const check = passwordSchema.safeParse(password);
  if (!check.success) {
    console.error(`Password rejected: ${check.error.issues[0].message}`);
    process.exit(2);
  }
  await connectDb();
  try {
    if (await User.exists({ role: 'admin', status: 'active' })) {
      console.error('An active administrator already exists. Create further administrators from the Users page.');
      process.exit(3);
    }
    if (await User.exists({ email })) {
      console.error(`A user with email ${email} already exists.`);
      process.exit(3);
    }
    const user = await User.create({
      name,
      email,
      role: 'admin',
      status: 'active',
      passwordHash: await bcrypt.hash(password, 12),
      approvedAt: new Date(),
    });
    await AuditLog.create({ user: user._id, userEmail: email, action: 'user.bootstrap_admin', entity: 'User', entityId: String(user._id) });
    console.log(`Administrator ${email} created.`);
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
