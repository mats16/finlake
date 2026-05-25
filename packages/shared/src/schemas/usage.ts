import { z } from 'zod';

export const UsageRangeSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  workspaceId: z.string().optional(),
  warehouseId: z.string().min(1).max(256).optional(),
});

export type UsageRange = z.infer<typeof UsageRangeSchema>;

export const UsageBySkuRowSchema = z.object({
  skuName: z.string(),
  costUsd: z.number(),
});

export type UsageBySkuRow = z.infer<typeof UsageBySkuRowSchema>;

export const UsageTopWorkloadRowSchema = z.object({
  workloadType: z.enum(['JOB', 'WAREHOUSE', 'CLUSTER', 'PIPELINE', 'OTHER']),
  workloadId: z.string().nullable(),
  workloadName: z.string().nullable(),
  costUsd: z.number(),
});

export type UsageTopWorkloadRow = z.infer<typeof UsageTopWorkloadRowSchema>;
