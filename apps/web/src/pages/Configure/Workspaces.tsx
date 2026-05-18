import { useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import { AlertCircle, ExternalLink, Plus, Trash2 } from 'lucide-react';
import type { WorkspaceMapping } from '@finlake/shared';
import { useDeleteWorkspace, useMe, useUpsertWorkspace, useWorkspaces } from '../../api/hooks';
import { useI18n, useLocale, type Locale } from '../../i18n';
import { messageOf } from './utils';

export function Workspaces() {
  const { t } = useI18n();
  const locale = useLocale();
  const workspaces = useWorkspaces();
  const upsertWorkspace = useUpsertWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  const me = useMe();
  const workspaceUrl = me.data?.workspaceUrl;
  const currentDomain = useMemo(() => domainFromUrl(workspaceUrl), [workspaceUrl]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [domain, setDomain] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const rows = workspaces.data?.workspaces ?? [];
  const normalizedId = workspaceId.trim();
  const normalizedDomain = domain.trim();
  const validWorkspaceId = /^\d{1,32}$/.test(normalizedId);
  const canSubmit = validWorkspaceId && normalizedDomain.length > 0 && !upsertWorkspace.isPending;
  const listError = messageOf(workspaces.error);
  const saveError = messageOf(upsertWorkspace.error);
  const deleteError = messageOf(deleteWorkspace.error);

  const clearForm = () => {
    setWorkspaceId('');
    setDomain('');
    setEditingId(null);
    upsertWorkspace.reset();
  };

  const openCreateModal = () => {
    clearForm();
    setModalOpen(true);
  };

  const editRow = (row: WorkspaceMapping) => {
    upsertWorkspace.reset();
    setWorkspaceId(row.id);
    setDomain(row.domain);
    setEditingId(row.id);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    upsertWorkspace.reset();
  };

  const prefillCurrentWorkspace = () => {
    upsertWorkspace.reset();
    setWorkspaceId(me.data?.workspaceId ?? '');
    setDomain(currentDomain ?? '');
    setEditingId(me.data?.workspaceId ?? null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    upsertWorkspace.mutate(
      { id: normalizedId, body: { domain: normalizedDomain } },
      {
        onSuccess: () => {
          clearForm();
          setModalOpen(false);
        },
      },
    );
  };

  const onDelete = (id: string) => {
    if (!window.confirm(t('workspaces.deleteConfirm', { id }))) return;
    deleteWorkspace.mutate(id, {
      onSuccess: () => {
        if (editingId === id) {
          clearForm();
          setModalOpen(false);
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="m-0 text-base font-semibold">{t('workspaces.title')}</h3>
            <p className="text-muted-foreground mt-1 text-sm">{t('workspaces.desc')}</p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={openCreateModal}
            disabled={upsertWorkspace.isPending}
          >
            <Plus />
            {t('workspaces.add')}
          </Button>
        </div>

        {listError ? (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle />
            <AlertTitle>{t('workspaces.loadFailed')}</AlertTitle>
            <AlertDescription>{listError}</AlertDescription>
          </Alert>
        ) : null}

        {deleteError ? (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle />
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        ) : null}

        {workspaces.isLoading ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">{t('workspaces.emptyDesc')}</p>
        ) : (
          <WorkspaceMappingsTable
            rows={rows}
            locale={locale}
            deletingId={deleteWorkspace.isPending ? (deleteWorkspace.variables ?? null) : null}
            onEdit={editRow}
            onDelete={onDelete}
          />
        )}
      </section>
      <WorkspaceMappingModal
        open={modalOpen}
        editing={Boolean(editingId)}
        workspaceId={workspaceId}
        domain={domain}
        canSubmit={canSubmit}
        validWorkspaceId={validWorkspaceId}
        workspaceIdEdited={workspaceId.trim().length > 0}
        savePending={upsertWorkspace.isPending}
        saveError={saveError}
        canUseCurrentWorkspace={Boolean(me.data?.workspaceId && currentDomain)}
        onWorkspaceIdChange={setWorkspaceId}
        onDomainChange={setDomain}
        onUseCurrentWorkspace={prefillCurrentWorkspace}
        onSubmit={onSubmit}
        onClose={closeModal}
      />
    </div>
  );
}

function WorkspaceMappingModal({
  open,
  editing,
  workspaceId,
  domain,
  canSubmit,
  validWorkspaceId,
  workspaceIdEdited,
  savePending,
  saveError,
  canUseCurrentWorkspace,
  onWorkspaceIdChange,
  onDomainChange,
  onUseCurrentWorkspace,
  onSubmit,
  onClose,
}: {
  open: boolean;
  editing: boolean;
  workspaceId: string;
  domain: string;
  canSubmit: boolean;
  validWorkspaceId: boolean;
  workspaceIdEdited: boolean;
  savePending: boolean;
  saveError: string | null;
  canUseCurrentWorkspace: boolean;
  onWorkspaceIdChange: (value: string) => void;
  onDomainChange: (value: string) => void;
  onUseCurrentWorkspace: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {editing ? t('workspaces.updateTitle') : t('workspaces.addTitle')}
            </DialogTitle>
            <DialogDescription>{t('workspaces.modalDesc')}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="workspace-mapping-id">{t('workspaces.workspaceId')}</FieldLabel>
              <Input
                id="workspace-mapping-id"
                value={workspaceId}
                disabled={savePending || editing}
                placeholder={t('workspaces.workspaceIdPlaceholder')}
                onChange={(event) => onWorkspaceIdChange(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="workspace-mapping-domain">{t('workspaces.domain')}</FieldLabel>
              <Input
                id="workspace-mapping-domain"
                value={domain}
                disabled={savePending}
                placeholder={t('workspaceMapping.domainPlaceholder')}
                onChange={(event) => onDomainChange(event.target.value)}
              />
            </Field>
            {!editing && canUseCurrentWorkspace ? (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onUseCurrentWorkspace}
                  disabled={savePending}
                >
                  {t('workspaces.useCurrentWorkspace')}
                </Button>
              </div>
            ) : null}
            {!validWorkspaceId && workspaceIdEdited ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{t('workspaces.invalidWorkspaceId')}</AlertDescription>
              </Alert>
            ) : null}
            {saveError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={savePending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {savePending ? (
                <>
                  <Spinner /> {t('common.saving')}
                </>
              ) : (
                t(editing ? 'workspaces.update' : 'workspaces.add')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceMappingsTable({
  rows,
  locale,
  deletingId,
  onEdit,
  onDelete,
}: {
  rows: WorkspaceMapping[];
  locale: Locale;
  deletingId: string | null;
  onEdit: (row: WorkspaceMapping) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('workspaces.columns.workspaceId')}</TableHead>
            <TableHead>{t('workspaces.columns.domain')}</TableHead>
            <TableHead>{t('workspaces.columns.updatedAt')}</TableHead>
            <TableHead className="text-right" aria-label={t('workspaces.columns.actions')} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <code className="font-medium">{row.id}</code>
              </TableCell>
              <TableCell>
                <a
                  href={`https://${row.domain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary inline-flex max-w-96 items-center gap-1 truncate font-medium hover:underline"
                >
                  <span className="truncate">{row.domain}</span>
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                </a>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateTime(row.updatedAt, locale)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => onEdit(row)}>
                    {t('workspaces.edit')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => onDelete(row.id)}
                    disabled={deletingId === row.id}
                    aria-label={t('workspaces.delete')}
                    title={t('workspaces.delete')}
                  >
                    {deletingId === row.id ? (
                      <Spinner />
                    ) : (
                      <Trash2 className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function domainFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function formatDateTime(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
