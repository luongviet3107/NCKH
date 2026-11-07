import { Suspense, lazy, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout'

const AgentsPage = lazy(() => import('./pages/AgentsPage').then((module) => ({ default: module.AgentsPage })))
const CustomersPage = lazy(() =>
  import('./pages/CustomersPage').then((module) => ({ default: module.CustomersPage })),
)
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
)
const DataPage = lazy(() => import('./pages/DataPage').then((module) => ({ default: module.DataPage })))
const InventoryPage = lazy(() =>
  import('./pages/InventoryPage').then((module) => ({ default: module.InventoryPage })),
)
const ModelsPage = lazy(() => import('./pages/ModelsPage').then((module) => ({ default: module.ModelsPage })))
const ProductsPage = lazy(() =>
  import('./pages/ProductsPage').then((module) => ({ default: module.ProductsPage })),
)
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const RevenuePage = lazy(() => import('./pages/RevenuePage').then((module) => ({ default: module.RevenuePage })))
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)

function PageLoading() {
  return (
    <div className="space-y-4 py-6" aria-label="Đang tải trang">
      <div className="skeleton h-9 w-64" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="skeleton h-24 rounded-2xl" />
        ))}
      </div>
      <div className="skeleton h-72 rounded-2xl" />
    </div>
  )
}

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>
}

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Page><DashboardPage /></Page>} />
        <Route path="revenue" element={<Page><RevenuePage /></Page>} />
        <Route path="products" element={<Page><ProductsPage /></Page>} />
        <Route path="inventory" element={<Page><InventoryPage /></Page>} />
        <Route path="customers" element={<Page><CustomersPage /></Page>} />
        <Route path="agents" element={<Page><AgentsPage /></Page>} />
        <Route path="models" element={<Page><ModelsPage /></Page>} />
        <Route path="reports" element={<Page><ReportsPage /></Page>} />
        <Route path="data" element={<Page><DataPage /></Page>} />
        <Route path="settings" element={<Page><SettingsPage /></Page>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
