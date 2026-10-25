import type { PriceListApi } from '../../shared/api'

declare global {
  interface Window {
    api: PriceListApi
  }
}
