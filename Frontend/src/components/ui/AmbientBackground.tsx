/** Two soft, slowly drifting colour blobs behind a page. Purely decorative. */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-32 top-1/4 size-[420px] rounded-full bg-brand/10 blur-3xl animate-drift" />
      <div className="absolute -right-24 bottom-0 size-[360px] rounded-full bg-brand-soft/40 blur-3xl animate-drift [animation-delay:-11s]" />
    </div>
  )
}
