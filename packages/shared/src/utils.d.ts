export declare function formatFileSize(bytes: number): string;
export declare function truncate(text: string, maxLength: number): string;
export declare function generateId(): string;
export declare function sleep(ms: number): Promise<void>;
export declare function retry<T>(
  fn: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
  },
): Promise<T>;
export declare function formatConfidence(confidence: number): string;
//# sourceMappingURL=utils.d.ts.map
