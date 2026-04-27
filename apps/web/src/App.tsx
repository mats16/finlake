import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './pages/Dashboard';
import { CostExplorer } from './pages/CostExplorer';
import { Budgets } from './pages/Budgets';
import { Settings } from './pages/Settings';
import { ConfigureLayout } from './pages/Configure/ConfigureLayout';
import { DataSources } from './pages/Configure/DataSources';
import { Stub } from './pages/Configure/Stub';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/explorer" element={<CostExplorer />} />
        <Route path="/budgets" element={<Budgets />} />

        <Route path="/configure" element={<ConfigureLayout />}>
          <Route index element={<Navigate to="data-sources" replace />} />
          <Route path="data-sources" element={<DataSources />} />
          <Route
            path="detection-rules"
            element={
              <Stub
                titleKey="configure.detectionRules.title"
                descKey="configure.detectionRules.desc"
              />
            }
          />
          <Route
            path="transformations"
            element={
              <Stub
                titleKey="configure.transformations.title"
                descKey="configure.transformations.desc"
              />
            }
          />
          <Route
            path="admin"
            element={<Stub titleKey="configure.admin.title" descKey="configure.admin.desc" />}
          />
        </Route>

        <Route path="/settings" element={<Settings />} />
        <Route path="/setup" element={<Navigate to="/configure/data-sources" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppShell>
  );
}
