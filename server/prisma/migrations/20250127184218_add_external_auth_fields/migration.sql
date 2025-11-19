-- AlterTable: Add external auth fields to users table
-- SQLite has limited ALTER TABLE support, so we use ALTER TABLE ... ADD COLUMN

-- Make password nullable for external-only users
-- Note: SQLite doesn't support modifying column constraints directly,
-- but NULL values are already allowed if the column is not marked as NOT NULL
-- We'll use a default empty string for existing records and allow NULL going forward

-- Add externalId column
ALTER TABLE "users" ADD COLUMN "externalId" TEXT;

-- Add externalProvider column  
ALTER TABLE "users" ADD COLUMN "externalProvider" TEXT;

-- Create unique index on externalId and externalProvider
-- SQLite unique constraints on nullable columns allow multiple NULLs
CREATE UNIQUE INDEX "users_externalId_externalProvider_key" ON "users"("externalId", "externalProvider");

-- Create index for faster lookups
CREATE INDEX "users_externalId_externalProvider_idx" ON "users"("externalId", "externalProvider");



