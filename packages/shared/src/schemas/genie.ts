import { z } from 'zod';

export const LEGACY_GENIE_SPACE_SETTING_KEY = 'genie_space_id';
export const GENIE_SPACE_SETTING_KEY = LEGACY_GENIE_SPACE_SETTING_KEY;
export const GENIE_SPACE_PURPOSES = ['finops', 'perf'] as const;
export const DEFAULT_GENIE_SPACE_PURPOSE = 'finops';
export const PERF_GENIE_SPACE_PURPOSE = 'perf';

export const GenieSpacePurposeSchema = z.enum(GENIE_SPACE_PURPOSES);
export type GenieSpacePurpose = z.infer<typeof GenieSpacePurposeSchema>;

export const GenieSetupResponseSchema = z.object({
  spaceId: z.string().min(1),
  title: z.string().min(1),
  tableIdentifiers: z.array(z.string().min(1)),
  purpose: GenieSpacePurposeSchema.default(DEFAULT_GENIE_SPACE_PURPOSE),
});
export type GenieSetupResponse = z.infer<typeof GenieSetupResponseSchema>;

export const GenieSetupRequestSchema = z.object({
  warehouseId: z.string().min(1).max(256).optional(),
});
export type GenieSetupRequest = z.infer<typeof GenieSetupRequestSchema>;

export const GenieSpaceResponseSchema = z.object({
  purpose: GenieSpacePurposeSchema,
  spaceId: z.string().min(1).nullable(),
  createdAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type GenieSpaceResponse = z.infer<typeof GenieSpaceResponseSchema>;

export const GenieChatRequestSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
  conversationId: z.string().trim().min(1).optional(),
});
export type GenieChatRequest = z.infer<typeof GenieChatRequestSchema>;

export const GenieQueryResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
});
export type GenieQueryResult = z.infer<typeof GenieQueryResultSchema>;

export const GenieAttachmentSchema = z.object({
  id: z.string().nullable(),
  text: z.string().nullable(),
  sql: z.string().nullable(),
  queryResult: GenieQueryResultSchema.nullable(),
});
export type GenieAttachment = z.infer<typeof GenieAttachmentSchema>;

export const GenieChatResponseSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  status: z.string().min(1),
  answer: z.string().nullable(),
  attachments: z.array(GenieAttachmentSchema),
  authMode: z.enum(['obo', 'service_principal']),
});
export type GenieChatResponse = z.infer<typeof GenieChatResponseSchema>;
