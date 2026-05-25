import { z } from 'zod';
import { IDENT_RE, MEDALLION_SCHEMAS } from '../sql/focusView.sql.js';

/** Unquoted SQL identifier accepted as a catalog or schema name. */
export const CatalogIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(IDENT_RE, 'must match /^[A-Za-z_][A-Za-z0-9_]*$/');

export const CatalogSummarySchema = z.object({
  name: z.string().min(1),
  catalogType: z.string().nullable(),
  comment: z.string().nullable(),
});
export type CatalogSummary = z.infer<typeof CatalogSummarySchema>;

export const CatalogListResponseSchema = z.object({
  catalogs: z.array(CatalogSummarySchema),
});
export type CatalogListResponse = z.infer<typeof CatalogListResponseSchema>;

export const CatalogSchemaSummarySchema = z.object({
  name: z.string().min(1),
  fullName: z.string().nullable(),
  catalogName: z.string().nullable(),
  catalogType: z.string().nullable(),
  comment: z.string().nullable(),
});
export type CatalogSchemaSummary = z.infer<typeof CatalogSchemaSummarySchema>;

export const CatalogSchemaListResponseSchema = z.object({
  schemas: z.array(CatalogSchemaSummarySchema),
});
export type CatalogSchemaListResponse = z.infer<typeof CatalogSchemaListResponseSchema>;

export const CatalogTableSummarySchema = z.object({
  name: z.string().min(1),
  fullName: z.string().nullable(),
  catalogName: z.string().nullable(),
  schemaName: z.string().nullable(),
  tableType: z.string().nullable(),
  dataSourceFormat: z.string().nullable(),
  comment: z.string().nullable(),
});
export type CatalogTableSummary = z.infer<typeof CatalogTableSummarySchema>;

export const CatalogTableListResponseSchema = z.object({
  tables: z.array(CatalogTableSummarySchema),
});
export type CatalogTableListResponse = z.infer<typeof CatalogTableListResponseSchema>;

const SchemaEnsureStatus = z.enum(['ensured', 'error']);
export type SchemaEnsureStatus = z.infer<typeof SchemaEnsureStatus>;

/**
 * Outcome of a single GRANT step. Plain strings keep the contract trivially
 * stable as new "skipped" reasons are added without forcing a discriminated
 * union upgrade on the client.
 *
 *   `granted`               — GRANT executed successfully
 *   `skipped:<reason>`      — intentionally not attempted (e.g. SP not configured)
 *   `error:<message>`       — GRANT failed; message is the SQL error
 */
export const GrantStatusSchema = z.string();
export type GrantStatus = z.infer<typeof GrantStatusSchema>;

export const ProvisionResultSchema = z.object({
  catalog: CatalogIdentifierSchema,
  catalogCreated: z.boolean(),
  schemasEnsured: z.record(z.enum(MEDALLION_SCHEMAS), SchemaEnsureStatus),
  pricingSchemaEnsured: SchemaEnsureStatus,
  downloadsVolumeEnsured: SchemaEnsureStatus,
  grants: z.object({
    catalog: GrantStatusSchema,
    usersCatalog: GrantStatusSchema,
    bronze: GrantStatusSchema,
    silver: GrantStatusSchema,
    gold: GrantStatusSchema,
    pricingSchema: GrantStatusSchema,
    downloadsVolume: GrantStatusSchema,
    usersDownloadsVolume: GrantStatusSchema,
  }),
  servicePrincipalId: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type ProvisionResult = z.infer<typeof ProvisionResultSchema>;

export const ProvisionRequestSchema = z.object({
  createIfMissing: z.boolean().optional(),
});
export type ProvisionRequest = z.infer<typeof ProvisionRequestSchema>;
