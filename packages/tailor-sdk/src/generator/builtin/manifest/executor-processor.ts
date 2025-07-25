import path from "node:path";
import {
  Executor,
  FunctionOperation,
  Trigger,
  Target,
  ExecutorManifest,
} from "@/services/executor/types";
import { Script } from "@/types/types";
import { measure } from "@/performance";
import { getDistDir } from "@/config";

/**
 * Executor処理用のメタデータ
 */
export interface ExecutorManifestMetadata {
  name: string;
  description?: string;
  trigger: Trigger;
  target: Target;
  executorManifest: ExecutorManifest;
  usedTailorDBType?: string;
}

/**
 * Executor処理ロジック
 * Executorを解析してManifestメタデータを生成
 */
export class ExecutorProcessor {
  /**
   * Executorを処理してExecutorManifestMetadataを生成
   */
  @measure
  static async processExecutor(
    executor: Executor,
  ): Promise<ExecutorManifestMetadata> {
    const metadata: Partial<ExecutorManifestMetadata> = {
      name: executor.name,
      description: executor.description,
      trigger: executor.trigger.manifest,
      target: executor.exec.manifest,
    };

    // EventTriggerのcontextからタイプ名を抽出
    const triggerContext = executor.trigger.context;
    if ("type" in triggerContext && triggerContext.type) {
      metadata.usedTailorDBType = triggerContext.type;
    }

    // ExecutorをManifest形式に変換
    metadata.executorManifest = ExecutorProcessor.convertToManifest(executor);

    return metadata as ExecutorManifestMetadata;
  }

  /**
   * ExecutorをManifest形式に変換
   */
  private static convertToManifest(executor: Executor): {
    Name: string;
    Description?: string;
    Trigger: Trigger;
    Target: Target;
  } {
    const manifest: Partial<ExecutorManifest> = {
      Name: executor.name,
      Description: executor.description,
    };

    // manifest/context構造から直接manifestを取得
    const trigger = executor.trigger.manifest;
    const target = executor.exec.manifest;

    // Trigger種別の振り分け
    const triggerKind = trigger.Kind;
    switch (triggerKind) {
      case "Schedule":
        manifest.TriggerSchedule = trigger;
        break;
      case "Event":
        manifest.TriggerEvent = trigger;
        break;
      case "IncomingWebhook":
        manifest.TriggerIncomingWebhook = trigger;
        break;
    }

    // Target種別の振り分け
    const targetKind = target.Kind;
    switch (targetKind) {
      case "webhook": {
        // WebhookOperationの場合、Headersの形式を調整
        const webhookOp = { ...target };
        if (webhookOp.Headers) {
          webhookOp.Headers = webhookOp.Headers.map((header) => {
            if (typeof header.Value === "string") {
              return {
                Key: header.Key,
                RawValue: header.Value,
              };
            } else {
              return {
                Key: header.Key,
                SecretValue: header.Value,
              };
            }
          });
        }

        manifest.TargetWebhook = webhookOp;
        break;
      }
      case "graphql":
        manifest.TargetTailorGraphql = target;
        break;
      case "function": {
        const functionOp = { ...target } as FunctionOperation;
        // Set the ScriptPath to the bundled executor file
        functionOp.ScriptPath = path.join(
          getDistDir(),
          "executors",
          `${executor.name}.js`,
        );
        if ("variables" in executor.trigger.context) {
          functionOp.Variables = {
            Expr: (executor.trigger.context.variables as Script).expr,
          };
        }
        manifest.TargetFunction = functionOp;
        break;
      }
    }

    // Trigger と Target を設定
    manifest.Trigger = trigger;
    manifest.Target = target;

    return manifest as ExecutorManifest;
  }
}
