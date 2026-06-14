export function sortDashboardCards(cards, view) {
  const list = cards.slice();
  const sortBy = view?.sortBy;
  if (!sortBy) return list;
  list.sort((a, b) => {
    let left;
    let right;
    if (sortBy === "modified") {
      left = a.modifiedAt;
      right = b.modifiedAt;
    } else if (sortBy === "created") {
      left = a.createdAt;
      right = b.createdAt;
    } else {
      left = String(a.title).toLowerCase();
      right = String(b.title).toLowerCase();
    }
    if (left < right) return view.sortDir === "desc" ? 1 : -1;
    if (left > right) return view.sortDir === "desc" ? -1 : 1;
    return 0;
  });
  return list;
}

export function reorderedDashboardIDs(cards, fromID, toID) {
  if (fromID === toID) return cards.map((card) => card.pageId);
  const ids = cards.map((card) => card.pageId);
  const from = ids.indexOf(fromID);
  const to = ids.indexOf(toID);
  if (from < 0 || to < 0) return ids;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  return ids;
}
