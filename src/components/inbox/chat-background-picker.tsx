"use client";

import { useRef, useState } from "react";
import { Check, ImageUp, Loader2, Palette } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadAccountMedia } from "@/lib/storage/upload-media";
import {
  PRESETS,
  HEX_RE,
  CHAT_BG_BUCKET,
  CHAT_BG_MAX_BYTES,
  CHAT_BG_ACCEPT,
  backgroundSwatchStyle,
  parseBackground,
} from "@/lib/inbox/backgrounds";

interface ChatBackgroundPickerProps {
  /** Current token (or null). For conversation scope, null = inherit. */
  value: string | null;
  /** Report the chosen token. null clears (account: doodle; conv: inherit). */
  onSelect: (token: string | null) => void;
  /** Disable interaction while the parent persists a choice. */
  saving?: boolean;
  /**
   * When true, show a "Use account default" tile that selects `null`
   * (conversation scope). Its swatch previews `inheritPreviewToken`.
   */
  allowInherit?: boolean;
  /** The resolved account-default token, for the inherit tile's preview. */
  inheritPreviewToken?: string;
}

/**
 * Wallpaper picker shared by the account-default settings block and the
 * per-conversation dialog. It only REPORTS a chosen token via `onSelect`
 * (the parent owns persistence) — except image upload, which it performs
 * itself (it needs the storage round-trip) before reporting `image:<path>`.
 */
export function ChatBackgroundPicker({
  value,
  onSelect,
  saving = false,
  allowInherit = false,
  inheritPreviewToken,
}: ChatBackgroundPickerProps) {
  const parsed = parseBackground(value);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Local mirror of the colour input so typing a partial hex doesn't
  // immediately commit; we only report once it's a full #rrggbb.
  const [hex, setHex] = useState(parsed.kind === "color" ? parsed.hex : "#0b141a");

  const busy = saving || uploading;
  const isInherit = !value;
  const activeImage = parsed.kind === "image" ? value : null;

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (PNG, JPEG, or WebP).");
      return;
    }
    if (file.size > CHAT_BG_MAX_BYTES) {
      toast.error("Image is too large — 5 MB max.");
      return;
    }
    setUploading(true);
    try {
      const { path } = await uploadAccountMedia(CHAT_BG_BUCKET, file);
      onSelect(`image:${path}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not upload the image.",
      );
    } finally {
      setUploading(false);
    }
  };

  const commitHex = (next: string) => {
    setHex(next);
    if (HEX_RE.test(next)) onSelect(`color:${next.toLowerCase()}`);
  };

  return (
    <div className={cn("space-y-4", busy && "pointer-events-none opacity-60")}>
      {/* Presets (+ optional inherit tile) */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {allowInherit && (
          <Swatch
            label="Account default"
            style={backgroundSwatchStyle(inheritPreviewToken ?? "doodle")}
            active={isInherit}
            onClick={() => onSelect(null)}
          />
        )}
        {PRESETS.map((preset) => (
          <Swatch
            key={preset.key}
            label={preset.label}
            style={backgroundSwatchStyle(preset.key)}
            active={parsed.kind === "preset" && parsed.key === preset.key}
            onClick={() => onSelect(preset.key)}
          />
        ))}
      </div>

      {/* Custom colour */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Palette className="size-3.5" />
          Custom colour
        </span>
        <input
          type="color"
          aria-label="Custom background colour"
          value={HEX_RE.test(hex) ? hex : "#0b141a"}
          onChange={(e) => commitHex(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
        />
        <Input
          value={hex}
          onChange={(e) => commitHex(e.target.value)}
          placeholder="#0b141a"
          spellCheck={false}
          className={cn(
            "h-8 w-28 font-mono text-xs",
            parsed.kind === "color" && "border-primary/60 ring-1 ring-primary/30",
          )}
        />
      </div>

      {/* Upload */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImageUp className="size-3.5" />
          )}
          Upload image
        </Button>
        <span className="text-[11px] text-muted-foreground">
          PNG, JPEG or WebP · up to 5 MB
        </span>
        {activeImage && (
          <span
            aria-hidden
            className="size-8 rounded-md border border-primary/60 ring-1 ring-primary/30"
            style={backgroundSwatchStyle(activeImage)}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept={CHAT_BG_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // allow re-picking the same file
            if (file) handleUpload(file);
          }}
        />
      </div>
    </div>
  );
}

function Swatch({
  label,
  style,
  active,
  onClick,
}: {
  label: string;
  style: React.CSSProperties;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        "group relative flex h-14 flex-col justify-end overflow-hidden rounded-lg border p-1 text-left transition-colors",
        active
          ? "border-primary/70 ring-2 ring-primary/40"
          : "border-border hover:border-primary/40",
      )}
    >
      <span aria-hidden className="absolute inset-0" style={style} />
      {active && (
        <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-2.5" />
        </span>
      )}
      <span className="relative truncate rounded bg-black/45 px-1 py-0.5 text-[10px] font-medium text-white">
        {label}
      </span>
    </button>
  );
}
