-- CreateTable
CREATE TABLE "Cars" (
    "id" SERIAL NOT NULL,
    "url" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price" INTEGER NOT NULL,
    "timePosted" TIMESTAMP(3),
    "location" TEXT NOT NULL,
    "mileage" INTEGER,
    "year" INTEGER,
    "timeAddedToDataBase" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Filters" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "minPrice" INTEGER,
    "maxPrice" INTEGER,
    "userId" TEXT NOT NULL,
    "maxYear" INTEGER,
    "minYear" INTEGER,
    "minMileage" INTEGER,
    "maxMileage" INTEGER,

    CONSTRAINT "Filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterListing" (
    "filterId" INTEGER NOT NULL,
    "listingId" INTEGER NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "FilterListing_pkey" PRIMARY KEY ("filterId","listingId")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_clerkId_key" ON "user"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- AddForeignKey
ALTER TABLE "Filters" ADD CONSTRAINT "Filters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilterListing" ADD CONSTRAINT "FilterListing_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "Filters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilterListing" ADD CONSTRAINT "FilterListing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Cars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
