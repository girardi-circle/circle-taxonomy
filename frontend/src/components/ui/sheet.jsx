import { cn } from '@/lib/utils'

export function Sheet({ open, onClose, title, width = 'w-[720px]', children }) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className={cn('fixed right-0 top-0 h-full bg-background border-l shadow-xl z-50 flex flex-col', width)}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </>
  )
}
