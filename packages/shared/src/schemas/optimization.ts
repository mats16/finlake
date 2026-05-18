import { z } from 'zod';

export const DatabricksOptimizationRangeSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  workspaceId: z.string().optional(),
});

export type DatabricksOptimizationRange = z.infer<typeof DatabricksOptimizationRangeSchema>;

export const DatabricksOptimizationSummarySchema = z.object({
  totalCostUsd: z.number(),
  serverlessCostUsd: z.number(),
  nonServerlessCostUsd: z.number(),
  unknownCostUsd: z.number(),
  serverlessRatio: z.number().nullable(),
  candidateResourceCount: z.number(),
});

export type DatabricksOptimizationSummary = z.infer<typeof DatabricksOptimizationSummarySchema>;

export const DatabricksOptimizationWorkspaceSchema = z.object({
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  totalCostUsd: z.number(),
  serverlessCostUsd: z.number(),
  nonServerlessCostUsd: z.number(),
  serverlessRatio: z.number().nullable(),
});

export type DatabricksOptimizationWorkspace = z.infer<typeof DatabricksOptimizationWorkspaceSchema>;

export const DatabricksOptimizationMonthlyRowSchema = z.object({
  month: z.string(),
  totalCostUsd: z.number(),
  serverlessCostUsd: z.number(),
  nonServerlessCostUsd: z.number(),
  unknownCostUsd: z.number(),
  serverlessRatio: z.number().nullable(),
});

export type DatabricksOptimizationMonthlyRow = z.infer<
  typeof DatabricksOptimizationMonthlyRowSchema
>;

export const DatabricksOptimizationServiceRowSchema = z.object({
  serviceCategory: z.string(),
  serviceName: z.string(),
  totalCostUsd: z.number(),
  serverlessCostUsd: z.number(),
  nonServerlessCostUsd: z.number(),
  serverlessRatio: z.number().nullable(),
});

export type DatabricksOptimizationServiceRow = z.infer<
  typeof DatabricksOptimizationServiceRowSchema
>;

export const DatabricksOptimizationRecommendationSchema = z.object({
  rank: z.number(),
  priority: z.enum(['high', 'medium', 'low']),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  serviceCategory: z.string(),
  serviceName: z.string(),
  resourceType: z.string().nullable(),
  resourceId: z.string(),
  resourceName: z.string().nullable(),
  skuId: z.string().nullable(),
  instanceType: z.string().nullable(),
  totalCostUsd: z.number(),
  nonServerlessCostUsd: z.number(),
  dbuQuantityEstimate: z.number().nullable(),
  serverlessSkuNameBase: z.string().nullable(),
  serverlessUnitPriceUsd: z.number().nullable(),
  estimatedServerlessCostUsd: z.number().nullable(),
  estimatedServerlessDeltaUsd: z.number().nullable(),
  ec2ReferenceInstanceType: z.string().nullable(),
  ec2HourlyPriceUsd: z.number().nullable(),
  estimatedEc2CostUsd: z.number().nullable(),
  estimatedCurrentTotalCostUsd: z.number().nullable(),
  serverlessRatio: z.number().nullable(),
});

export type DatabricksOptimizationRecommendation = z.infer<
  typeof DatabricksOptimizationRecommendationSchema
>;

export const DatabricksClusterUtilizationRowSchema = z.object({
  workspaceId: z.string().nullable(),
  clusterId: z.string(),
  cpuUtilizationPercent: z.number().nullable(),
});

export type DatabricksClusterUtilizationRow = z.infer<typeof DatabricksClusterUtilizationRowSchema>;

export const DatabricksQueryWarehouseTrendRowSchema = z.object({
  period: z.string(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  warehouseId: z.string(),
  warehouseName: z.string().nullable(),
  costUsd: z.number(),
});

export type DatabricksQueryWarehouseTrendRow = z.infer<
  typeof DatabricksQueryWarehouseTrendRowSchema
>;

export const DatabricksQueryAttributionRowSchema = z.object({
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  warehouseId: z.string(),
  warehouseName: z.string().nullable(),
  queryHash: z.string(),
  latestStatementId: z.string().nullable(),
  statementText: z.string(),
  statementType: z.string().nullable(),
  executedBy: z.string().nullable(),
  clientApplication: z.string().nullable(),
  executionStatus: z.string().nullable(),
  executionCount: z.number(),
  failedCount: z.number(),
  canceledCount: z.number(),
  queryExecutionMs: z.number(),
  avgExecutionMs: z.number().nullable(),
  maxExecutionMs: z.number().nullable(),
  warehouseQueryExecutionMs: z.number().nullable(),
  warehouseCostUsd: z.number().nullable(),
  allocatedCostUsd: z.number().nullable(),
  readBytes: z.number().nullable(),
  readRows: z.number().nullable(),
  producedRows: z.number().nullable(),
  spilledLocalBytes: z.number().nullable(),
  firstStartTime: z.string().nullable(),
  lastEndTime: z.string().nullable(),
});

export type DatabricksQueryAttributionRow = z.infer<typeof DatabricksQueryAttributionRowSchema>;

export const DatabricksOptimizationErrorSchema = z.object({
  tableName: z.string(),
  message: z.string(),
});

export type DatabricksOptimizationError = z.infer<typeof DatabricksOptimizationErrorSchema>;

export const DatabricksOptimizationResponseSchema = z.object({
  summary: DatabricksOptimizationSummarySchema,
  workspaces: z.array(DatabricksOptimizationWorkspaceSchema),
  monthly: z.array(DatabricksOptimizationMonthlyRowSchema),
  services: z.array(DatabricksOptimizationServiceRowSchema),
  recommendations: z.array(DatabricksOptimizationRecommendationSchema),
  errors: z.array(DatabricksOptimizationErrorSchema),
  generatedAt: z.string().datetime(),
});

export type DatabricksOptimizationResponse = z.infer<typeof DatabricksOptimizationResponseSchema>;
