import { createHash } from "crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { DecisionCatalogModel, DecisionCustomModel, DecisionModelRole } from "../types/capture";

export interface CatalogModelSpec {
  id: string;
  name: string;
  role?: DecisionModelRole;
  blurbKey: string;
  languages: "multilingual" | "english";
  accuracyPercent: number;
  decisionScore: number;
  memoryBytes: number;
  paramsLabel: string;
  repository: string;
  revision: string;
  filename: string;
  bytes: number;
  sha256: string;
  license: "apache-2.0" | "mit";
  perRequest: number;
}

export interface VerificationReceipt {
  bytes: number;
  sha256: string;
  mtimeMs: number;
}

export interface StoredDecisionModelEntry {
  id: string;
  name: string;
  filePath: string;
}

export interface StoredDecisionModelsConfig {
  selectedModelId?: string;
  activeModelId?: string | null;
  customModels?: StoredDecisionModelEntry[];
}

export const DEFAULT_DECISION_MODEL_ID = "vllm-d3-mini";

const GB = 1_000_000_000;
const MB = 1_000_000;

export const DECISION_MODEL_CATALOG: readonly CatalogModelSpec[] = [
  {
    id: "vllm-d3-mini",
    name: "vLLM d3-mini",
    role: "recommended",
    blurbKey: "vkModelBlurbD3Mini",
    languages: "multilingual",
    accuracyPercent: 72.6,
    decisionScore: 50.0,
    memoryBytes: Math.round(4.4 * GB),
    paramsLabel: "4.8B",
    repository: "ggml-org/vllm-d3-mini-GGUF",
    revision: "8b29fd3b87373ea85fa59cc2f26251c1591d771a",
    filename: "vllm-d3-mini-Q4_K_M.gguf",
    bytes: 3_707_523_584,
    sha256: "1e5e5a87dd6903b6d8585331eee94a2f01d5069e369b143e1dceb9de51ba2902",
    license: "apache-2.0",
    perRequest: 24,
  },
  {
    id: "elephant-1",
    name: "Elephant-1",
    role: "most_accurate",
    blurbKey: "vkModelBlurbElephant1",
    languages: "multilingual",
    accuracyPercent: 80.1,
    decisionScore: 60.3,
    memoryBytes: Math.round(6.4 * GB),
    paramsLabel: "9.0B",
    repository: "waseigo/elephant-1-decision-GGUF",
    revision: "6494b79c57cdac75edccf3661889975618175b3b",
    filename: "elephant-1-Q4_K_M.gguf",
    bytes: 5_629_111_648,
    sha256: "5bc2a8f7c707da1680b49a3984a762478733f894eb38c9b4d07babf2f0004b6a",
    license: "mit",
    perRequest: 24,
  },
  {
    id: "vllm-d3-edge",
    name: "vLLM d3-edge",
    role: "fastest",
    blurbKey: "vkModelBlurbD3Edge",
    languages: "multilingual",
    accuracyPercent: 54.5,
    decisionScore: 17.7,
    memoryBytes: Math.round(1.2 * GB),
    paramsLabel: "0.8B",
    repository: "ggml-org/vllm-d3-edge-GGUF",
    revision: "83b6dacde181a41ea143cd627c0495dc0dee9ba1",
    filename: "vllm-d3-edge-Q8_0.gguf",
    bytes: 806_232_448,
    sha256: "b6eb2cd2128cc30930d5d235c85332ae7f6e9a676f93fcad26f742d30bc8ff29",
    license: "apache-2.0",
    perRequest: 20,
  },
  {
    id: "vllm-d3-lite",
    name: "vLLM d3-lite",
    blurbKey: "vkModelBlurbD3Lite",
    languages: "multilingual",
    accuracyPercent: 61.4,
    decisionScore: 26.2,
    memoryBytes: Math.round(1.5 * GB),
    paramsLabel: "1.0B",
    repository: "ggml-org/vllm-d3-lite-GGUF",
    revision: "d4d6ebde7717eb37014a1c7401127fb48f26da42",
    filename: "vllm-d3-lite-Q8_0.gguf",
    bytes: 1_082_017_344,
    sha256: "ffed04a9607034d641b95181d79abf36bec3a03ed647949bad8277d0e2984ddf",
    license: "apache-2.0",
    perRequest: 20,
  },
  {
    id: "vllm-d3-nano",
    name: "vLLM d3-nano",
    blurbKey: "vkModelBlurbD3Nano",
    languages: "multilingual",
    accuracyPercent: 65.4,
    decisionScore: 34.3,
    memoryBytes: Math.round(3.1 * GB),
    paramsLabel: "2.4B",
    repository: "ggml-org/vllm-d3-nano-GGUF",
    revision: "50dea2057df10c4b393559a155ab3bf0bc7532c6",
    filename: "vllm-d3-nano-Q8_0.gguf",
    bytes: 2_552_358_464,
    sha256: "4867d306fd22aec8c5ebd1851b7f1074f480702655e8000ceedf0c47c6a6f337",
    license: "apache-2.0",
    perRequest: 24,
  },
  {
    id: "lev-4b",
    name: "lev 4B",
    blurbKey: "vkModelBlurbLev4B",
    languages: "multilingual",
    accuracyPercent: 63.7,
    decisionScore: 35.5,
    memoryBytes: Math.round(3.6 * GB),
    paramsLabel: "4.2B",
    repository: "ggml-org/lev-GGUF",
    revision: "2ef3b3c3ab3defcab1058ab34cac52c467fa9304",
    filename: "lev-Q4_K_M.gguf",
    bytes: 3_032_093_632,
    sha256: "bff94af408cc9ea616dd2543abf77afacefeec27d32d635ebe0ed0eb7ccd7efe",
    license: "apache-2.0",
    perRequest: 24,
  },
  {
    id: "kev-4b",
    name: "Kev 4B",
    blurbKey: "vkModelBlurbKev4B",
    languages: "multilingual",
    accuracyPercent: 62.5,
    decisionScore: 34.9,
    memoryBytes: Math.round(3.6 * GB),
    paramsLabel: "4.2B",
    repository: "ggml-org/Kev-4B-GGUF",
    revision: "f4624b6bb7072f1bab726a622c1cad3f96030b9e",
    filename: "Kev-4B-Q4_K_M.gguf",
    bytes: 3_033_489_824,
    sha256: "33ae6b18926502b2209a1bf7d3b61a350d65938441515c686bb87d226a19eff9",
    license: "apache-2.0",
    perRequest: 24,
  },
  {
    id: "vllm-d3-flash",
    name: "vLLM d3-flash",
    blurbKey: "vkModelBlurbD3Flash",
    languages: "multilingual",
    accuracyPercent: 73.7,
    decisionScore: 54.3,
    memoryBytes: Math.round(7.4 * GB),
    paramsLabel: "9.0B",
    repository: "ggml-org/vllm-d3-flash-GGUF",
    revision: "50a0b7585fb8732fce67a921fab83ed2ac6e2fcb",
    filename: "vllm-d3-flash-Q4_K_M.gguf",
    bytes: 6_603_024_864,
    sha256: "60bb6a420048731c64315fc4f1959845ae98cda6e718a2029dfd5c90fd1d8b7c",
    license: "apache-2.0",
    perRequest: 24,
  },
  {
    id: "clef-flash",
    name: "Clef Flash",
    blurbKey: "vkModelBlurbClefFlash",
    languages: "multilingual",
    accuracyPercent: 75.6,
    decisionScore: 44.4,
    memoryBytes: Math.round(7.5 * GB),
    paramsLabel: "9.1B",
    repository: "ggml-org/Clef-Flash-GGUF",
    revision: "a5a18a6e13bb36573a5f11385a1e7b9a0c868e9e",
    filename: "Clef-Flash-Q4_K_M.gguf",
    bytes: 6_732_781_824,
    sha256: "eef2968c238a80d49d340430f22410ea3db9934ad1c6fdb233a503cbf9a9b54e",
    license: "apache-2.0",
    perRequest: 24,
  },
  {
    id: "pplx-decider-27b",
    name: "PPLX Decider 27B",
    blurbKey: "vkModelBlurbPplx27B",
    languages: "multilingual",
    accuracyPercent: 78.8,
    decisionScore: 68.0,
    memoryBytes: Math.round(17.2 * GB),
    paramsLabel: "27B",
    repository: "turintech/pplx-decider-27B-Artemis-GGUF",
    revision: "73579d07957b9e2185f4d4435bef30398a86b4ca",
    filename: "pplx-decider-27B-Artemis-Q4_K_S.gguf",
    bytes: 15_277_314_144,
    sha256: "9e23efec609fa777dc216d9b51f3e74bb473f6aa4163c2be8bd87f0ef5e7808a",
    license: "apache-2.0",
    perRequest: 24,
  },
  {
    id: "vllm-d3-27b",
    name: "vLLM d3 27B",
    blurbKey: "vkModelBlurbD327B",
    languages: "multilingual",
    accuracyPercent: 77.7,
    decisionScore: 67.2,
    memoryBytes: Math.round(21.2 * GB),
    paramsLabel: "27B",
    repository: "ggml-org/vllm-d3-GGUF",
    revision: "992fe43f6e2f6e623f9c0c10ab9667c0ea56ed47",
    filename: "vllm-d3-Q4_K_M.gguf",
    bytes: 19_403_686_208,
    sha256: "2b6823fe1f1e2866f313b21922304d3a8037cceb1d68274ca258292832505009",
    license: "apache-2.0",
    perRequest: 24,
  },
  {
    id: "julia-1",
    name: "Julia-1",
    blurbKey: "vkModelBlurbJulia1",
    languages: "english",
    accuracyPercent: 37.4,
    decisionScore: 4.8,
    memoryBytes: 400 * MB,
    paramsLabel: "0.14B",
    repository: "ggml-org/Julia-1-GGUF",
    revision: "1e6b48a6983d7467f8eedc2cb0d21267b5fc052d",
    filename: "Julia-1-Q8_0.gguf",
    bytes: 168_166_496,
    sha256: "1ea6a7e87156eeeda88cb7a36a61265b37ba7b993897b7289b99aea5b5e47069",
    license: "apache-2.0",
    perRequest: 16,
  },
];

export function resolveModelDownloadUrl(spec: CatalogModelSpec): string {
  const base = (process.env.VOWKEY_HF_BASE_URL || "https://huggingface.co").replace(/\/+$/, "");
  return `${base}/${spec.repository}/resolve/${spec.revision}/${spec.filename}`;
}

export function modelFilePath(modelsDir: string, spec: CatalogModelSpec): string {
  return path.join(modelsDir, spec.id, spec.filename);
}

export function receiptPathFor(filePath: string): string {
  return `${filePath}.receipt.json`;
}

export async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    const onAbort = () => {
      stream.destroy(new DOMException("Aborted", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) {
        stream.destroy();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    stream.on("end", () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(hash.digest("hex"));
    });
  });
}

export function hasVerifiedReceiptSync(
  filePath: string,
  expectedBytes: number,
  expectedSha256: string,
): boolean {
  try {
    if (!existsSync(filePath)) {
      return false;
    }
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size !== expectedBytes) {
      return false;
    }
    const receiptFile = receiptPathFor(filePath);
    if (!existsSync(receiptFile)) {
      return false;
    }
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as Partial<VerificationReceipt>;
    return (
      receipt.bytes === expectedBytes &&
      receipt.sha256?.toLowerCase() === expectedSha256.toLowerCase() &&
      receipt.mtimeMs === Math.trunc(stat.mtimeMs)
    );
  } catch {
    return false;
  }
}

export async function writeVerificationReceipt(filePath: string, sha256: string): Promise<void> {
  const stat = await fs.stat(filePath);
  const receipt: VerificationReceipt = {
    bytes: stat.size,
    sha256: sha256.toLowerCase(),
    mtimeMs: Math.trunc(stat.mtimeMs),
  };
  await fs.writeFile(receiptPathFor(filePath), JSON.stringify(receipt, null, 2), "utf8");
}

export function huggingFaceCacheRoots(): string[] {
  const candidates = [
    process.env.HF_HUB_CACHE?.trim(),
    process.env.HF_HOME?.trim() ? path.join(process.env.HF_HOME.trim(), "hub") : undefined,
    path.join(os.homedir(), ".cache", "huggingface", "hub"),
  ].filter((dir): dir is string => Boolean(dir));
  return [...new Set(candidates.map((dir) => path.resolve(dir)))];
}

export function findCachedCatalogModel(
  spec: CatalogModelSpec,
  roots: readonly string[] = huggingFaceCacheRoots(),
): string | undefined {
  const repoFolder = `models--${spec.repository.replace(/\//g, "--")}`;
  for (const root of roots) {
    const snapshotsDir = path.join(root, repoFolder, "snapshots");
    if (!existsSync(snapshotsDir)) {
      continue;
    }
    const pinnedCandidate = path.join(snapshotsDir, spec.revision, spec.filename);
    if (matchesSizeSync(pinnedCandidate, spec.bytes)) {
      return pinnedCandidate;
    }
    try {
      for (const rev of readdirSync(snapshotsDir)) {
        const candidate = path.join(snapshotsDir, rev, spec.filename);
        if (matchesSizeSync(candidate, spec.bytes)) {
          return candidate;
        }
      }
    } catch {
      // Unreadable cache folders are skipped silently.
    }
  }
  return undefined;
}

function matchesSizeSync(filePath: string, expectedBytes: number): boolean {
  try {
    const stat = statSync(filePath);
    return stat.isFile() && stat.size === expectedBytes;
  } catch {
    return false;
  }
}

export async function validateGgufFile(filePath: string): Promise<{
  canonicalPath: string;
  bytes: number;
  id: string;
  name: string;
}> {
  const canonicalPath = await fs.realpath(filePath);
  const stat = await fs.stat(canonicalPath);
  if (!stat.isFile() || stat.size < 64) {
    throw new Error("Choose a valid GGUF model file.");
  }
  const handle = await fs.open(canonicalPath, "r");
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, 8, 0);
    if (bytesRead < 8 || header.subarray(0, 4).toString("ascii") !== "GGUF") {
      throw new Error("This file is not a GGUF model.");
    }
    const version = header.readUInt32LE(4);
    if (version < 2 || version > 4) {
      throw new Error(`Unsupported GGUF version (${version}).`);
    }
  } finally {
    await handle.close();
  }
  const digest = createHash("sha256").update(canonicalPath).digest("hex").slice(0, 16);
  const stem = path.basename(canonicalPath, path.extname(canonicalPath)).trim() || "Custom model";
  return {
    canonicalPath,
    bytes: stat.size,
    id: `custom-${digest}`,
    name: stem,
  };
}

export function materializeCatalogModels(
  modelsDir: string,
  cacheRoots: readonly string[] = huggingFaceCacheRoots(),
): DecisionCatalogModel[] {
  return DECISION_MODEL_CATALOG.map((spec) => {
    const target = modelFilePath(modelsDir, spec);
    const installed = hasVerifiedReceiptSync(target, spec.bytes, spec.sha256);
    const foundPath = installed ? undefined : findCachedCatalogModel(spec, cacheRoots);
    return {
      ...spec,
      installed,
      ...(foundPath ? { foundPath } : {}),
    };
  });
}

export function materializeCustomModels(
  entries: readonly StoredDecisionModelEntry[],
): DecisionCustomModel[] {
  return entries.map((entry) => {
    let bytes = 0;
    let missing = true;
    try {
      const stat = statSync(entry.filePath);
      if (stat.isFile()) {
        bytes = stat.size;
        missing = false;
      }
    } catch {
      missing = true;
    }
    return {
      id: entry.id,
      name: entry.name,
      filePath: entry.filePath,
      parentFolder: path.basename(path.dirname(entry.filePath)) || path.dirname(entry.filePath),
      bytes,
      missing,
    };
  });
}
