import { ModerationProvider, RawVerdict, RawVerdictArraySchema } from "./types.js";

interface BatchTask {
  text: string;
  resolve: (value: RawVerdict) => void;
  reject: (reason: unknown) => void;
}

export class Batcher {
  private provider: ModerationProvider;
  private maxSize: number;
  private maxWaitMs: number;
  private compiledPolicy: string;
  private queue: BatchTask[] = [];
  private timeoutId: NodeJS.Timeout | null = null;
  private onApiCall: (success: boolean) => void;

  constructor(options: {
    provider: ModerationProvider;
    maxSize: number;
    maxWaitMs: number;
    compiledPolicy: string;
    onApiCall: (success: boolean) => void;
  }) {
    this.provider = options.provider;
    this.maxSize = options.maxSize;
    this.maxWaitMs = options.maxWaitMs;
    this.compiledPolicy = options.compiledPolicy;
    this.onApiCall = options.onApiCall;
  }

  add(text: string): Promise<RawVerdict> {
    return new Promise<RawVerdict>((resolve, reject) => {
      this.queue.push({ text, resolve, reject });

      if (this.queue.length >= this.maxSize) {
        this.flush();
      } else if (this.queue.length === 1) {
        this.startTimer();
      }
    });
  }

  private startTimer() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(() => {
      this.flush();
    }, this.maxWaitMs);
  }

  private async flush() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    const currentBatch = this.queue;
    this.queue = [];

    if (currentBatch.length === 0) {
      return;
    }

    try {
      const texts = currentBatch.map((item) => item.text);
      const results = await this.provider.moderateBatch(texts, this.compiledPolicy);

      // Validate with Zod
      const parsed = RawVerdictArraySchema.safeParse(results);
      if (!parsed.success || parsed.data.length !== currentBatch.length) {
        throw new Error("Invalid batch response structure or length mismatch");
      }

      this.onApiCall(true);

      for (let i = 0; i < currentBatch.length; i++) {
        currentBatch[i].resolve(parsed.data[i]);
      }
    } catch (error) {
      this.onApiCall(false);
      for (const item of currentBatch) {
        item.reject(error);
      }
    }
  }

  // Helper method to clear timers when disposing or in tests
  clear() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.queue = [];
  }
}
