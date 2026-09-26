/**
 * Consolidates the hashing utilities used by the planner.
 * The digest is computed over the canonicalized plan body so persisted artifacts can be validated
 * deterministically before they are approved.
 */
import { createHash } from "node:crypto";

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
