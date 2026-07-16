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
  private onApiCall: (success: boolean, textCount: number, totalTextLength: number) => void;

  constructor(options: {
    provider: ModerationProvider;
    maxSize: number;
    maxWaitMs: number;
    compiledPolicy: string;
    onApiCall: (success: boolean, textCount: number, totalTextLength: number) => void;
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
        this.flush().catch(() => {});
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
      this.flush().catch(() => {});
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

    const textCount = currentBatch.length;
    const totalTextLength = currentBatch.reduce((sum, item) => sum + item.text.length, 0);

    try {
      const texts = currentBatch.map((item) => item.text);
      const results = await this.provider.moderateBatch(texts, this.compiledPolicy);

      // Validate with Zod
      const parsed = RawVerdictArraySchema.safeParse(results);
      if (!parsed.success || parsed.data.length !== currentBatch.length) {
        throw new Error("Invalid batch response structure or length mismatch");
      }

      this.onApiCall(true, textCount, totalTextLength);

      for (let i = 0; i < currentBatch.length; i++) {
        currentBatch[i].resolve(parsed.data[i]);
      }
    } catch (error) {
      try {
        this.onApiCall(false, textCount, totalTextLength);
      } catch {
        // Prevent onApiCall exception from shadowing original error
      }
      for (const item of currentBatch) {
        item.reject(error);
      }
      throw error;
    }
  }

  // Helper method to clear timers when disposing or in tests
  /**
   * Clears the current batch queue and cancels the active timer.
   * Note: This does NOT abort or cancel any batch requests that are already in-flight.
   */
  clear() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.queue = [];
  }
}
