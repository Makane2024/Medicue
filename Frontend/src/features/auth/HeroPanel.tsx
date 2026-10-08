import { Activity, Check, Clock, Smartphone } from 'lucide-react'
import { ThemeToggle } from '@/components/ui'
import heroImage from '@/assets/hero-doctors.png'

/** The blue marketing panel next to the sign-in forms. */
export function HeroPanel() {
  return (
    <div className="relative isolate flex min-h-[600px] flex-col overflow-hidden rounded-[32px] bg-brand text-white">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--c-brand)_55%,white)_0%,transparent_55%),radial-gradient(90%_70%_at_0%_100%,var(--c-brand-deep)_0%,transparent_70%)]" />
      <div className="absolute inset-0 -z-10 opacity-[0.12] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />

      <div className="flex items-center gap-2.5 p-7">
        <div className="grid size-9 place-items-center rounded-xl bg-white text-brand">
          <Activity className="size-5" />
        </div>
        <span className="flex-1 text-lg font-extrabold tracking-tight">MediCue</span>
        <ThemeToggle className="!bg-white/15 !text-white hover:!bg-white/25" />
      </div>

      <div className="px-8 pt-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold backdrop-blur">
          <span className="relative flex size-2">
            <span className="absolute inset-0 rounded-full bg-emerald-300 animate-ping-soft" />
            <span className="relative size-2 rounded-full bg-emerald-300" />
          </span>
          Hospitals across Cameroon
        </span>
        <h1 className="mt-5 max-w-sm text-[40px] leading-[1.02] font-extrabold tracking-[-0.03em] lg:text-[46px]">
          Your visit;
          <br />
          on <span className="italic font-light">your</span> time.
        </h1>
        <p className="mt-4 max-w-xs text-sm text-white/75">
          Book a timed consultation, pay with Mobile Money and walk straight in. No more waiting all morning.
        </p>
      </div>

      <svg
        viewBox="0 0 400 60"
        className="mt-6 w-full text-white/50"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path className="animate-trace" d="M0 34h120l10-20 14 38 12-30 8 12h236" />
      </svg>

      <div className="relative mt-auto h-[300px]">
        <img
          src={heroImage}
          alt="Three smiling doctors"
          className="absolute inset-x-6 bottom-0 h-full w-[calc(100%-3rem)] rounded-t-[28px] object-cover object-top shadow-2xl"
        />
        <div className="absolute bottom-6 left-9 w-52 rounded-[22px] bg-white/95 p-4 text-ink shadow-xl animate-float dark:bg-surface/95">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-600">
            <Check className="size-3.5" />
            Appointment confirmed
          </div>
          <div className="mt-2 text-sm font-bold">General consultation</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <Clock className="size-3.5" />
            Tomorrow · 10:30
          </div>
        </div>
        <div className="absolute bottom-6 right-9 hidden items-center gap-3 sm:flex rounded-full bg-brand-deep/90 py-2 pl-2 pr-4 shadow-xl backdrop-blur-md animate-float [animation-delay:-3s]">
          <div className="grid size-9 place-items-center rounded-full bg-white text-brand">
            <Smartphone className="size-4" />
          </div>
          <div className="text-xs">
            <div className="font-bold text-black">MoMo payment</div>
            <div className="text-black/70">Paid in seconds</div>
          </div>
        </div>
      </div>
    </div>
  )
}
