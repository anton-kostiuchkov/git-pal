import { X } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";

const ADD_KEYS = ["Enter", ","];

interface Props {
  value: string[];
  onChange: (labels: string[]) => void;
}

export function LabelsField({ value, onChange }: Props) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const label = draft.trim();
    setDraft("");

    if (!label || value.includes(label)) return;

    onChange([...value, label]);
  };

  const remove = (label: string) => onChange(value.filter((l) => l !== label));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (ADD_KEYS.includes(e.key)) {
      // Enter would submit the form
      e.preventDefault();
      add();
      return;
    }

    if (e.key === "Backspace" && !draft && value.length > 0) {
      remove(value[value.length - 1]);
    }
  };

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 focus-within:border-ring">
      {value.map((label) => (
        <Badge key={label} variant="outline">
          {label}
          <button
            type="button"
            title={`Remove ${label}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => remove(label)}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        aria-label="Skip labels"
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        placeholder={value.length === 0 ? "Add a label" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
    </div>
  );
}
