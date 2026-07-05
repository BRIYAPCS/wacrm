"use client";

import * as React from "react";
import { Smile } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

// A curated, self-contained emoji set (no external library — CSP blocks
// remote assets). Covers the everyday range; grouped for quick scanning.
const CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "Smileys",
    emojis: [
      "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰",
      "😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🥳","😏","😒",
      "😞","😔","😟","😕","🙁","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬",
      "🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","😴","😪","🤤",
    ],
  },
  {
    label: "Gestures & people",
    emojis: [
      "👍","👎","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👋",
      "🤚","🖐️","✋","🖖","👏","🙌","🤝","🙏","💪","🦾","✍️","👀","🧠","👶","🧒","👦",
      "👧","🧑","👨","👩","🧓","👴","👵","🕺","💃","🚶","🏃","👮","🕵️","💼","🧑‍💻","🙋",
    ],
  },
  {
    label: "Hearts & symbols",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖",
      "💘","💝","💯","✅","❌","❗","❓","⚠️","🔔","⭐","🌟","✨","🔥","💥","💫","🎉",
      "🎊","🎈","🏆","🥇","✔️","➡️","⬅️","🔗","📌","📍","♻️","🆗","🆕","🔴","🟢","🟡",
    ],
  },
  {
    label: "Objects & work",
    emojis: [
      "📞","📱","💻","🖥️","⌨️","🖱️","📧","📨","📩","📤","📥","📁","📂","🗂️","📅","📆",
      "🗓️","📇","📋","📝","✏️","🖊️","🖇️","📎","📌","🔒","🔓","🔑","💡","🔦","🔌","🔋",
      "⏰","⏱️","⏳","💰","💵","💳","🧾","📊","📈","📉","🛒","🎁","☕","🍽️","🚗","✈️",
    ],
  },
  {
    label: "Food & nature",
    emojis: [
      "🍎","🍌","🍇","🍓","🍑","🍒","🍉","🍊","🥕","🌽","🍔","🍟","🍕","🌮","🍰","🍩",
      "🍪","☕","🍵","🥤","🍺","🍷","🥂","🌱","🌿","🍀","🌸","🌼","🌻","🌹","🌈","☀️",
      "🌙","⭐","☁️","🌧️","❄️","🐶","🐱","🐭","🦊","🐻","🐼","🐨","🦁","🐸","🐧","🦄",
    ],
  },
];

export function EmojiPicker({
  onPick,
  disabled,
  className,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        title="Emoji"
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
          />
        }
      >
        <Smile className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" sideOffset={8} className="w-72 p-0">
        <div className="max-h-60 overflow-y-auto p-2">
          {CATEGORIES.map((cat) => (
            <div key={cat.label} className="mb-1">
              <p className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {cat.label}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {cat.emojis.map((e, i) => (
                  <button
                    key={`${e}-${i}`}
                    type="button"
                    // onMouseDown so the insert fires before the textarea blur
                    // that would otherwise close the popover first.
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      onPick(e);
                    }}
                    className="flex items-center justify-center rounded p-1 text-lg leading-none hover:bg-accent"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
