import { z } from "zod";

// PostgreSQL's uuid type accepts UUID-shaped identifiers regardless of RFC version bits.
export const databaseId = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Invalid identifier"
);
