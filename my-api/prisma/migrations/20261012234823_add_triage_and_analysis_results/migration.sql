/*
  Warnings:

  - The `triageCategory` column on the `Cars` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `conditionRating` on the `ListingAnalysis` table. All the data in the column will be lost.
  - You are about to drop the column `visibleDamage` on the `ListingAnalysis` table. All the data in the column will be lost.
  - Added the required column `confidence` to the `ListingAnalysis` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TriageCategory" AS ENUM ('GENUINE_SALE', 'SPARES_OR_REPAIRS', 'BREAKING_FOR_PARTS', 'WANTED_AD', 'WRITE_OFF', 'SCAM_SUSPECTED', 'NOT_A_CAR');

-- CreateEnum
CREATE TYPE "AnalysisConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "Cars" ADD COLUMN     "triageConfidence" DOUBLE PRECISION,
ADD COLUMN     "triageReason" TEXT,
DROP COLUMN "triageCategory",
ADD COLUMN     "triageCategory" "TriageCategory";

-- AlterTable
ALTER TABLE "ListingAnalysis" DROP COLUMN "conditionRating",
DROP COLUMN "visibleDamage",
ADD COLUMN     "confidence" "AnalysisConfidence" NOT NULL,
ADD COLUMN     "positives" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "redFlags" TEXT[] DEFAULT ARRAY[]::TEXT[];
