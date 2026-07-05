"use client"

import * as React from "react"
import { Search, ChevronDown, Check } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import {
  COUNTRIES,
  DEFAULT_COUNTRY_ISO2,
  splitE164,
  type Country,
} from "@/lib/countries"

interface PhoneInputProps {
  /** Full E.164 value, e.g. "+12025551234" (or "" when empty). */
  value: string
  /** Called with the recombined E.164 value ("" when the number is blank). */
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  className?: string
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  "aria-invalid"?: boolean
}

/**
 * Country-code picker + national number, combined into one E.164 string.
 * The picker is a searchable dropdown: the closed control stays compact
 * (flag + dial code), and opening it reveals a search box over the full
 * country list. `value`/`onChange` speak the full E.164 string so it drops
 * straight into an existing phone field.
 */
export function PhoneInput({
  value,
  onChange,
  id,
  placeholder = "234 567 8900",
  required,
  disabled,
  className,
  onBlur,
  "aria-invalid": ariaInvalid,
}: PhoneInputProps) {
  // Which country the picker shows. Seeded from the incoming value (edit case),
  // then owned by the picker — so a user who chooses a country isn't yanked
  // back by the +1-defaults ambiguity of splitE164 on every keystroke.
  const [iso2, setIso2] = React.useState<string>(
    () => splitE164(value).country.iso2 || DEFAULT_COUNTRY_ISO2,
  )
  const [national, setNational] = React.useState<string>(
    () => splitE164(value).national,
  )
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const searchRef = React.useRef<HTMLInputElement>(null)
  const numberRef = React.useRef<HTMLInputElement>(null)

  const selected =
    COUNTRIES.find((c) => c.iso2 === iso2) ?? COUNTRIES[0]

  // Re-seed when the value is replaced from outside (dialog reopened for a
  // different contact). Guarded so our own onChange round-trips don't reset it.
  const composed = national ? `+${selected.dialCode}${national}` : ""
  React.useEffect(() => {
    if ((value ?? "") === composed) return
    const parsed = splitE164(value)
    setIso2(parsed.country.iso2 || DEFAULT_COUNTRY_ISO2)
    setNational(parsed.national)
    // Only react to external value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COUNTRIES
    const digits = q.replace(/[^\d]/g, "")
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso2.toLowerCase().includes(q) ||
        (digits.length > 0 && c.dialCode.startsWith(digits)),
    )
  }, [query])

  function emit(nextIso2: string, nextNational: string) {
    setIso2(nextIso2)
    setNational(nextNational)
    const dial =
      COUNTRIES.find((c) => c.iso2 === nextIso2)?.dialCode ??
      COUNTRIES[0].dialCode
    onChange(nextNational ? `+${dial}${nextNational}` : "")
  }

  function pick(c: Country) {
    emit(c.iso2, national)
    setOpen(false)
    setQuery("")
    // Hand focus back to the number field so the user can keep typing.
    requestAnimationFrame(() => numberRef.current?.focus())
  }

  return (
    <div
      className={cn(
        "flex h-8 w-full items-stretch overflow-hidden rounded-lg border border-input bg-transparent focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        ariaInvalid &&
          "border-destructive ring-3 ring-destructive/20 dark:ring-destructive/40",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setQuery("")
        }}
      >
        <PopoverTrigger
          disabled={disabled}
          aria-label={`Country code, currently ${selected.name} +${selected.dialCode}`}
          render={
            <button
              type="button"
              className="flex h-full shrink-0 cursor-pointer items-center gap-1 border-r border-input px-2.5 text-sm outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
            />
          }
        >
          <span aria-hidden>{selected.flag}</span>
          <span>+{selected.dialCode}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          initialFocus={searchRef}
          className="w-64 gap-0 p-0"
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filtered[0]) {
                    e.preventDefault()
                    pick(filtered[0])
                  }
                }}
                placeholder="Search country"
                aria-label="Search country"
                className="h-8 w-full rounded-md border border-input bg-transparent pr-2 pl-7 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No matching country
              </p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.iso2}
                  type="button"
                  onClick={() => pick(c)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                    c.iso2 === iso2 && "bg-accent/50",
                  )}
                >
                  <span className="w-5 shrink-0 text-center" aria-hidden>
                    {c.flag}
                  </span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    +{c.dialCode}
                  </span>
                  {c.iso2 === iso2 && (
                    <Check className="size-3.5 shrink-0" aria-hidden />
                  )}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Input
        ref={numberRef}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        value={national}
        onBlur={onBlur}
        aria-invalid={ariaInvalid}
        // Strip everything but digits so the stored value is always clean E.164.
        onChange={(e) => emit(iso2, e.target.value.replace(/[^\d]/g, ""))}
        className="h-full flex-1 rounded-none border-0 bg-transparent focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  )
}
