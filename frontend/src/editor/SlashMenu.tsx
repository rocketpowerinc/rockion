import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import type { SlashItem } from "./slashItems";

export interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface Props {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export const SlashMenu = forwardRef<SlashMenuRef, Props>((props, ref) => {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [props.items]);

  const pick = (index: number) => {
    const item = props.items[index];
    if (item) props.command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelected((s) => (s + props.items.length - 1) % props.items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % props.items.length);
        return true;
      }
      if (event.key === "Enter") {
        pick(selected);
        return true;
      }
      return false;
    },
  }));

  if (props.items.length === 0) return null;

  return (
    <div className="slash-menu">
      {props.items.map((item, i) => (
        <button
          key={item.title}
          className={`slash-item ${i === selected ? "is-selected" : ""}`}
          onMouseEnter={() => setSelected(i)}
          onClick={() => pick(i)}
        >
          <span className="slash-title">{item.title}</span>
          <span className="slash-hint">{item.hint}</span>
        </button>
      ))}
    </div>
  );
});

SlashMenu.displayName = "SlashMenu";
