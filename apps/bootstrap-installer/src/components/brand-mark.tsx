import { cn } from '../lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// Mirrors the PhantomBot desktop mark; the installer is part of the same
// consumer product even though the installed runtime is powered by Hermes.
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
