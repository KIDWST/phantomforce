-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('image', 'video', 'audio', 'font', 'document', 'element', 'other');

-- CreateEnum
CREATE TYPE "AssetState" AS ENUM ('ready', 'processing', 'failed');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "folderId" TEXT,
    "title" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'other',
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "contentPath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "createdByUserId" TEXT,
    "tags" TEXT[],
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "brand" BOOLEAN NOT NULL DEFAULT false,
    "flags" JSONB,
    "state" "AssetState" NOT NULL DEFAULT 'processing',
    "processingError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "trashedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAssetVersion" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "contentPath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetFolder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCollection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCollectionItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetCollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetUsage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "refLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_orgId_createdAt_idx" ON "MediaAsset"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_orgId_kind_idx" ON "MediaAsset"("orgId", "kind");

-- CreateIndex
CREATE INDEX "MediaAsset_orgId_sha256_idx" ON "MediaAsset"("orgId", "sha256");

-- CreateIndex
CREATE INDEX "MediaAsset_orgId_trashedAt_archivedAt_idx" ON "MediaAsset"("orgId", "trashedAt", "archivedAt");

-- CreateIndex
CREATE INDEX "MediaAssetVersion_orgId_sha256_idx" ON "MediaAssetVersion"("orgId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAssetVersion_assetId_versionNumber_key" ON "MediaAssetVersion"("assetId", "versionNumber");

-- CreateIndex
CREATE INDEX "AssetFolder_orgId_parentId_idx" ON "AssetFolder"("orgId", "parentId");

-- CreateIndex
CREATE INDEX "AssetCollection_orgId_idx" ON "AssetCollection"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCollectionItem_collectionId_assetId_key" ON "AssetCollectionItem"("collectionId", "assetId");

-- CreateIndex
CREATE INDEX "AssetUsage_orgId_surface_refId_idx" ON "AssetUsage"("orgId", "surface", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetUsage_assetId_surface_refId_key" ON "AssetUsage"("assetId", "surface", "refId");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "AssetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAssetVersion" ADD CONSTRAINT "MediaAssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFolder" ADD CONSTRAINT "AssetFolder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCollection" ADD CONSTRAINT "AssetCollection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCollectionItem" ADD CONSTRAINT "AssetCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "AssetCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCollectionItem" ADD CONSTRAINT "AssetCollectionItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetUsage" ADD CONSTRAINT "AssetUsage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
