export function textColorStyle(value) {
  return value ? `color: ${value}` : "";
}

export function backgroundColorStyle(value) {
  return value
    ? `background-color: ${value}; border-radius: 3px; padding: 0 2px`
    : "";
}
