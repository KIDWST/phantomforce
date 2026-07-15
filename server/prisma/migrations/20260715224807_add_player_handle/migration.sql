-- CreateTable
CREATE TABLE "PlayerHandle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "usernameKey" TEXT NOT NULL,
    "globalScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerHandle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerHandle_userId_key" ON "PlayerHandle"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerHandle_usernameKey_key" ON "PlayerHandle"("usernameKey");

-- AddForeignKey
ALTER TABLE "PlayerHandle" ADD CONSTRAINT "PlayerHandle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
