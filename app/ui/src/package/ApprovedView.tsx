// The approved package (ticket #67; hi-fi: docs/design/hifi/package.html, state "Approved"): ready
// to apply, with "Open the target posting" and the extension's state; the parts as approved; the
// honesty decisions in words (to answer for them in an interview); the frozen files to download;
// and what happens next. Editing any part reopens its step for approval.
import type { ApprovedPackage, PackageView, PairedDevice } from "@apply-kit/core";
import { useEffect, useRef, useState } from "react";
import { fetchPairedDevices, frozenFileUrl } from "../api.ts";
import { Icon } from "../icons.tsx";

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/** The portal the extension fills, in words. */
const portalName: Record<NonNullable<ApprovedPackage["targetPosting"]["jobRef"]>["portal"], string> = {
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", smartrecruiters: "SmartRecruiters", workable: "Workable",
};

export function ApprovedView({ pkg, approved, onEdit }: { pkg: PackageView; approved: ApprovedPackage; onEdit: () => void }) {
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  // Arriving here (after Approve package, or from a link), focus starts at the heading.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchPairedDevices(ctrl.signal).then(setDevices).catch(() => setDevices(null));
    return () => ctrl.abort();
  }, []);

  const minutes = Math.max(0, Math.round((new Date(approved.approvedAt).getTime() - new Date(pkg.startedAt).getTime()) / 60_000));
  const portal = approved.targetPosting.jobRef ? portalName[approved.targetPosting.jobRef.portal] : null;
  const cv = pkg.cvVersion;
  const changes = cv?.changes.filter((c) => !c.undone).length ?? 0;
  const salary = pkg.answers?.questions.find((q) => q.salary)?.text;
  const saved = pkg.answers?.questions.filter((q) => q.save.savedTo).length ?? 0;
  const failing = approved.cv.ats.accepted.length;
  const paired = devices && devices.length > 0;

  return (
    <>
      <div className="pk-head">
        <h1 tabIndex={-1} ref={heading}>Package approved</h1>
        <div className="sub">
          <span><b>{approved.job.title}</b> at {approved.job.company}</span>
          <span className="num">Approved {hhmm(approved.approvedAt)} · {minutes} {minutes === 1 ? "minute" : "minutes"} since the package started</span>
          {approved.version > 1 && <span>Version {approved.version}</span>}
        </div>
      </div>
      <div className="banner success" role="status">
        <span className="text">
          <b>{approved.state === "submitted" ? `Submitted ${day(approved.submitted!.at)}.` : "Ready to apply."}</b>{" "}
          {approved.state === "submitted"
            ? "This is the package as sent; it stays as it is. Editing a part makes a new version."
            : `Open the target posting: the extension fills ${portal ? `the ${portal} form` : "the form"} from this package, and you check it and press Submit.`}
        </span>
      </div>
      <div className="cols">
        <div className="col">
          <div className="panel">
            <div className="row">
              <a className="btn primary" href={approved.targetPosting.url} target="_blank" rel="noreferrer">
                Open the target posting<span aria-hidden="true"> ↗</span><span className="sr-only"> ({approved.targetPosting.site}, opens in a new tab)</span>
              </a>
              <span className="meta">{approved.targetPosting.site} · {approved.job.title}</span>
            </div>
            <p className="meta">
              {devices === null ? null : paired
                ? <><span className="chip met"><Icon name="met" />Extension paired</span> It fills {portal ? `${portal} forms` : "the form"}. If it isn't running, the files and answers stay here to copy.</>
                : <><span className="chip partly"><Icon name="partly" />Extension not paired</span> Pair it in <a href="/sources">Sources › Extension</a> to fill the form; until then the files and answers are here to copy.</>}
            </p>
            <dl className="kv wide">
              <dt>CV version</dt>
              <dd>{approved.cv.label} · {pkg.cv?.pages === 1 ? "1 page" : `${pkg.cv?.pages ?? 1} pages`} · {pkg.photo ? "Standard with photo" : "Standard, no photo"} · {changes === 1 ? "1 change" : `${changes} changes`} from your master profile</dd>
              {pkg.letter && <><dt>Cover letter</dt><dd>{pkg.letter.words} words · draft {pkg.letter.draft}</dd></>}
              <dt>Screening answers</dt>
              <dd>{approved.answers.length}{salary ? ` · salary €${Number(salary).toLocaleString("en-GB")} gross` : ""}{saved ? ` · ${saved} saved to your answer bank` : ""}</dd>
              <dt>ATS check</dt>
              <dd>{approved.cv.ats.passed} of {approved.cv.ats.total} pass{failing ? ` · ${failing} failing ${failing === 1 ? "check" : "checks"} approved knowingly` : ""}</dd>
            </dl>
          </div>
          <div className="panel">
            <h2>Your decisions</h2>
            <p className="mini muted">So you can answer for them in an interview.</p>
            {approved.decisions.length
              ? <dl className="kv wide">{approved.decisions.map((d, i) => <Decision key={i} title={d.title} decision={d.decision} />)}</dl>
              : <p className="meta">No honesty decisions were needed: every line says what your profile says.</p>}
          </div>
        </div>
        <aside className="col side" aria-label="Files and what happens next">
          <div className="panel files-out">
            <h2>Files</h2>
            <a className="btn" href={frozenFileUrl(pkg.id, "cv", true)} download>Download CV (PDF)<span className="sr-only">, {approved.cv.file.fileName}</span></a>
            {approved.letter && <a className="btn" href={frozenFileUrl(pkg.id, "letter", true)} download>Download cover letter (PDF)<span className="sr-only">, {approved.letter.file.fileName}</span></a>}
            <p className="meta file-name">{approved.cv.file.fileName} · {kb(approved.cv.file.size)}</p>
            {approved.cv.file.copy && <p className="meta file-name" title={approved.cv.file.copy}>Also copied to your Packages folder ({approved.cv.file.copy.split("/").slice(-2, -1)[0]}).</p>}
          </div>
          <div className="panel">
            <h2>What happens next</h2>
            <ul className="notes">
              <li>When you press Submit in the portal, the extension's Mark as submitted logs the application under Applications.</li>
              <li>Until then the job sits in Saved with "Package ready".</li>
              <li>Editing any part reopens that step for approval; these files stay as they are.</li>
            </ul>
            <div className="row"><button className="btn ghost sm" type="button" onClick={onEdit}>Edit package</button></div>
          </div>
        </aside>
      </div>
    </>
  );
}

function Decision({ title, decision }: { title: string; decision: string }) {
  return <><dt>{title}</dt><dd>{decision}</dd></>;
}
