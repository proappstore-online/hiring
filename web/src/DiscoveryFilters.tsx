import { field } from './ui'

export function DiscoveryFilters({ search, brand, brands, onSearch, onBrand }: {
  search: string; brand: string; brands: { id: string; name: string }[]
  onSearch: (value: string) => void; onBrand: (value: string) => void
}) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <label>Search jobs<input className={field} type="search" value={search} onChange={e => onSearch(e.target.value)} /></label>
    <label>Brand<select className={field} value={brand} onChange={e => onBrand(e.target.value)}><option value="">All brands</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
  </div>
}
