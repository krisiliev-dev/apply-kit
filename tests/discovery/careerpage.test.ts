import { describe, expect, it } from "vitest";
import {
  extractAnchorPostings,
  extractJsonLdPostings,
} from "@/lib/discovery/sources/careerpage";

const PAGE = "https://acme.example/careers";

describe("careerpage JSON-LD extraction", () => {
  it("extracts a single JobPosting with org, location, and date", () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Security Engineer",
        url: "https://acme.example/jobs/sec-eng",
        datePosted: "2026-05-01",
        hiringOrganization: { "@type": "Organization", name: "Acme Security" },
        jobLocation: {
          "@type": "Place",
          address: { addressLocality: "Sofia", addressCountry: "BG" },
        },
        description: "<p>Do <b>security</b> things.</p>",
      })}</script></head><body></body></html>`;

    const posts = extractJsonLdPostings(PAGE, html, 1000);
    expect(posts).toHaveLength(1);
    const p = posts[0];
    expect(p.title).toBe("Security Engineer");
    expect(p.company).toBe("Acme Security");
    expect(p.url).toBe("https://acme.example/jobs/sec-eng");
    expect(p.location).toContain("Sofia");
    expect(p.source).toEqual({ kind: "careerpage", url: PAGE, site: "acme.example" });
    expect(p.description).toBe("Do security things.");
    expect(p.postedAt).toBe(Date.parse("2026-05-01"));
  });

  it("handles an @graph array with multiple postings", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "WebSite", name: "Acme" },
        { "@type": "JobPosting", title: "Pentester", url: "https://acme.example/jobs/pt" },
        { "@type": ["JobPosting"], title: "SOC Analyst", url: "https://acme.example/jobs/soc" },
      ],
    })}</script>`;
    const posts = extractJsonLdPostings(PAGE, html, 1000);
    expect(posts.map((p) => p.title).sort()).toEqual(["Pentester", "SOC Analyst"]);
  });

  it("returns nothing when there's no JobPosting JSON-LD", () => {
    expect(extractJsonLdPostings(PAGE, "<html><body>no jobs</body></html>")).toEqual([]);
  });

  it("gives the same posting a stable id across runs", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Security Engineer",
      url: "https://acme.example/jobs/sec-eng",
    })}</script>`;
    const a = extractJsonLdPostings(PAGE, html, 1)[0];
    const b = extractJsonLdPostings(PAGE, html, 999)[0];
    expect(a.id).toBe(b.id);
  });
});

describe("careerpage anchor fallback", () => {
  it("picks links that look like job postings, resolving relative URLs", () => {
    const html = `<body>
      <a href="/jobs/123">Senior Security Engineer</a>
      <a href="/about">About us</a>
      <a href="/careers/pentester">Penetration Tester</a>
      <a href="https://x/blog">Some blog post</a>
    </body>`;
    const posts = extractAnchorPostings(PAGE, html, 1000);
    const titles = posts.map((p) => p.title);
    expect(titles).toContain("Senior Security Engineer");
    expect(titles).toContain("Penetration Tester");
    expect(titles).not.toContain("About us");
    expect(posts[0].url.startsWith("https://acme.example/")).toBe(true);
  });
});
