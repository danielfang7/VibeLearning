import * as fs from 'fs';
import * as path from 'path';

export interface AnalyticsEvent {
  timestamp: string;
  interventionType: string;
  triggerReason: string;
  answered: boolean;
  skipped: boolean;
  attempted?: boolean;  // architecture_check: user engaged but did not submit
  score: number | null;
  apiLatencyMs: number;
  approxTokens: number;
}

export class AnalyticsLog {
  private filePath: string;

  constructor(globalStoragePath: string) {
    fs.mkdirSync(globalStoragePath, { recursive: true });
    this.filePath = path.join(globalStoragePath, 'analytics.jsonl');
  }

  append(event: AnalyticsEvent): void {
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf-8');
    } catch {
      // analytics are best-effort — never throw
    }
  }
}
