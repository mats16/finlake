import { z } from 'zod';
import { IDENT_RE } from '../sql/focusView.sql.js';

/** Stable id of the Databricks system-tables data source (also seeded in db). */
export const DATABRICKS_BILLING_SOURCE_ID = 'databricks-system-tables';

/** `app_settings` key holding the default Unity Catalog name. */
export const CATALOG_SETTING_KEY = 'catalog_name';

export const DataSourceIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(IDENT_RE, 'must match /^[A-Za-z_][A-Za-z0-9_]*$/');

export const DataSourceSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  description: z.string().max(2048).nullable(),
  provider: z.string().min(1).max(64),
  tier: DataSourceIdentifierSchema,
  tableName: DataSourceIdentifierSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  updatedAt: z.string().datetime(),
});
export type DataSource = z.infer<typeof DataSourceSchema>;

export const DataSourceUpdateBodySchema = z.object({
  name: z.string().min(1).max(256).optional(),
  description: z.string().max(2048).nullable().optional(),
  provider: z.string().min(1).max(64).optional(),
  tier: DataSourceIdentifierSchema.optional(),
  tableName: DataSourceIdentifierSchema.optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type DataSourceUpdateBody = z.infer<typeof DataSourceUpdateBodySchema>;
