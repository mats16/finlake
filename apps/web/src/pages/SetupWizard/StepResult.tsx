import type { SetupCheckResult } from '@lakecost/shared';
import { CodeBlock } from '../../components/CodeBlock';
import { useI18n } from '../../i18n';

export function StepResult({ result }: { result: SetupCheckResult | null | undefined }) {
  if (!result) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div className={`banner ${result.status}`}>
        <strong>{result.status.toUpperCase()}</strong> — {result.message}
      </div>
      {result.remediation ? <Remediation result={result} /> : null}
    </div>
  );
}

function Remediation({ result }: { result: SetupCheckResult }) {
  const { t } = useI18n();
  const r = result.remediation;
  if (!r) return null;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {r.sql ? (
        <div>
          <h4 style={labelStyle}>{t('stepResult.sql')}</h4>
          <CodeBlock>{r.sql}</CodeBlock>
        </div>
      ) : null}
      {r.terraform ? (
        <div>
          <h4 style={labelStyle}>{t('stepResult.terraform')}</h4>
          <CodeBlock>{r.terraform}</CodeBlock>
        </div>
      ) : null}
      {r.cli ? (
        <div>
          <h4 style={labelStyle}>{t('stepResult.cli')}</h4>
          <CodeBlock>{r.cli}</CodeBlock>
        </div>
      ) : null}
      {r.curl ? (
        <div>
          <h4 style={labelStyle}>{t('stepResult.rest')}</h4>
          <CodeBlock>{r.curl}</CodeBlock>
        </div>
      ) : null}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 11,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};
