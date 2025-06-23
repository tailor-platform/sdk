import { performanceConfig } from "./config";
import { performanceTracker } from "./tracker";
import type { MethodDecoratorContext, PerformanceMeasurement } from "./types";

export function measure<This, Args extends any[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: MethodDecoratorContext,
): (this: This, ...args: Args) => Return {
  if (!performanceConfig.enabled) {
    return target;
  }

  const methodName = String(context.name);
  const isStatic = context.static || false;

  if (isAsyncFunction(target)) {
    return function (this: This, ...args: Args): Return {
      const start = performance.now();
      const timestamp = Date.now();

      const className = isStatic
        ? (this as any).name || "Anonymous"
        : (this as any).constructor?.name || "Anonymous";

      const result = target.apply(this, args) as any;

      if (result && typeof result.then === "function") {
        return result
          .then((value: any) => {
            recordMeasurement(className, methodName, start, timestamp, true);
            return value;
          })
          .catch((error: any) => {
            recordMeasurement(
              className,
              methodName,
              start,
              timestamp,
              true,
              error,
            );
            throw error;
          }) as Return;
      }

      return result;
    } as (this: This, ...args: Args) => Return;
  }

  return function (this: This, ...args: Args): Return {
    const start = performance.now();
    const timestamp = Date.now();

    const className = isStatic
      ? (this as any).name || "Anonymous"
      : (this as any).constructor?.name || "Anonymous";

    try {
      const result = target.apply(this, args);
      recordMeasurement(className, methodName, start, timestamp, false);
      return result;
    } catch (error) {
      recordMeasurement(
        className,
        methodName,
        start,
        timestamp,
        false,
        error as Error,
      );
      throw error;
    }
  } as (this: This, ...args: Args) => Return;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function isAsyncFunction(fn: Function): boolean {
  return (
    fn.constructor.name === "AsyncFunction" ||
    (fn.toString().includes("async") && fn.toString().includes("__awaiter"))
  );
}

function recordMeasurement(
  className: string,
  methodName: string,
  startTime: number,
  timestamp: number,
  isAsync: boolean,
  error?: Error,
): void {
  const executionTime = performance.now() - startTime;

  if (
    performanceConfig.thresholdMs !== undefined &&
    executionTime < performanceConfig.thresholdMs
  ) {
    return;
  }

  const measurement: PerformanceMeasurement = {
    className,
    methodName,
    executionTime,
    timestamp,
    isAsync,
    error,
  };

  performanceTracker.recordMeasurement(measurement);

  if (performanceConfig.logLevel === "detailed") {
    const errorInfo = error ? ` [ERROR: ${error.message}]` : "";
    console.log(
      `[Performance] ${className}.${methodName}: ${executionTime.toFixed(
        2,
      )}ms${errorInfo}`,
    );
  }
}
