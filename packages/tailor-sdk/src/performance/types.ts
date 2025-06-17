export interface PerformanceMeasurement {
  className: string;
  methodName: string;
  executionTime: number;
  timestamp: number;
  isAsync: boolean;
  error?: Error;
}

export interface PerformanceStats {
  className: string;
  methodName: string;
  callCount: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  lastCalled: number;
}

export interface PerformanceConfig {
  enabled: boolean;
  logLevel?: "summary" | "detailed";
  thresholdMs?: number;
}

export type MethodDecoratorContext =
  | ClassMethodDecoratorContext
  | ClassGetterDecoratorContext
  | ClassSetterDecoratorContext;
