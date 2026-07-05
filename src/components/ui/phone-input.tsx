"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
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
 * Country-code dropdown + national number, combined into one E.164 string.
 * The dropdown picks the dial code (+1, +52, …); the input takes the rest.
 * `value`/`onChange` speak the full E.164 string so it drops straight into an
 * existing phone field.
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
  // Which country the dropdown shows. Seeded from the incoming value (edit
  // case), then owned by the dropdown — so a user who picks a country isn't
  // yanked back by the +1-defaults ambiguity of splitE164 on every keystroke.
  const [iso2, setIso2] = React.useState<string>(
    () => splitE164(value).country.iso2 || DEFAULT_COUNTRY_ISO2,
  )
  const [national, setNational] = React.useState<string>(
    () => splitE164(value).national,
  )

  // Re-seed when the value is replaced from outside (dialog reopened for a
  // different contact). Guarded so our own onChange round-trips don't reset it.
  const composed = national ? `+${dialFor(iso2)}${national}` : ""
  React.useEffect(() => {
    if ((value ?? "") === composed) return
    const parsed = splitE164(value)
    setIso2(parsed.country.iso2 || DEFAULT_COUNTRY_ISO2)
    setNational(parsed.national)
    // Only react to external value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function emit(nextIso2: string, nextNational: string) {
    setIso2(nextIso2)
    setNational(nextNational)
    onChange(nextNational ? `+${dialFor(nextIso2)}${nextNational}` : "")
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
      <select
        aria-label="Country code"
        value={iso2}
        disabled={disabled}
        onChange={(e) => emit(e.target.value, national)}
        className="h-full shrink-0 cursor-pointer border-r border-input bg-transparent py-1 pr-1 pl-2.5 text-sm outline-none focus-visible:bg-accent/50 dark:bg-transparent"
      >
        {COUNTRIES.map((c) => (
          <option key={c.iso2} value={c.iso2}>
            {c.flag} +{c.dialCode}
          </option>
        ))}
      </select>
      <Input
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

function dialFor(iso2: string): string {
  return (
    COUNTRIES.find((c: Country) => c.iso2 === iso2)?.dialCode ??
    COUNTRIES[0].dialCode
  )
}
