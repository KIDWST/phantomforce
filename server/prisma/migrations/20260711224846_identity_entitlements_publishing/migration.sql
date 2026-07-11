-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('trial', 'active', 'grace', 'suspended');

-- CreateEnum
CREATE TYPE "SiteBuildStatus" AS ENUM ('building', 'validated', 'failed');

-- CreateEnum
CREATE TYPE "SiteDeploymentStatus" AS ENUM ('published', 'rolled_back', 'superseded');

-- CreateEnum
CREATE TYPE "DomainState" AS ENUM ('domain_entered', 'verification_required', 'dns_records_pending', 'verified', 'misconfigured', 'failed');

-- AlterEnum
ALTER TYPE "MembershipRole" ADD VALUE 'client';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeOrgId" TEXT,
ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'member',
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "features" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OrgPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'trial',
    "trialEndsAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "overrides" JSONB,
    "assignedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteBuild" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SiteBuildStatus" NOT NULL DEFAULT 'building',
    "contentPath" TEXT NOT NULL,
    "buildLog" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDeployment" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "status" "SiteDeploymentStatus" NOT NULL DEFAULT 'published',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "runId" TEXT,
    "receipt" JSONB NOT NULL,

    CONSTRAINT "SiteDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDomain" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "state" "DomainState" NOT NULL DEFAULT 'domain_entered',
    "verificationToken" TEXT NOT NULL,
    "sslState" TEXT NOT NULL DEFAULT 'unknown',
    "checkedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_orgId_email_idx" ON "Invitation"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "OrgPlan_orgId_key" ON "OrgPlan"("orgId");

-- CreateIndex
CREATE INDEX "OrgPlan_planKey_idx" ON "OrgPlan"("planKey");

-- CreateIndex
CREATE INDEX "UsageEvent_orgId_metric_at_idx" ON "UsageEvent"("orgId", "metric", "at");

-- CreateIndex
CREATE INDEX "Site_orgId_idx" ON "Site"("orgId");

-- CreateIndex
CREATE INDEX "SiteBuild_orgId_idx" ON "SiteBuild"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteBuild_siteId_version_key" ON "SiteBuild"("siteId", "version");

-- CreateIndex
CREATE INDEX "SiteDeployment_siteId_status_idx" ON "SiteDeployment"("siteId", "status");

-- CreateIndex
CREATE INDEX "SiteDeployment_orgId_idx" ON "SiteDeployment"("orgId");

-- CreateIndex
CREATE INDEX "SiteDomain_orgId_idx" ON "SiteDomain"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteDomain_siteId_domain_key" ON "SiteDomain"("siteId", "domain");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPlan" ADD CONSTRAINT "OrgPlan_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPlan" ADD CONSTRAINT "OrgPlan_planKey_fkey" FOREIGN KEY ("planKey") REFERENCES "Plan"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBuild" ADD CONSTRAINT "SiteBuild_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDeployment" ADD CONSTRAINT "SiteDeployment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDeployment" ADD CONSTRAINT "SiteDeployment_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "SiteBuild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDomain" ADD CONSTRAINT "SiteDomain_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
