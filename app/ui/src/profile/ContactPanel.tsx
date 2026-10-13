// Contact and links (hi-fi: profile.html, Master profile): the name in Latin and Cyrillic, the job
// address, phone, city, links and an optional photo, shown as a list with Edit opening the form in place.
import type { Contact, ContactDetails, ContactField, ContactProblem } from "@apply-kit/core";
import { useRef, useState, type FormEvent } from "react";
import { removePhoto, saveContact, uploadPhoto } from "../api.ts";
import { message } from "./common.tsx";

interface Draft extends Omit<ContactDetails, "links"> {
  links: string;
}

const draftOf = (c: Contact): Draft => ({ ...c, links: c.links.join("\n") });
const linkText = (l: string) => l.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

export function ContactPanel({ contact, onChange, announce }: {
  contact: Contact;
  onChange: (c: Contact) => void;
  announce: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problems, setProblems] = useState<ContactProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const empty = !contact.nameLatin;

  const close = () => { setDraft(null); setProblems([]); window.setTimeout(() => editRef.current?.focus(), 0); };
  const problem = (f: ContactField) => problems.find((p) => p.field === f);
  const set = (patch: Partial<Draft>) => draft && setDraft({ ...draft, ...patch });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const result = await saveContact({ ...draft, links: draft.links.split("\n") });
      if (!result.saved) {
        setProblems(result.problems);
        window.setTimeout(() => summaryRef.current?.focus(), 0);
        return;
      }
      onChange(result.contact);
      announce("Contact details saved. Every new CV, letter and portal answer uses them.");
      close();
    } catch (err) {
      setProblems([{ field: "nameLatin", message: `Couldn't save: ${message(err)}` }]);
    } finally {
      setSaving(false);
    }
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      const result = await uploadPhoto(file);
      if (!result.saved) { setPhotoError(result.problems[0]!.message); return; }
      onChange(result.contact);
      announce(`Photo saved: ${file.name}. It's used only in packages where you switch it on.`);
    } catch (err) {
      setPhotoError(`Couldn't save the photo: ${message(err)}`);
    }
  }

  async function dropPhoto() {
    try {
      onChange(await removePhoto());
      announce("Photo removed.");
    } catch (err) {
      setPhotoError(`Couldn't remove the photo: ${message(err)}`);
    }
  }

  const field = (f: keyof Draft & ContactField, label: string, opts: { help?: string; type?: string; lang?: string; autoComplete?: string } = {}) => {
    const p = problem(f);
    const ids = [opts.help && `ct-${f}-help`, p && `ct-${f}-err`].filter(Boolean).join(" ") || undefined;
    return (
      <div className="field">
        <label htmlFor={`ct-${f}`}>{label}</label>
        {opts.help && <span className="help" id={`ct-${f}-help`}>{opts.help}</span>}
        <input
          className="input" id={`ct-${f}`} type={opts.type ?? "text"} lang={opts.lang} autoComplete={opts.autoComplete ?? "off"}
          value={draft?.[f] ?? ""} onChange={(e) => set({ [f]: e.target.value })}
          aria-invalid={p ? true : undefined} aria-describedby={ids} ref={f === "nameLatin" ? firstRef : undefined}
        />
        {p && <span className="err" id={`ct-${f}-err`}>{p.message}</span>}
      </div>
    );
  };

  return (
    <section className="panel" aria-labelledby="contact-h">
      <div className="sec-head">
        <h2 className="grow" id="contact-h">Contact and links</h2>
        {!draft && (
          <button className="btn sm" type="button" ref={editRef} onClick={() => { setDraft(draftOf(contact)); window.setTimeout(() => firstRef.current?.focus(), 0); }}>
            {empty ? "Add" : "Edit"}<span className="sr-only"> contact and links</span>
          </button>
        )}
      </div>

      {!draft && (empty
        ? <p className="muted mini">Your name, the job address, phone, city and links, used the same way in every CV, letter and portal.</p>
        : (
          <dl className="kv">
            <dt>Name</dt>
            <dd>{contact.nameLatin}{contact.nameCyrillic && <> · <span lang="bg">{contact.nameCyrillic}</span></>}</dd>
            <dt>Email</dt>
            <dd>{contact.email || <span className="meta">Not given</span>}{contact.email && <span className="meta"> · the job address, so portal emails are tracked</span>}</dd>
            <dt>Phone</dt>
            <dd className="num">{contact.phone || <span className="meta">Not given</span>}</dd>
            <dt>Location</dt>
            <dd>{[contact.city, contact.country].filter(Boolean).join(", ") || <span className="meta">Not given</span>}</dd>
            <dt>Links</dt>
            <dd className="links">{contact.links.length ? contact.links.map((l) => <a key={l} href={l} target="_blank" rel="noreferrer">{linkText(l)}</a>) : <span className="meta">None</span>}</dd>
            <dt>Photo</dt>
            <dd>{contact.photo ? `${contact.photo.fileName}, used only in packages where you switch it on` : <span className="meta">None. CVs go without one unless you add it.</span>}</dd>
          </dl>
        ))}

      {draft && (
        <form className="form" onSubmit={(e) => void submit(e)} noValidate>
          {problems.length > 0 && (
            <div className="banner error errsum" role="alert" tabIndex={-1} ref={summaryRef}>
              <b>{problems.length === 1 ? "1 thing" : `${problems.length} things`} to fix before saving</b>
              <ul>{problems.map((p) => <li key={p.field + p.message}><a href={`#ct-${p.field}`} onClick={(e) => { e.preventDefault(); document.getElementById(`ct-${p.field}`)?.focus(); }}>{p.message}</a></li>)}</ul>
            </div>
          )}
          <div className="pair">
            {field("nameLatin", "Name", { help: "As on an English CV, in Latin letters.", autoComplete: "name" })}
            {field("nameCyrillic", "Name in Cyrillic", { help: "Used on Bulgarian CVs. Optional.", lang: "bg" })}
          </div>
          {field("email", "Email", { type: "email", help: "Use the job address, so portal emails are tracked.", autoComplete: "email" })}
          <div className="pair">
            {field("phone", "Phone", { type: "tel", help: "With the country code, e.g. +359.", autoComplete: "tel" })}
            {field("city", "City", { autoComplete: "address-level2" })}
          </div>
          {field("country", "Country", { autoComplete: "country-name" })}
          <div className="field">
            <label htmlFor="ct-links">Links</label>
            <span className="help" id="ct-links-help">LinkedIn, GitHub, a portfolio. One per line.</span>
            <textarea
              className="textarea" id="ct-links" value={draft.links} onChange={(e) => set({ links: e.target.value })}
              aria-invalid={problem("links") ? true : undefined}
              aria-describedby={problem("links") ? "ct-links-help ct-links-err" : "ct-links-help"}
            />
            {problem("links") && <span className="err" id="ct-links-err">{problem("links")!.message}</span>}
          </div>
          <div className="field">
            <span className="label" id="ct-photo-l">Photo</span>
            <span className="help" id="ct-photo-help">Optional, JPEG or PNG. Off in every package unless you switch it on there.</span>
            <div className="row">
              <label className="btn sm" htmlFor="ct-photo">{contact.photo ? "Replace photo" : "Choose a photo"}</label>
              <input
                id="ct-photo" className="sr-only" type="file" accept="image/jpeg,image/png" aria-labelledby="ct-photo-l"
                aria-describedby={photoError ? "ct-photo-help ct-photo-err" : "ct-photo-help"}
                onChange={(e) => { void choosePhoto(e.target.files?.[0]); e.target.value = ""; }}
              />
              {contact.photo && (
                <>
                  <span className="meta">{contact.photo.fileName}</span>
                  <button className="btn ghost sm" type="button" onClick={() => void dropPhoto()}>Remove<span className="sr-only"> photo</span></button>
                </>
              )}
            </div>
            {photoError && <span className="err" id="ct-photo-err" role="alert">{photoError}</span>}
          </div>
          <div className="row">
            <button className="btn primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            <button className="btn ghost" type="button" onClick={close}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
