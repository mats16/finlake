import { z } from 'zod';

export const SetupStepIdSchema = z.enum([
  'systemTables',
  'permissions',
  'awsCur',
  'azureExport',
  'tagging',
]);
export type SetupStepId = z.infer<typeof SetupStepIdSchema>;

export const SetupStepStatusSchema = z.enum(['ok', 'warning', 'error', 'unknown']);
export type SetupStepStatus = z.infer<typeof SetupStepStatusSchema>;

export const SetupCheckResultSchema = z.object({
  step: SetupStepIdSchema,
  status: SetupStepStatusSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  remediation: z
    .object({
      sql: z.string().optional(),
      curl: z.string().optional(),
      terraform: z.string().optional(),
      cli: z.string().optional(),
    })
    .optional(),
  checkedAt: z.string().datetime(),
});

export type SetupCheckResult = z.infer<typeof SetupCheckResultSchema>;

export const SetupStateResponseSchema = z.object({
  workspaceId: z.string(),
  steps: z.array(SetupCheckResultSchema),
});

export type SetupStateResponse = z.infer<typeof SetupStateResponseSchema>;
