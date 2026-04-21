# Jacarenda Labs — Design System

> This is the canonical design spec for every surface in this project (admin UI,
> future dashboards, marketing, in-app chrome). All design decisions — type,
> spacing, colour, component shape, motion — must follow the rules below.
>
> When a new screen or component is built, reach for the recipes in this doc
> **before** inventing anything new.

---

## 1. Stack

- Vite + React + TypeScript
- Tailwind CSS + `tailwindcss-animate`
- shadcn/ui (Radix primitives) — `components.json` preset: `default`, base colour `neutral`
- `lucide-react` (iconography)
- `class-variance-authority` (cva) for variants
- `clsx` + `tailwind-merge` via `cn()` util
- Fonts: **Inter** (UI), **Playfair Display** (reserve for editorial/serif moments)

**Install:**

```bash
pnpm add react react-dom react-router-dom lucide-react \
        class-variance-authority clsx tailwind-merge @radix-ui/react-slot
pnpm add -D tailwindcss postcss autoprefixer tailwindcss-animate
```

**Font import** (top of `src/index.css`):

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap');
```

---

## 2. Design tokens — the philosophy

- **Monochrome-first.** Black (`#000`), white (`#fff`), greys. The hero, buttons, CTAs, icon tiles are all black-on-white. Do not use decorative colour.
- **Accent only:** the jacaranda purple `#603C8D` is reserved for brand moments (logo, rare links). `azure #0077FF` is unused in live UI.
- **No emojis. Ever.** Icons only, from Lucide.
- **No warning colours** in marketing / email. Reds only for form-error micro-states.
- **Rounded:** `rounded-md` (0.375rem) for inputs / buttons, `rounded-xl` (0.75rem) for icon tiles, `rounded-2xl` (1rem) for cards, `rounded-full` for pills / avatars.

---

## 3. `tailwind.config.ts`

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary:     { DEFAULT: 'hsl(var(--primary))',     foreground: 'hsl(var(--primary-foreground))' },
        secondary:   { DEFAULT: 'hsl(var(--secondary))',   foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted:       { DEFAULT: 'hsl(var(--muted))',       foreground: 'hsl(var(--muted-foreground))' },
        accent:      { DEFAULT: 'hsl(var(--accent))',      foreground: 'hsl(var(--accent-foreground))' },
        popover:     { DEFAULT: 'hsl(var(--popover))',     foreground: 'hsl(var(--popover-foreground))' },
        card:        { DEFAULT: 'hsl(var(--card))',        foreground: 'hsl(var(--card-foreground))' },
        jacaranda: {
          50:  '#f8f6fc', 100: '#f0ebf8', 200: '#e3daef', 300: '#cebee2', 400: '#b199d0',
          500: '#9575bb', 600: '#7c5aa3', 700: '#603C8D', 800: '#533577', 900: '#452d62',
        },
        obsidian: '#111111',
        cloud:    '#FAFAFA',
        silver:   '#EAEAEA',
        azure:    '#0077FF',
      },
      fontFamily: {
        playfair: ['Playfair Display', 'serif'],
        inter:    ['Inter', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'fade-in':        { '0%': { opacity: '0', transform: 'translateY(20px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'float':          { '0%, 100%': { transform: 'translateY(0px)' }, '50%': { transform: 'translateY(-10px)' } },
        'gradient-shift': { '0%, 100%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        'fade-in':        'fade-in 0.6s ease-out',
        'float':          'float 6s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
      },
      backgroundImage: {
        'gradient-radial':    'radial-gradient(var(--tw-gradient-stops))',
        'jacaranda-gradient': 'linear-gradient(135deg, #603C8D 0%, #9575bb 100%)',
        'hero-gradient':      'linear-gradient(135deg, #FFFFFF 0%, #f8f8f8 50%, #FFFFFF 100%)',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
```

---

## 4. `src/index.css` — CSS variables, keyframes, utilities

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 98%;
    --primary: 240 9% 17%;               /* near-black */
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 10% 3.9%;
    --radius: 0.5rem;
  }
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
}

/* Section background transitions (enables cross-fade between sections) */
section { transition: background-color 0.8s cubic-bezier(0.4, 0, 0.2, 1); }

/* ---------- Motion library ---------- */

@keyframes slide-down { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.animate-slide-down { animation: slide-down 0.2s ease-out; }

@keyframes slide-up    { 0% { opacity: 0; transform: translateY(40px); }  100% { opacity: 1; transform: translateY(0); } }
@keyframes slide-left  { 0% { opacity: 0; transform: translateX(40px); }  100% { opacity: 1; transform: translateX(0); } }
@keyframes slide-right { 0% { opacity: 0; transform: translateX(-40px); } 100% { opacity: 1; transform: translateX(0); } }
@keyframes fade-scale  { 0% { opacity: 0; transform: scale(0.95); }       100% { opacity: 1; transform: scale(1); } }
@keyframes bounce-in   {
  0%   { opacity: 0; transform: translateY(30px) scale(0.9); }
  60%  { opacity: 1; transform: translateY(-5px) scale(1.02); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes fade-in { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
.animate-fade-in { animation: fade-in 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards; opacity: 0; }

@keyframes scale-in { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }
.animate-scale-in { animation: scale-in 0.3s ease-out; }

@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }
.animate-float { animation: float 6s ease-in-out infinite; }

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-2px); }
  20%, 40%, 60%, 80%      { transform: translateX(2px); }
}
.animate-shake { animation: shake 0.5s ease-in-out; }

@keyframes gradient { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
.animate-gradient { animation: gradient 3s ease infinite; }
.bg-300 { background-size: 300% 300%; }

/* ---------- Scroll-triggered stage animations ----------
   Elements with .stage-title / .stage-description / .stage-content /
   .stage-item start hidden. An IntersectionObserver adds
   .animate-in-view to play the animation. Per-section selectors let
   you vary the motion per section (#platform, #approach, etc). */

.stage-title, .stage-description, .stage-content, .stage-item {
  opacity: 0;
  transform: translateY(30px);
  transition: none;
}

/* Example — services section: gentle slide-up + staggered bounce-in items */
#platform .stage-title.animate-in-view       { animation: slide-up 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
#platform .stage-description.animate-in-view { animation: slide-up 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 0.2s; }
#platform .stage-content.animate-in-view     { animation: fade-scale 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 0.4s; }
#platform .stage-item.animate-in-view:nth-child(1) { animation: bounce-in 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 0.6s; }
#platform .stage-item.animate-in-view:nth-child(2) { animation: bounce-in 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 0.75s; }
#platform .stage-item.animate-in-view:nth-child(3) { animation: bounce-in 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 0.9s; }
#platform .stage-item.animate-in-view:nth-child(4) { animation: bounce-in 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 1.05s; }

/* Example — approach section: slide from opposite sides */
#approach .stage-title.animate-in-view       { animation: slide-right 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
#approach .stage-description.animate-in-view { animation: slide-left  0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 0.3s; }
#approach .stage-content.animate-in-view     { animation: fade-scale  0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 0.6s; }
#approach .stage-item.animate-in-view:nth-child(1) { animation: slide-right 0.7s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 0.8s; }
#approach .stage-item.animate-in-view:nth-child(2) { animation: slide-up    0.7s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 1.0s; }
#approach .stage-item.animate-in-view:nth-child(3) { animation: slide-left  0.7s cubic-bezier(0.4, 0, 0.2, 1) forwards; animation-delay: 1.2s; }

/* ---------- Utility classes ---------- */

.text-gradient {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Flagship hover interaction — lift + soft shadow. Apply to any card. */
.hover-lift       { transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out; }
.hover-lift:hover { transform: translateY(-4px); box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1); }

/* Pattern credit callout — left-bordered block used on case studies */
.pattern-created       { border-left: 3px solid #000; padding: 12px 0 12px 16px; margin-top: 16px; }
.pattern-created-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 4px; }
.pattern-created-text  { font-size: 14px; font-weight: 500; color: #000; margin-bottom: 4px; }
.pattern-created-link  { font-size: 13px; color: #666; text-decoration: none; transition: color 0.2s; display: inline-flex; }
.pattern-created-link:hover { color: #000; }

/* Premium motion mesh — decorative backdrop for feature sections (venture studio) */
.venture-mesh {
  position: absolute;
  inset: -30% -10% auto -10%;
  height: 120%;
  background:
    radial-gradient(600px circle at 20% 20%, rgba(1, 219, 136, 0.22), transparent 60%),
    radial-gradient(520px circle at 80% 30%, rgba(15, 23, 42, 0.25), transparent 65%),
    radial-gradient(720px circle at 50% 70%, rgba(99, 102, 241, 0.18), transparent 65%),
    radial-gradient(480px circle at 70% 80%, rgba(16, 185, 129, 0.18), transparent 60%);
  filter: blur(18px);
  opacity: 0.9;
  animation: venture-mesh-float 16s ease-in-out infinite;
  pointer-events: none;
  will-change: transform;
  transform: translateZ(0);
}
@keyframes venture-mesh-float {
  0%   { transform: translateY(0) scale(1); }
  50%  { transform: translateY(20px) scale(1.03); }
  100% { transform: translateY(0) scale(1); }
}
```

---

## 5. `cn` utility (`src/lib/utils.ts`)

```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

## 6. Button — primitive + usage patterns

**Primitive (`src/components/ui/button.tsx`):**

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:     "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:     "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:   "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:       "hover:bg-accent hover:text-accent-foreground",
        link:        "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm:      "h-9 rounded-md px-3",
        lg:      "h-11 rounded-md px-8",
        icon:    "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = "Button"
export { Button, buttonVariants }
```

**Canonical usage — the site's four button looks:**

```tsx
/* Primary CTA — black, 48px tall */
<Button className="h-12 px-6 bg-black hover:bg-gray-800 text-white">
  Join Founding Partner Program →
</Button>

/* Secondary CTA — outlined, 48px tall */
<Button variant="outline" className="h-12 px-6 border-gray-300 text-black hover:bg-gray-50">
  Explore Studios →
</Button>

/* Compact header CTA */
<Button className="bg-black hover:bg-gray-800 text-white px-6 py-2">
  Get in touch
</Button>

/* Selected chip pattern (used in form path-selector) */
<Button
  type="button"
  variant={selected ? 'default' : 'outline'}
  className={selected
    ? 'bg-black text-white hover:bg-gray-800'
    : 'border-gray-300 text-black hover:bg-gray-50'}
>
  {label}
</Button>
```

**Rules:** primary CTAs use literal `bg-black` / `hover:bg-gray-800` (not `bg-primary`) to pin to pure black. CTAs usually include a trailing `→` character or a Lucide `ArrowRight` icon (auto-sized to `size-4` via the primitive's `[&_svg]:size-4`).

---

## 7. Input / Textarea / Badge / Card primitives

**Input**

```tsx
<input
  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
/>
```

Form inputs on the real site are `h-12` (bigger), with a relative wrapper so a trailing `Check` or `X` icon from Lucide can be absolutely positioned at `right-3 top-1/2 -translate-y-1/2`.

**Textarea**

```tsx
<textarea className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" />
```

**Badge** — inline pill, uppercase label, used for section eyebrows:

```tsx
<div className="inline-flex items-center gap-2 bg-black/5 backdrop-blur-sm border border-gray-200 rounded-full px-3 py-1.5">
  <Brain className="w-4 h-4 text-black" />
  <span className="text-sm font-medium text-black">ENTERPRISE AI INFRASTRUCTURE</span>
</div>
```

**Card (default shadcn version used everywhere):**

```tsx
<div className="rounded-lg border bg-card text-card-foreground shadow-sm">
  <div className="flex flex-col space-y-1.5 p-6">
    <h3 className="text-2xl font-semibold leading-none tracking-tight">Title</h3>
    <p className="text-sm text-muted-foreground">Description</p>
  </div>
  <div className="p-6 pt-0">Body</div>
</div>
```

**The signature card on marketing pages is custom, not shadcn Card:**

```tsx
<div className="group p-8 rounded-2xl border border-gray-100 hover:border-gray-300 hover-lift transition-all duration-300">
  <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
    <Icon className="w-7 h-7 text-white" />
  </div>
  <h3 className="font-inter text-2xl font-semibold text-black mb-4">{title}</h3>
  <p className="text-gray-600 leading-relaxed">{desc}</p>
</div>
```

This is the recurring card pattern — **memorise it**.

---

## 8. Shadows

The site uses a narrow shadow vocabulary — **don't add more.**

| Token     | Class                                                   | Usage                                                      |
| --------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Edge      | `shadow-sm`                                             | Header once scrolled, cards at rest, content wells         |
| Drop      | `shadow-lg`                                             | Mobile menu dropdown, card on hover (via `hover-lift`)     |
| Lift      | `box-shadow: 0 10px 25px rgba(0,0,0,0.1)` (`.hover-lift:hover`) | The one hover shadow used on every interactive card |
| Icon drop | `drop-shadow(0 0 2em #646cffaa)`                        | Logo-only hover glow                                       |

No inner shadows. No coloured shadows outside the logo.

---

## 9. Micro-interactions — the full inventory

1. **`hover-lift`** — every card: `translateY(-4px)` + soft shadow on hover, 200ms.
2. **Icon tile scale** — on card hover, the icon tile scales: `group-hover:scale-110 transition-transform duration-300`. Always paired with `group` on the card and a fixed-size tile (`w-14 h-14` or `w-16 h-16`, `bg-black`, `rounded-xl`/`rounded-2xl`, centred Lucide icon in white).
3. **Header scroll collapse** — scrolled state (`>50px`) toggles `bg-white/95 backdrop-blur-sm shadow-sm` on the fixed header, shrinks logo (`h-20 md:h-[7.7rem]` → `h-[4.7rem] md:h-[6.45rem]`) and padding (`py-2` → `py-1`). `transition duration-300`.
4. **Active-section underline** — nav link for the in-view section gets an `after:` underline that plays `animate-scale-in` (scaleX 0→1, 300ms).
5. **Mobile menu slide-down** — `.animate-slide-down`, 200ms.
6. **Hero typewriter** — character-by-character append with 100ms setTimeout loop and a blinking `|` caret (`animate-pulse`). Subtitle fades in via `animate-fade-in` with a 3s delay.
7. **Animated hero background** — two blurred blobs `w-64` / `w-96`, `bg-gray-200` / `bg-gray-100`, `rounded-full blur-3xl`, `animate-float` (one offset by `animationDelay: 2s`) at 10% opacity.
8. **Scroll-triggered stage animations** — `.stage-title` / `.stage-description` / `.stage-content` / `.stage-item` start hidden; an IntersectionObserver adds `.animate-in-view`. Each section (`#platform`, `#approach`, `#case-studies`, `#about`, `#contact`) gets a different choreography via CSS (slide-up, slide-from-sides, fade-scale, bounce-in) with cascading delays (0.2s / 0.3s / 0.6s, then 0.15s between items).
9. **Form field validation feedback** — valid field shows a green `Check` icon (`right-3`, `animate-scale-in`), invalid shows a red `X` + red border + `animate-shake` (500ms horizontal wobble) + red hint text fading in below. Border swaps to `border-green-500` or `border-red-500`.
10. **Toast notifications** — shadcn's `useToast` + `Toaster` in root. Success = default styling; errors = `variant: "destructive"`.
11. **Section background cross-fade** — every section has `transition: background-color 0.8s cubic-bezier(0.4,0,0.2,1)`, so toggling a class washes smoothly.
12. **Email/info-card click** — the contact-info cards are `cursor-pointer` + `hover-lift` — whole card is a click target.

---

## 10. Layout system

- **Container:** `container mx-auto px-6` (Tailwind's container, centred, 2xl: 1400px cap). Padding is `px-6`, not the config's `2rem` — the site overrides inline.
- **Section vertical rhythm:** `py-24` for marketing sections (`py-16` for footer).
- **Background alternation:** `bg-white` → `bg-gray-50` → `bg-white`. Never `bg-gray-100`.
- **Dark section:** `bg-black text-white` with `text-gray-300` / `text-gray-400` for body copy and `border-gray-800` separators.
- **Grid rhythm:** `grid md:grid-cols-2 lg:grid-cols-3 gap-8` for card rows; centred-cap content at `max-w-4xl` / `max-w-6xl mx-auto`.
- **Section intros:** centred `max-w-3xl` description under an `h2` with `mb-16` between intro and grid.

**Section template**

```tsx
<section id="platform" className="py-24 bg-white relative">
  <div className="container mx-auto px-6 relative z-10">
    <div className="text-center mb-16">
      <h2 className="font-inter text-4xl md:text-5xl font-bold text-black mb-6 stage-title">
        Heading
      </h2>
      <p className="text-xl text-gray-600 max-w-3xl mx-auto stage-description">
        Subhead describing the section.
      </p>
    </div>

    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto stage-content">
      {/* cards with .stage-item */}
    </div>
  </div>
</section>
```

**Subtle texture overlay** (optional on light sections):

```tsx
<div
  className="absolute inset-0 opacity-[0.06] bg-repeat bg-center"
  style={{ backgroundImage: `url('/brand-assets/texture.png')`, backgroundSize: '400px 400px' }}
/>
```

**Dark CTA panel with dot pattern:**

```tsx
<div className="bg-black p-8 rounded-2xl text-white relative overflow-hidden">
  <div
    className="absolute inset-0 pointer-events-none opacity-20"
    style={{
      backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='1' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='1'/%3E%3C/g%3E%3C/svg%3E")`,
      backgroundSize: '20px 20px',
      backgroundPosition: 'bottom right',
      maskImage: 'linear-gradient(to top, black, transparent 80%)',
      WebkitMaskImage: 'linear-gradient(to top, black, transparent 80%)',
    }}
  />
  {/* content in relative z-10 */}
</div>
```

---

## 11. Typography

- **H1 hero:** `font-inter text-5xl md:text-7xl font-bold text-black`
- **H2 section:** `font-inter text-4xl md:text-5xl font-bold text-black mb-6`
- **H3 card title:** `font-inter text-2xl font-semibold text-black mb-4`
- **H4 footer column:** `font-semibold mb-4 text-white`
- **Body large (lede):** `text-xl md:text-2xl text-gray-600 leading-relaxed`
- **Body default:** `text-gray-600 leading-relaxed`
- **Eyebrow label:** `text-sm font-medium text-black` (uppercase only when inside a badge pill)
- **Footnote:** `text-sm text-gray-400` / `text-xs text-gray-500`
- **Font stack:** default stays Inter. Only use `font-playfair` for deliberate editorial moments; avoid for UI chrome.

Line heights default to Tailwind's `leading-relaxed` on paragraphs; keep headings default (`leading-tight` implied by `font-bold`).

---

## 12. Colour usage rules

| Role             | Token / class                                               | Use for                              |
| ---------------- | ----------------------------------------------------------- | ------------------------------------ |
| Primary text     | `text-black`                                                | Headings, CTA fill, icon tiles       |
| Body text        | `text-gray-600`                                             | Paragraphs, descriptions             |
| Subtle text      | `text-gray-400`                                             | Footnotes, secondary metadata        |
| Dark-panel body  | `text-gray-300`                                             | Body text on `bg-black`              |
| Borders          | `border-gray-100` (card at rest), `border-gray-300` (card hover / inputs) |                     |
| Surfaces         | `bg-white`, `bg-gray-50` (alt sections), `bg-black` (contrast panels) |                          |
| Error            | `border-red-500` / `text-red-500`                           | Form validation **only**             |
| Success          | `border-green-500` / `text-green-500`                       | Form validation **only**             |
| Accent (rare)    | `text-jacaranda-500`                                        | Inline brand links only              |

**Never mix accent colours in the same section. Never use `text-blue-*`.**

---

## 13. Iconography

- **Library:** `lucide-react` exclusively.
- **Sizing:** `w-4 h-4` (inline with text), `w-5 h-5` (list items), `w-6 h-6` (mobile menu toggles, inside medium tile), `w-7 h-7` (inside `w-14 h-14` tile), `w-8 h-8` (inside `w-16 h-16` tile).
- **Icon tile pattern:** `w-14 h-14 bg-black rounded-xl flex items-center justify-center` + white icon. For bigger: `w-16 h-16 rounded-2xl`. Always paired with `group-hover:scale-110 transition-transform duration-300`.
- **Inline CTA arrow:** `ArrowRight` from Lucide, or literal `→` inside text.

---

## 14. Form patterns (copy-paste)

```tsx
<div className="relative">
  <Input
    name="email"
    type="email"
    placeholder="Email Address"
    value={formData.email}
    onChange={handleInputChange}
    className={cn(
      'h-12 pr-10',
      fieldErrors.email && 'border-red-500 focus:border-red-500 animate-shake',
      fieldSuccess.email && !fieldErrors.email && 'border-green-500 focus:border-green-500'
    )}
  />
  {fieldSuccess.email && !fieldErrors.email && (
    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500 animate-scale-in" />
  )}
  {fieldErrors.email && (
    <X className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-red-500 animate-scale-in" />
  )}
  {fieldErrors.email && (
    <p className="text-red-500 text-sm mt-1 animate-fade-in">{fieldErrors.email}</p>
  )}
</div>
```

**Path-selector chip row** (filter / segment-choice UI):

```tsx
<div className="flex flex-wrap gap-2">
  {options.map(o => (
    <Button
      key={o.value}
      type="button"
      variant={selected === o.value ? 'default' : 'outline'}
      className={selected === o.value
        ? 'bg-black text-white hover:bg-gray-800'
        : 'border-gray-300 text-black hover:bg-gray-50'}
      onClick={() => setSelected(o.value)}
    >
      {o.label}
    </Button>
  ))}
</div>
```

**File upload drop-zone** (used in contact form):

```tsx
<div className="relative">
  <input type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
  <div className="flex items-center gap-3 p-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 transition-colors">
    <Upload className="w-5 h-5 text-gray-400" />
    <span className="text-sm text-gray-600">Click to upload or drag and drop</span>
  </div>
</div>
```

---

## 15. Header recipe

Fixed-top, 50px scroll threshold swaps transparent → frosted white, subtle shrink:

```tsx
<header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300
  ${scrolled ? 'bg-white/95 backdrop-blur-sm shadow-sm' : 'bg-transparent'}`}>
  <div className={`container mx-auto px-6 transition-all duration-200 ${scrolled ? 'py-1' : 'py-2'}`}>
    {/* logo left, nav centre, CTA right, hamburger <lg: */}
  </div>
</header>
```

Nav link hover = `hover:text-gray-700`. Active section link gets a `h-0.5 bg-black` underline pseudo-element that plays `animate-scale-in`.

---

## 16. Footer recipe

```tsx
<footer className="bg-black text-white py-16">
  <div className="container mx-auto px-6">
    <div className="grid md:grid-cols-4 gap-8 mb-12">
      {/* col 1-2: logo + tagline */}
      {/* col 3: link column — h4 mb-4 white semibold, ul space-y-2 text-gray-400, hover:text-white transition */}
      {/* col 4: link column */}
    </div>
    <div className="border-t border-gray-800 pt-8 flex flex-col gap-4">
      {/* fine print + social icons */}
    </div>
  </div>
</footer>
```

Social icons: `w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center hover:bg-gray-700 transition-colors` with a `w-5 h-5` Lucide glyph inside.

---

## 17. Hero recipe

```tsx
<section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-white pt-32">
  {/* Floating blurred blobs at 10% opacity */}
  <div className="absolute inset-0 opacity-10">
    <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-gray-200 rounded-full blur-3xl animate-float" />
    <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-gray-100 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
  </div>

  <div className="container mx-auto px-6 text-center relative z-10">
    <div className="max-w-4xl mx-auto">
      {/* Eyebrow pill */}
      <div className="inline-flex items-center gap-2 bg-black/5 backdrop-blur-sm border border-gray-200 rounded-full px-3 py-1.5 mb-12 animate-fade-in">
        <Brain className="w-4 h-4 text-black" />
        <span className="text-sm font-medium text-black">ENTERPRISE AI INFRASTRUCTURE</span>
      </div>

      {/* Typewriter H1 */}
      <h1 className="font-inter text-5xl md:text-7xl font-bold text-black mb-6 min-h-[140px] md:min-h-[160px] flex flex-col items-center justify-center">
        <span>{displayedText}{typingCaret && <span className="animate-pulse">|</span>}</span>
      </h1>

      <p className="text-xl md:text-2xl text-gray-600 mb-12 max-w-3xl mx-auto leading-relaxed animate-fade-in" style={{ animationDelay: '3s' }}>
        Supporting copy, 1–2 sentences max.
      </p>

      <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '3.5s' }}>
        <Button className="h-12 px-6 bg-black hover:bg-gray-800 text-white">Primary CTA →</Button>
        <Button variant="outline" className="h-12 px-6 border-gray-300 text-black hover:bg-gray-50">Secondary →</Button>
      </div>
    </div>
  </div>
</section>
```

---

## 18. IntersectionObserver hook (drives `.animate-in-view`)

```ts
// src/hooks/useStageAnimations.ts
import { useEffect } from 'react'

export function useStageAnimations() {
  useEffect(() => {
    const els = document.querySelectorAll('.stage-title, .stage-description, .stage-content, .stage-item')
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('animate-in-view') })
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    )
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])
}
```

Call once in your root layout / page.

---

## 19. Composition rules — what makes it look "Jacarenda"

1. **Monochrome + one black icon tile per card.** Every feature block leads with a black `rounded-xl` tile, white icon inside. This single pattern repeats everywhere.
2. **Cards lift, icons scale.** The two-part hover is the identity.
3. **`py-24` sections alternating white / gray-50.** Never skip the breathing room.
4. **Headings in Inter bold, body in gray-600.** Don't use Playfair in product chrome.
5. **Typewriter hero + pill eyebrow + two CTAs (black / outlined).** Use on every major landing page.
6. **Staged scroll reveals, different motion per section** — but always `cubic-bezier(0.4,0,0.2,1)` and 0.6–0.8s.
7. **Rounded scale:** `md` (inputs / buttons) → `xl` (tiles) → `2xl` (cards / panels) → `full` (pills / avatars). No arbitrary radii.
8. **Shadows:** `shadow-sm` at rest, `hover-lift` on interaction. Nothing heavier unless it's a floating menu.
9. **Literal `bg-black`, not `bg-primary`, for CTAs** — because `primary` is HSL `240 9% 17%`, slightly cooler. The marketing surface pins to true black.
10. **No emojis, no warning reds outside form validation, no gratuitous colour.**
