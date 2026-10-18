// Queue positions identify occurrences, so repeated songs can be moved independently.
export function moveEntry(queue, from, to) {
  if (from < 0 || to < 0 || from >= queue.tracks.length || to >= queue.tracks.length) return queue;
  const entries = queue.tracks.map((id, index) => ({ id, current: index === queue.index }));
  entries.splice(to, 0, entries.splice(from, 1)[0]);
  return { ...queue, tracks: entries.map((x) => x.id), index: entries.findIndex((x) => x.current) };
}

export function removeEntry(queue, index) {
  const tracks = queue.tracks.filter((_, i) => i !== index);
  return { ...queue, tracks, index: Math.max(0, Math.min(queue.index - (index < queue.index ? 1 : 0), tracks.length - 1)) };
}

export function nextIndex(queue, { ended = false, random = Math.random } = {}) {
  if (!queue.tracks.length) return -1;
  if (ended && queue.repeat === "one") return queue.index;
  if (queue.shuffle && queue.tracks.length > 1) {
    const pick = Math.floor(random() * (queue.tracks.length - 1));
    return pick >= queue.index ? pick + 1 : pick;
  }
  if (queue.index + 1 < queue.tracks.length) return queue.index + 1;
  return queue.repeat === "all" ? 0 : -1;
}
