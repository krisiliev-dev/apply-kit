// The LinkedIn data export, read without the model: Positions.csv gives roles, Education.csv education,
// Skills.csv and Languages.csv skills. Each piece quotes the row it came from.
import type { PieceEntry, PieceKind } from "./profile.ts";

export interface LinkedInPiece {
  kind: PieceKind;
  text: string;
  quote: string;
  entry: PieceEntry | null;
  role: null;
}

const monthNumbers: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Mar 2022" → "2022-03"; "2022" stays a year (Kris adds the month when confirming); empty → null. */
function month(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(v);
  if (m && monthNumbers[m[1]!.toLowerCase()]) return `${m[2]}-${monthNumbers[m[1]!.toLowerCase()]}`;
  return v;
}

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** The rows of one CSV in the export as records by column name, found by the column it must have. */
function records(entries: Map<string, Uint8Array>, file: string, mustHave: string): Record<string, string>[] | null {
  const name = [...entries.keys()].find((k) => k.split("/").pop()!.toLowerCase() === file.toLowerCase());
  if (!name) return null;
  const rows = csvRows(new TextDecoder().decode(entries.get(name)));
  // Some export files start with notes before the header.
  const header = rows.findIndex((r) => r.map((f) => f.trim()).includes(mustHave));
  if (header < 0) return [];
  const cols = rows[header]!.map((f) => f.trim());
  return rows.slice(header + 1).map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? "").trim()])));
}

const quoteOf = (...fields: (string | undefined)[]) => fields.filter((f) => f && f.trim()).join(", ");

/** Pieces from the export, and what was found; null when it holds none of the files LinkedIn puts in it. */
export function linkedInPieces(entries: Map<string, Uint8Array>): { pieces: LinkedInPiece[]; detail: string } | null {
  const positions = records(entries, "Positions.csv", "Company Name");
  const education = records(entries, "Education.csv", "School Name");
  const skills = records(entries, "Skills.csv", "Name");
  const languages = records(entries, "Languages.csv", "Name");
  if (!positions && !education && !skills) return null;
  const pieces: LinkedInPiece[] = [];
  for (const r of positions ?? []) {
    if (!r["Title"] || !r["Company Name"]) continue;
    pieces.push({
      kind: "role",
      text: r["Description"] ?? "",
      quote: quoteOf(r["Title"], r["Company Name"], r["Location"], `${r["Started On"] ?? ""} – ${r["Finished On"] || "present"}`),
      entry: {
        title: r["Title"],
        organisation: r["Company Name"],
        city: r["Location"]?.split(",")[0]?.trim() || null,
        start: month(r["Started On"]) ?? "",
        end: month(r["Finished On"]),
      },
      role: null,
    });
  }
  for (const r of education ?? []) {
    if (!r["School Name"] || !r["Degree Name"]) continue;
    pieces.push({
      kind: "education",
      text: r["Notes"] ?? "",
      quote: quoteOf(r["Degree Name"], r["School Name"], `${r["Start Date"] ?? ""} – ${r["End Date"] ?? ""}`),
      entry: { title: r["Degree Name"], organisation: r["School Name"], city: null, start: month(r["Start Date"]) ?? "", end: month(r["End Date"]) },
      role: null,
    });
  }
  for (const r of skills ?? []) if (r["Name"]) pieces.push({ kind: "skill", text: r["Name"], quote: r["Name"], entry: null, role: null });
  for (const r of languages ?? []) {
    if (!r["Name"]) continue;
    const text = r["Proficiency"] ? `${r["Name"]} (${r["Proficiency"]})` : r["Name"];
    pieces.push({ kind: "skill", text, quote: quoteOf(r["Name"], r["Proficiency"]), entry: null, role: null });
  }
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const detail = [
    count(positions?.length ?? 0, "position", "positions"),
    count(education?.length ?? 0, "school", "schools"),
    count((skills?.length ?? 0) + (languages?.length ?? 0), "skill", "skills"),
  ].join(" · ");
  return { pieces, detail };
}
