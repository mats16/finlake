import { z } from 'zod';

export const WorkspaceIdSchema = z.string().regex(/^\d{1,32}$/, 'invalid workspace id');

export const WorkspaceDomainSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform(domainFromInput)
  .pipe(z.string().regex(/^[A-Za-z0-9.-]+$/, 'invalid workspace domain'));

export const WorkspaceMappingSchema = z.object({
  id: WorkspaceIdSchema,
  domain: WorkspaceDomainSchema,
  updatedAt: z.string().datetime(),
});

export type WorkspaceMapping = z.infer<typeof WorkspaceMappingSchema>;

export const WorkspaceMappingUpsertBodySchema = z.object({
  domain: WorkspaceDomainSchema,
});

export type WorkspaceMappingUpsertBody = z.infer<typeof WorkspaceMappingUpsertBodySchema>;

function domainFromInput(input: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme).hostname;
  } catch {
    const [host = ''] = input.replace(/^https?:\/\//i, '').split(/[/?#]/, 1);
    return input ? host.replace(/\/+$/, '') : '';
  }
}
