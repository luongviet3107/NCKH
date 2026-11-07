import { createContext, useContext } from 'react'
import type { DatasetSummary } from '../lib/types'

export interface DatasetContextValue {
  datasets: DatasetSummary[]
  dataset: DatasetSummary | null
  activeDatasetId: string | null
  isLoading: boolean
  error: Error | null
  setActiveDataset: (datasetId: string) => Promise<void>
  isSwitching: boolean
  refresh: () => Promise<unknown>
}

export const DatasetContext = createContext<DatasetContextValue | null>(null)

export function useDataset() {
  const context = useContext(DatasetContext)
  if (!context) throw new Error('useDataset must be used within DatasetProvider')
  return context
}
