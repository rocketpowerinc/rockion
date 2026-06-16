import type { PageRef } from "./PagePicker";
import { imageIconURL, isImageIcon } from "../editor/imageIcons.mjs";

export interface BreadcrumbItem extends PageRef {
  current?: boolean;
}

interface Props {
  items: BreadcrumbItem[];
  onOpen: (index: number, path: string) => void;
}

function PageIcon({ icon }: { icon?: string }) {
  if (isImageIcon(icon)) {
    return <img className="breadcrumb-icon-img" src={imageIconURL(icon)} alt="" />;
  }
  return <span className="breadcrumb-icon">{icon || "📄"}</span>;
}

export default function Breadcrumbs({ items, onOpen }: Props) {
  if (items.length === 0) return null;
  const visible = items.slice(-5);
  const offset = items.length - visible.length;

  return (
    <nav className="page-breadcrumbs" aria-label="Page history">
      {offset > 0 && <span className="breadcrumb-overflow">…</span>}
      {visible.map((item, visibleIndex) => {
        const index = offset + visibleIndex;
        return (
          <span className="breadcrumb-part" key={`${item.path}-${index}`}>
            {visibleIndex > 0 && (
              <span className="breadcrumb-separator" aria-hidden="true">
                /
              </span>
            )}
            {item.current ? (
              <span className="breadcrumb-current" aria-current="page">
                <PageIcon icon={item.icon} />
                <span>{item.title}</span>
              </span>
            ) : (
              <button onClick={() => onOpen(index, item.path)}>
                <PageIcon icon={item.icon} />
                <span>{item.title}</span>
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
