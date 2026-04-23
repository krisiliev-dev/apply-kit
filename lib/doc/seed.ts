import { nanoid } from "nanoid";
import type { CvDocument, Node } from "./types";
import { A4, defaultTheme } from "./types";
import { defaultCV } from "@/content/cvs/default";

// Converts typed CV content into a document seed. Used the first time a slug
// is opened — after that, edits are persisted to localStorage and this seed
// becomes irrelevant until the user resets.

const COL = {
  gutter: 18, // left/right margin in mm
  sidebarWidth: 54, // mm
  gap: 8, // between sidebar and main
};

const fs = {
  name: 52,
  title: 20,
  meta: 9,
  sectionHeading: 9,
  body: 10,
  experienceRole: 15,
  experienceDate: 9,
  bullet: 10,
};

let cursorY = 0;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

function mk<T extends Node>(
  n: DistributiveOmit<T, "id" | "z"> & { z?: number },
): T {
  return { ...(n as object), id: nanoid(8), z: (n as { z?: number }).z ?? 0 } as T;
}

function stackText(
  content: string,
  { x, y, w, h, ...style }: {
    x: number;
    y: number;
    w: number;
    h: number;
    fontToken?: "display" | "sans" | "mono";
    fontSize: number;
    fontWeight?: number;
    italic?: boolean;
    color?: string;
    lineHeight?: number;
    letterSpacing?: number;
    textTransform?: "none" | "uppercase" | "lowercase";
    textAlign?: "left" | "center" | "right";
    name?: string;
  },
): Node {
  return mk({
    type: "text",
    name: style.name,
    x,
    y,
    w,
    h,
    content,
    style: {
      fontToken: style.fontToken ?? "sans",
      fontSize: style.fontSize,
      fontWeight: style.fontWeight ?? 400,
      italic: style.italic,
      color: style.color ?? defaultTheme.colors.ink,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textTransform: style.textTransform,
      textAlign: style.textAlign,
    },
  });
}

export function seedFromDefault(): CvDocument {
  const cv = defaultCV;
  const { profile } = cv;
  const nodes: Node[] = [];

  const pageW = A4.width;
  const contentX = COL.gutter;
  const contentW = pageW - COL.gutter * 2;

  // ——— masthead ———
  cursorY = COL.gutter;

  nodes.push(
    stackText(`curriculum vitae — ${cv.targetRole}`, {
      name: "Masthead kicker",
      x: contentX,
      y: cursorY,
      w: contentW,
      h: 5,
      fontToken: "mono",
      fontSize: fs.meta,
      color: defaultTheme.colors.accent,
      textTransform: "uppercase",
      letterSpacing: 0.3,
    }),
  );
  cursorY += 6;

  nodes.push(
    stackText(profile.name, {
      name: "Name",
      x: contentX,
      y: cursorY,
      w: contentW,
      h: 22,
      fontToken: "display",
      fontSize: fs.name,
      lineHeight: 1,
    }),
  );
  cursorY += 20;

  nodes.push(
    stackText(profile.title, {
      name: "Title",
      x: contentX,
      y: cursorY,
      w: contentW,
      h: 8,
      fontToken: "display",
      fontSize: fs.title,
      italic: true,
      color: "#555",
    }),
  );
  cursorY += 10;

  const metaParts = [
    profile.email,
    profile.location,
    ...(profile.links?.map((l) => `${l.label} ↗`) ?? []),
  ].filter(Boolean);
  nodes.push(
    stackText(metaParts.join("   ·   "), {
      name: "Contact meta",
      x: contentX,
      y: cursorY,
      w: contentW,
      h: 5,
      fontToken: "mono",
      fontSize: fs.meta,
      color: "#555",
    }),
  );
  cursorY += 6;

  // divider line
  nodes.push(
    mk({
      type: "shape",
      shape: "line",
      name: "Header divider",
      x: contentX,
      y: cursorY,
      w: contentW,
      h: 0.4,
      stroke: defaultTheme.colors.ink,
      strokeWidth: 0.4,
    }),
  );
  cursorY += 6;

  // ——— two columns ———
  const sidebarX = contentX;
  const mainX = contentX + COL.sidebarWidth + COL.gap;
  const mainW = contentW - COL.sidebarWidth - COL.gap;

  // —— sidebar ——
  let sy = cursorY;

  if (profile.summary) {
    nodes.push(
      stackText("About", {
        name: "About heading",
        x: sidebarX,
        y: sy,
        w: COL.sidebarWidth,
        h: 4,
        fontToken: "mono",
        fontSize: fs.sectionHeading,
        color: "#777",
        textTransform: "uppercase",
        letterSpacing: 0.2,
      }),
    );
    sy += 5;
    nodes.push(
      stackText(profile.summary, {
        name: "About body",
        x: sidebarX,
        y: sy,
        w: COL.sidebarWidth,
        h: 20,
        fontToken: "display",
        fontSize: 12,
        italic: true,
        lineHeight: 1.3,
      }),
    );
    sy += 22;
  }

  if (cv.skills && cv.skills.length > 0) {
    nodes.push(
      stackText("Skills", {
        name: "Skills heading",
        x: sidebarX,
        y: sy,
        w: COL.sidebarWidth,
        h: 4,
        fontToken: "mono",
        fontSize: fs.sectionHeading,
        color: "#777",
        textTransform: "uppercase",
        letterSpacing: 0.2,
      }),
    );
    sy += 5;
    for (const g of cv.skills) {
      nodes.push(
        stackText(g.label, {
          name: `Skills:${g.label} label`,
          x: sidebarX,
          y: sy,
          w: COL.sidebarWidth,
          h: 3.5,
          fontToken: "mono",
          fontSize: 8,
          color: "#777",
          textTransform: "uppercase",
        }),
      );
      sy += 3.5;
      nodes.push(
        stackText(g.items.join(" · "), {
          name: `Skills:${g.label} items`,
          x: sidebarX,
          y: sy,
          w: COL.sidebarWidth,
          h: 6,
          fontSize: fs.body,
          lineHeight: 1.35,
        }),
      );
      sy += 7;
    }
    sy += 2;
  }

  if (cv.education.length > 0) {
    nodes.push(
      stackText("Education", {
        name: "Education heading",
        x: sidebarX,
        y: sy,
        w: COL.sidebarWidth,
        h: 4,
        fontToken: "mono",
        fontSize: fs.sectionHeading,
        color: "#777",
        textTransform: "uppercase",
        letterSpacing: 0.2,
      }),
    );
    sy += 5;
    for (const e of cv.education) {
      nodes.push(
        stackText(e.degree, {
          name: `Edu:${e.school} degree`,
          x: sidebarX,
          y: sy,
          w: COL.sidebarWidth,
          h: 5,
          fontToken: "display",
          fontSize: 12,
        }),
      );
      sy += 5;
      nodes.push(
        stackText(e.school, {
          name: `Edu:${e.school} school`,
          x: sidebarX,
          y: sy,
          w: COL.sidebarWidth,
          h: 4,
          fontSize: 9,
          color: "#555",
        }),
      );
      sy += 4;
      nodes.push(
        stackText(`${e.dates.start} — ${e.dates.end}`, {
          name: `Edu:${e.school} dates`,
          x: sidebarX,
          y: sy,
          w: COL.sidebarWidth,
          h: 4,
          fontToken: "mono",
          fontSize: 8,
          color: "#777",
        }),
      );
      sy += 6;
    }
  }

  if (cv.interests && cv.interests.length > 0) {
    nodes.push(
      stackText("Interests", {
        name: "Interests heading",
        x: sidebarX,
        y: sy,
        w: COL.sidebarWidth,
        h: 4,
        fontToken: "mono",
        fontSize: fs.sectionHeading,
        color: "#777",
        textTransform: "uppercase",
        letterSpacing: 0.2,
      }),
    );
    sy += 5;
    nodes.push(
      stackText(cv.interests.join(", "), {
        name: "Interests body",
        x: sidebarX,
        y: sy,
        w: COL.sidebarWidth,
        h: 8,
        fontSize: fs.body,
        lineHeight: 1.35,
      }),
    );
  }

  // —— main column: experience ——
  let my = cursorY;

  nodes.push(
    stackText("Experience", {
      name: "Experience heading",
      x: mainX,
      y: my,
      w: mainW,
      h: 4,
      fontToken: "mono",
      fontSize: fs.sectionHeading,
      color: "#777",
      textTransform: "uppercase",
      letterSpacing: 0.2,
    }),
  );
  my += 6;

  for (const exp of cv.experiences) {
    nodes.push(
      stackText(`${exp.role} · ${exp.company}`, {
        name: `Exp:${exp.company} role`,
        x: mainX,
        y: my,
        w: mainW * 0.7,
        h: 6,
        fontToken: "display",
        fontSize: fs.experienceRole,
        lineHeight: 1.15,
      }),
    );
    nodes.push(
      stackText(`${exp.dates.start} — ${exp.dates.end}`, {
        name: `Exp:${exp.company} dates`,
        x: mainX + mainW * 0.7,
        y: my + 1,
        w: mainW * 0.3,
        h: 4,
        fontToken: "mono",
        fontSize: fs.experienceDate,
        color: "#777",
        textAlign: "right",
      }),
    );
    my += 7;

    if (exp.summary) {
      nodes.push(
        stackText(exp.summary, {
          name: `Exp:${exp.company} summary`,
          x: mainX,
          y: my,
          w: mainW,
          h: 5,
          fontToken: "display",
          fontSize: 11,
          italic: true,
          color: "#555",
        }),
      );
      my += 6;
    }

    if (exp.bullets && exp.bullets.length > 0) {
      for (const b of exp.bullets) {
        nodes.push(
          stackText(`• ${b}`, {
            name: `Exp:${exp.company} bullet`,
            x: mainX,
            y: my,
            w: mainW,
            h: 5,
            fontSize: fs.bullet,
            lineHeight: 1.35,
          }),
        );
        my += 5;
      }
    }
    my += 4;
  }

  return {
    slug: cv.slug,
    targetRole: cv.targetRole,
    pages: [
      {
        id: nanoid(8),
        width: A4.width,
        height: A4.height,
        nodes,
      },
    ],
    theme: defaultTheme,
    updatedAt: Date.now(),
  };
}

export function seedFor(slug: string): CvDocument {
  if (slug === "default") return seedFromDefault();
  // Blank page for a new variant — user drags in what they need.
  return {
    slug,
    targetRole: "Untitled",
    pages: [
      {
        id: nanoid(8),
        width: A4.width,
        height: A4.height,
        nodes: [],
      },
    ],
    theme: defaultTheme,
    updatedAt: Date.now(),
  };
}
