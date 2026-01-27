-- CreateTable
CREATE TABLE "instances" (
    "id" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "username" TEXT,
    "storageState" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instances_apiKey_key" ON "instances"("apiKey");
