"use client";

import { Input } from "@/components/ui";

/** A one-time code field: digits on a phone keyboard, filled in from the SMS/email by the browser when it can. */
export default function CodeField({ value, onChange, label = "6-digit code", error, hint, long = false, autoFocus = true }: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  error?: string;
  hint?: string;
  /** Backup codes are longer and have letters. */
  long?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <Input
      label={label} name="code" value={value} error={error} hint={hint} autoFocus={autoFocus}
      inputMode={long ? "text" : "numeric"} autoComplete="one-time-code" spellCheck={false} mono
      maxLength={long ? 24 : 6} placeholder={long ? "xxxxx-xxxxx" : "123456"}
      onChange={(e) => onChange(long ? e.currentTarget.value : e.currentTarget.value.replace(/\D/g, ""))}
    />
  );
}
