export function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

export function relativeAge(value: string | null | undefined) {
  if (!value) return "";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function titleCase(value: string | null | undefined) {
  return (value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function formatMoney(value: string | number | null | undefined, currency = "INR") {
  if (value == null || value === "") return "Restricted";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value));
}
