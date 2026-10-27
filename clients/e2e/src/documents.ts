import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The synthetic documents and forms of the demo. They live in the direction repository, which
 * sits next to this one; VOWKEY_DEMO names their folder when it sits elsewhere.
 */
const DEMO_DIR = process.env.VOWKEY_DEMO ?? resolve(__dirname, "../../../../vowkey/Demo");

/** Where a demo document is. The suite fails when the folder is missing. */
export function demoDocument(name: string): string {
  const path = resolve(DEMO_DIR, "documents", name);
  if (!existsSync(path)) {
    throw new Error(
      `The demo document ${name} is not at ${path}; set VOWKEY_DEMO to the Demo folder.`,
    );
  }
  return path;
}

/** The corpus of public specimens, next to the demo. */
const CORPUS_DIR = process.env.VOWKEY_CORPUS ?? resolve(DEMO_DIR, "../corpus");

/** Where a specimen document of the corpus is, such as `nl/passport-2014-specimen.jpg`. */
export function specimen(name: string): string {
  const path = resolve(CORPUS_DIR, "documents/specimens", name);
  if (!existsSync(path)) {
    throw new Error(
      `The specimen ${name} is not at ${path}; set VOWKEY_CORPUS to the corpus folder.`,
    );
  }
  return path;
}
