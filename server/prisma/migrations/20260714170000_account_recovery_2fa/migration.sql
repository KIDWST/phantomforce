-- Full account foundation: usernames, password recovery, username reminders,
-- and server-side 2FA login challenges.

CREATE TYPE "AuthChallengeKind" AS ENUM ('login_2fa', 'password_reset', 'username_reminder');

ALTER TABLE "User"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "twoFactorSecret" TEXT,
  ADD COLUMN "twoFactorBackupCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "twoFactorConfirmedAt" TIMESTAMP(3);

CREATE TABLE "AuthChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "kind" "AuthChallengeKind" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),

  CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "AuthChallenge_kind_tokenHash_key" ON "AuthChallenge"("kind", "tokenHash");
CREATE INDEX "AuthChallenge_userId_kind_idx" ON "AuthChallenge"("userId", "kind");
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
