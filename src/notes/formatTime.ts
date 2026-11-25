const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Compact timestamp for the recent-notes list: "Just now", "12m", "3:41 PM", "Yesterday", "Mon", "Nov 4". */
export function formatNoteTime(iso: string, now = new Date()) {
  const date = new Date(iso);
  const seconds = (now.getTime() - date.getTime()) / 1000;
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return time.format(date);
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekday.format(date);
  return date.getFullYear() === now.getFullYear() ? monthDay.format(date) : fullDate.format(date);
}

export function formatFullTime(iso: string) {
  return new Date(iso).toLocaleString();
}
