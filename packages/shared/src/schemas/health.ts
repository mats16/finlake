import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  backend: z.enum(['lakebase', 'sqlite']),
  appName: z.string().optional(),
  workspaceId: z.string().optional(),
  uptimeSec: z.number(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
