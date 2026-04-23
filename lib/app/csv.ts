import type { Application } from "./types";

// RFC 4180-ish CSV: wrap fields containing comma, newline, or double-quote in
// double quotes; escape internal double-quotes by doubling them.
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const HEADER = [
  "id",
  "company",
  "role",
  "status",
  "url",
  "dateCreated",
  "cvSlug",
  "notes",
] as const;

export function applicationsToCsv(apps: Application[]): string {
  const rows: string[] = [HEADER.join(",")];
  for (const a of apps) {
    rows.push(
      [
        a.id,
        a.company,
        a.role,
        a.status,
        a.url ?? "",
        new Date(a.dateCreated).toISOString(),
        a.cvSlug ?? "",
        a.notes ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return rows.join("\n");
}

export function downloadApplicationsCsv(apps: Application[]) {
  if (typeof window === "undefined") return;
  const csv = applicationsToCsv(apps);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `applications-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
