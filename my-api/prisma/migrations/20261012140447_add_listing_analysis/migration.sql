-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'REJECTED_RULES', 'REJECTED_TRIAGE', 'ANALYSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('BUY', 'MAYBE', 'AVOID');

-- AlterTable
ALTER TABLE "Cars" ADD COLUMN     "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "triageCategory" "AnalysisStatus";

-- CreateTable
CREATE TABLE "ListingAnalysis" (
    "id" SERIAL NOT NULL,
    "listingId" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "recommendation" "Recommendation" NOT NULL,
    "summary" TEXT NOT NULL,
    "registration" TEXT,
    "conditionRating" INTEGER,
    "visibleDamage" TEXT,
    "motExpiry" TIMESTAMP(3),
    "mileageDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
    "advisories" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingAnalysis_listingId_key" ON "ListingAnalysis"("listingId");

-- AddForeignKey
ALTER TABLE "ListingAnalysis" ADD CONSTRAINT "ListingAnalysis_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Cars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
