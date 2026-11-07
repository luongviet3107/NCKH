import { useMemo, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { DatasetContext, type DatasetContextValue } from './dataset-context'

export function DatasetProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['datasets'],
    queryFn: api.datasets.list,
    staleTime: 15_000,
  })

  const activate = useMutation({
    mutationFn: (datasetId: string) => api.datasets.activate(datasetId),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
    },
  })

  const { data, error, isLoading, refetch } = query
  const { mutateAsync: activateDataset, isPending: isSwitching } = activate

  const value = useMemo<DatasetContextValue>(() => {
    const datasets = data?.items ?? []
    const activeId = data?.active_dataset_id ?? null
    const dataset = datasets.find((item) => item.id === activeId) ?? datasets[0] ?? null

    return {
      datasets,
      dataset,
      activeDatasetId: dataset?.id ?? null,
      isLoading,
      error,
      setActiveDataset: async (datasetId: string) => {
        await activateDataset(datasetId)
      },
      isSwitching,
      refresh: refetch,
    }
  }, [activateDataset, data, error, isLoading, isSwitching, refetch])

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>
}
