import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// PhantomBot's consumer-facing mark. Hermes remains the attributed runtime
// kernel, but its upstream artwork never leaks into the PhantomBot shell.
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'phantombot-brand-mark inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl',
        className
      )}
      {...props}
    >
      <img alt="" className="size-full object-cover" src={assetPath('phantombot-mark.png')} />
    </span>
  )
}
