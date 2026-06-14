export const coverColors = [
  "#F4A261",
  "#E76F51",
  "#E9C46A",
  "#2A9D8F",
  "#4C78A8",
  "#7B61A8",
  "#D56AA0",
  "#6B7280",
];

export const coverGradients = {
  aurora: "linear-gradient(120deg, #43cea2 0%, #185a9d 100%)",
  citrus: "linear-gradient(120deg, #f6d365 0%, #fda085 100%)",
  ember: "linear-gradient(120deg, #f12711 0%, #f5af19 100%)",
  lagoon: "linear-gradient(120deg, #00c6ff 0%, #0072ff 100%)",
  lavender: "linear-gradient(120deg, #c471f5 0%, #fa71cd 100%)",
  midnight: "linear-gradient(120deg, #232526 0%, #414345 100%)",
  peach: "linear-gradient(120deg, #ffecd2 0%, #fcb69f 100%)",
  rose: "linear-gradient(120deg, #f093fb 0%, #f5576c 100%)",
};

export function coverBackground(cover, localImage = "") {
  if (!cover) return "";
  if (cover.kind === "color" && /^#[0-9a-f]{6}$/i.test(cover.value)) {
    return cover.value;
  }
  if (cover.kind === "gradient") {
    return coverGradients[cover.value] || "";
  }
  if (cover.kind === "image" && /^data:image\/(?:png|jpeg|gif);base64,/i.test(localImage)) {
    return `url("${localImage}")`;
  }
  return "";
}
