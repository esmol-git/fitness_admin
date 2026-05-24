-- Keep one client per locker (earliest created), clear the rest before unique index.
UPDATE "Client" AS c
SET "lockerNumber" = NULL
WHERE c."lockerNumber" IS NOT NULL
  AND c.id <> (
    SELECT c2.id
    FROM "Client" AS c2
    WHERE c2."lockerNumber" = c."lockerNumber"
    ORDER BY c2."createdAt" ASC, c2.id ASC
    LIMIT 1
  );

CREATE UNIQUE INDEX "Client_lockerNumber_unique" ON "Client" ("lockerNumber")
WHERE "lockerNumber" IS NOT NULL;
