interface Props {
  tag?: string;
  color?: string;
  className?: string;
}

export default function PageTag({ tag, color, className = "" }: Props) {
  const label = tag || "Other";
  return (
    <span
      className={`page-tag ${className}`.trim()}
      data-color={color || "gray"}
      title={label}
    >
      {label}
    </span>
  );
}
