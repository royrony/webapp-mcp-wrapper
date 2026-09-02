// T018: Run store — persists extraction manifests, applied overrides, and validation
// runs across runs (needed by the refresh diff in US4 and the validate flow in US2).
//
// Design note: the plan specifies a SQLite file per extraction run. The native
// better-sqlite3 build is unavailable in this environment (no toolchain), so this
// implements the same behavioral contract with a dependency-free JSON document store,
// one `runs.json` per webappTarget directory. The store's public surface (save/load
// reports, record overrides, record validation runs, find prior run) is what the rest
// of the core depends on — swapping the backing engine later touches only this file.

import { promises as fs } from "node:fs";
import path from "node:path";

import type { DiscoveredFunctionality } from "../models/discovered-functionality.js";
import type { ExtractionReport } from "../models/extraction-report.js";
import type { ResolutionOverride } from "../models/resolution-override.js";
import type { ValidationRun } from "../models/validation-run.js";
import type { WebappTarget } from "../models/webapp-target.js";

interface PersistedRun {
  report: ExtractionReport;
  /** Full functionality snapshot for this run (superset of report.items). */
  functionality: DiscoveredFunctionality[];
}

interface StoreDocument {
  target: WebappTarget;
  runs: PersistedRun[];
  overrides: ResolutionOverride[];
  validationRuns: ValidationRun[];
}

export class RunStore {
  private constructor(
    private readonly filePath: string,
    private doc: StoreDocument,
  ) {}

  /** Open (or create) the store for a given target directory. */
  static async open(targetDir: string, target: WebappTarget): Promise<RunStore> {
    await fs.mkdir(targetDir, { recursive: true });
    const filePath = path.join(targetDir, "runs.json");
    let doc: StoreDocument;
    try {
      const raw = await fs.readFile(filePath, "utf8");
      doc = JSON.parse(raw) as StoreDocument;
      // Refresh the target record (lastExtractedAt etc. may change).
      doc.target = { ...doc.target, ...target, createdAt: doc.target.createdAt };
    } catch {
      doc = { target, runs: [], overrides: [], validationRuns: [] };
    }
    return new RunStore(filePath, doc);
  }

  get target(): WebappTarget {
    return this.doc.target;
  }

  /** Persist a completed extraction run (report + full functionality snapshot). */
  async saveRun(report: ExtractionReport, functionality: DiscoveredFunctionality[]): Promise<void> {
    this.doc.runs.push({ report, functionality });
    this.doc.target.lastExtractedAt = report.finishedAt;
    await this.flush();
  }

  /** The most recent run strictly before `beforeRunId`, or the latest overall if omitted. */
  priorRun(beforeRunId?: string): PersistedRun | undefined {
    if (this.doc.runs.length === 0) return undefined;
    if (!beforeRunId) return this.doc.runs[this.doc.runs.length - 1];
    const idx = this.doc.runs.findIndex((r) => r.report.runId === beforeRunId);
    if (idx <= 0) return undefined;
    return this.doc.runs[idx - 1];
  }

  latestRun(): PersistedRun | undefined {
    return this.doc.runs[this.doc.runs.length - 1];
  }

  runById(runId: string): PersistedRun | undefined {
    return this.doc.runs.find((r) => r.report.runId === runId);
  }

  allRuns(): readonly PersistedRun[] {
    return this.doc.runs;
  }

  /** Record applied resolution overrides (US2). */
  async recordOverrides(overrides: ResolutionOverride[]): Promise<void> {
    for (const o of overrides) {
      const existing = this.doc.overrides.findIndex((e) => e.identityKey === o.identityKey);
      if (existing >= 0) this.doc.overrides[existing] = o;
      else this.doc.overrides.push(o);
    }
    await this.flush();
  }

  appliedOverrides(): readonly ResolutionOverride[] {
    return this.doc.overrides.filter((o) => o.appliedAt != null);
  }

  async recordValidationRun(run: ValidationRun): Promise<void> {
    this.doc.validationRuns.push(run);
    await this.flush();
  }

  private async flush(): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(this.doc, null, 2), "utf8");
  }
}
