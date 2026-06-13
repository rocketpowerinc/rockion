import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { SlashItem } from "./slashItems";
import { shouldHandleSlashMenuKey } from "./slashMenuKeys.mjs";

export interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface Props {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export const SlashMenu = forwardRef<SlashMenuRef, Props>((props, ref) => {
  const [selected, setSelected] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => setSelected(0), [props.items]);

  // Keep the highlighted item visible as the selection moves.
  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const pick = (index: number) => {
    const item = props.items[index];
    if (item) props.command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      // When "/text" matches no command, leave Enter and arrow keys to the
      // editor so the slash-prefixed text behaves like an ordinary paragraph.
      if (!shouldHandleSlashMenuKey(event.key, props.items.length)) return false;
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
          ref={(el) => (itemRefs.current[i] = el)}
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
