import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@databricks/appkit-ui/react';
import { Construction } from 'lucide-react';
import { useI18n } from '../../i18n';

export function Stub({ titleKey, descKey }: { titleKey: string; descKey: string }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
        <CardDescription>{t(descKey)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Alert>
          <Construction />
          <AlertDescription>{t('configure.stubBanner')}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
