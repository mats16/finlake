import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useBudgets, useCreateBudget } from '../api/hooks';
import type { CreateBudgetInput } from '@lakecost/shared';
import { useCurrencyUsd, useI18n } from '../i18n';

export function Budgets() {
  const { t } = useI18n();
  const formatUsd = useCurrencyUsd();
  const list = useBudgets();
  const create = useCreateBudget();
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [amountUsd, setAmountUsd] = useState(1000);
  const [scopeType, setScopeType] = useState<CreateBudgetInput['scopeType']>('workspace');
  const [scopeValue, setScopeValue] = useState('*');
  const [period, setPeriod] = useState<CreateBudgetInput['period']>('monthly');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({
      workspaceId: null,
      name,
      scopeType,
      scopeValue,
      amountUsd,
      period,
      thresholdsPct: [80, 100],
      notifyEmails: [],
    });
    setShowForm(false);
    setName('');
  };

  return (
    <>
      <PageHeader title={t('budgets.title')} subtitle={t('budgets.subtitle')} />
      <div className="card" style={{ marginBottom: 16 }}>
        <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? t('common.cancel') : t('budgets.newBudget')}
        </button>
        {showForm ? (
          <form
            onSubmit={onSubmit}
            style={{ marginTop: 16, display: 'grid', gap: 12, maxWidth: 480 }}
          >
            <input
              required
              placeholder={t('budgets.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
            <input
              required
              type="number"
              min={1}
              placeholder={t('budgets.amountPlaceholder')}
              value={amountUsd}
              onChange={(e) => setAmountUsd(Number(e.target.value))}
              style={inputStyle}
            />
            <select
              value={scopeType}
              onChange={(e) => setScopeType(e.target.value as CreateBudgetInput['scopeType'])}
              style={inputStyle}
            >
              <option value="account">{t('budgets.scope.account')}</option>
              <option value="workspace">{t('budgets.scope.workspace')}</option>
              <option value="sku">{t('budgets.scope.sku')}</option>
              <option value="tag">{t('budgets.scope.tag')}</option>
            </select>
            <input
              required
              placeholder={t('budgets.scope.valuePlaceholder')}
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              style={inputStyle}
            />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as CreateBudgetInput['period'])}
              style={inputStyle}
            >
              <option value="monthly">{t('budgets.period.monthly')}</option>
              <option value="quarterly">{t('budgets.period.quarterly')}</option>
            </select>
            <button type="submit" className="btn" disabled={create.isPending}>
              {create.isPending ? t('common.saving') : t('budgets.create')}
            </button>
            {create.isError ? (
              <div className="banner error">{(create.error as Error).message}</div>
            ) : null}
          </form>
        ) : null}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 14, color: 'var(--muted)' }}>
          {t('budgets.existing')}
        </h3>
        {list.isLoading ? (
          <div className="banner unknown">{t('common.loading')}</div>
        ) : !list.data || list.data.items.length === 0 ? (
          <div className="banner unknown">{t('budgets.empty')}</div>
        ) : (
          <table className="simple">
            <thead>
              <tr>
                <th>{t('budgets.columns.name')}</th>
                <th>{t('budgets.columns.scope')}</th>
                <th>{t('budgets.columns.period')}</th>
                <th style={{ textAlign: 'right' }}>{t('budgets.columns.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>
                    {b.scopeType}: {b.scopeValue}
                  </td>
                  <td>{t(`budgets.period.${b.period}`)}</td>
                  <td style={{ textAlign: 'right' }}>{formatUsd(b.amountUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 13,
};
