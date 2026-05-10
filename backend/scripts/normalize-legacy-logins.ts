import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function baseFromValue(value: string) {
  const lower = value.trim().toLowerCase();
  const core = lower.includes('@') ? lower.split('@')[0] : lower;
  const normalized = core.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized;
}

function buildCandidate(base: string, fallback: string, suffix?: string) {
  const seed = base || fallback;
  const withSuffix = suffix ? `${seed}-${suffix}` : seed;
  const compact = withSuffix.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const trimmed = compact.slice(0, 64);
  if (trimmed.length >= 3) return trimmed;
  return `${trimmed || 'user'}${fallback}`.slice(0, 64);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const users = await prisma.user.findMany({
    select: { id: true, login: true, email: true },
    orderBy: { createdAt: 'asc' },
  });

  const existing = new Set(users.map((u) => u.login.toLowerCase()));
  const badLogin = /^[a-z0-9._-]{3,64}$/;
  let changed = 0;

  for (const user of users) {
    const current = user.login.trim().toLowerCase();
    if (badLogin.test(current)) continue;

    existing.delete(current);
    const fallback = user.id.slice(0, 8).toLowerCase();
    const preferredBase = baseFromValue(user.email ?? user.login);
    let next = buildCandidate(preferredBase, fallback);
    let attempt = 1;

    while (existing.has(next)) {
      next = buildCandidate(preferredBase, fallback, String(attempt));
      attempt += 1;
    }

    existing.add(next);
    changed += 1;

    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(`[dry-run] ${user.id}: ${user.login} -> ${next}`);
      continue;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { login: next },
    });
    // eslint-disable-next-line no-console
    console.log(`[updated] ${user.id}: ${user.login} -> ${next}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    dryRun
      ? `Dry run complete. Legacy logins detected: ${changed}.`
      : `Normalization complete. Updated users: ${changed}.`,
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
