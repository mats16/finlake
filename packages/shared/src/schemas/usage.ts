import { z } from 'zod';

export const UsageRangeSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  workspaceId: z.string().optional(),
});

export type UsageRange = z.infer<typeof UsageRangeSchema>;

export const UsageDailyRowSchema = z.object({
  usageDate: z.string(),
  skuName: z.string(),
  workspaceId: z.string().nullable(),
  costUsd: z.number(),
});

export type UsageDailyRow = z.infer<typeof UsageDailyRowSchema>;

export const UsageDailyResponseSchema = z.object({
  rows: z.array(UsageDailyRowSchema),
  totalUsd: z.number(),
  cachedAt: z.string().datetime().nullable(),
});

export type UsageDailyResponse = z.infer<typeof UsageDailyResponseSchema>;

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
