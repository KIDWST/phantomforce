import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// PhantomBot's consumer-facing mark. Hermes remains the attributed runtime
// kernel, but its upstream artwork never leaks into the PhantomBot shell.
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'phantombot-brand-mark relative inline-flex size-14 shrink-0 items-center justify-center overflow-visible',
        className
      )}
      {...props}
    >
      <img
        alt=""
        className="phantombot-brand-mark__image size-full object-contain"
        src={assetPath('phantombot-mark.png')}
      />
      <span aria-hidden="true" className="phantombot-brand-mark__eyes" />
      <span aria-hidden="true" className="phantombot-brand-mark__gleam" />
    </span>
  )
}
