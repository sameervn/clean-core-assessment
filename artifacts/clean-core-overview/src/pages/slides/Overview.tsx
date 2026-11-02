const base = import.meta.env.BASE_URL;

export default function Overview() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg font-body text-text">
      <header className="absolute left-[4vw] top-[3.4vh] right-[17vw]">
        <h1 className="font-display text-[3vw] font-bold leading-[1.1] text-primary">Clean Core Assessment Accelerator</h1>
      </header>
      <img src={`${base}yash-logo.png`} crossOrigin="anonymous" alt="YASH Technologies — More than what you think." className="absolute right-[2vw] top-[1.5vh] w-[11vw] h-[12vh] object-contain" />
      <div className="absolute left-0 top-[11.4vh] w-[84vw] h-[0.5vh] bg-accent" />
      <div className="absolute left-[83vw] top-[9.9vh] w-[2vw] h-[3.5vh] bg-muted [clip-path:polygon(25%_0,75%_0,100%_50%,75%_100%,25%_100%,0_50%)]" />
      <p className="absolute left-[4vw] top-[13.4vh] w-[91vw] text-[1.5vw] leading-[1.15] text-slate-600">A governed workspace for assessing custom objects and interfaces against S/4HANA 2025 Clean Core principles</p>
      <div className="absolute left-[4vw] top-[20.5vh] right-[4vw] flex gap-[1vw] text-[1.5vw] leading-[1.2]">
        <p className="rounded-full bg-[#e8f4f9] px-[1.3vw] py-[1vh] whitespace-nowrap">Area: <strong>Clean Core</strong></p>
        <p className="rounded-full bg-[#e8f4f9] px-[1.3vw] py-[1vh] whitespace-nowrap">Owner: <strong>YASH Accelerator</strong></p>
        <p className="rounded-full bg-[#e8f4f9] px-[1.3vw] py-[1vh] whitespace-nowrap">Target: <strong>S/4HANA 2025</strong></p>
      </div>
      <p className="absolute left-[4vw] top-[27vh] text-[1.5vw] leading-[1.2] text-slate-600"><strong className="text-muted">Inputs:</strong> Inventory, ATC, usage, interfaces &amp; source code</p>
      <section className="absolute left-[4vw] top-[31vh] w-[25vw] h-[51vh] rounded-[1vw] border border-slate-200 bg-[#f2f6f8] p-[1.6vw]">
        <h2 className="text-[1.8vw] font-bold text-muted mb-[2.5vh]">Why it matters</h2>
        <ul className="list-disc pl-[1.4vw] space-y-[2.5vh] text-[1.5vw] leading-[1.2] marker:text-accent">
          <li>Fragmented evidence slows assessment and prioritization</li>
          <li>Inactive objects and risky extensions need clear, traceable decisions</li>
          <li>Teams need consistent recommendations and reviewer sign-off</li>
        </ul>
      </section>
      <section className="workflow absolute left-[31vw] top-[31vh] w-[37vw] h-[51vh]">
        <h2 className="text-[1.8vw] font-bold text-muted mb-[1.2vh]">How it works</h2>
        <div className="flex gap-[1vw] mb-[1.4vh]">
          <span className="shrink-0 rounded-full bg-accent text-white font-bold w-[2.5vw] h-[4.4vh] flex items-center justify-center text-[1.5vw]">1</span>
          <div className="text-[1.5vw] leading-[1.13]"><h3 className="font-bold text-muted">Collect</h3><p>Normalize inventory, ATC, usage, modification and interface evidence</p></div>
        </div>
        <div className="flex gap-[1vw] mb-[1.4vh]">
          <span className="shrink-0 rounded-full bg-accent text-white font-bold w-[2.5vw] h-[4.4vh] flex items-center justify-center text-[1.5vw]">2</span>
          <div className="text-[1.5vw] leading-[1.13]"><h3 className="font-bold text-muted">Assess</h3><p>Classify objects and interfaces using evidence and source-risk checks</p></div>
        </div>
        <div className="flex gap-[1vw] mb-[1.4vh]">
          <span className="shrink-0 rounded-full bg-accent text-white font-bold w-[2.5vw] h-[4.4vh] flex items-center justify-center text-[1.5vw]">3</span>
          <div className="text-[1.5vw] leading-[1.13]"><h3 className="font-bold text-muted">Recommend</h3><p>Use uploaded guidance first; optional AI explanations through the approved gateway</p></div>
        </div>
        <div className="flex gap-[1vw] mb-[1.4vh]">
          <span className="shrink-0 rounded-full bg-accent text-white font-bold w-[2.5vw] h-[4.4vh] flex items-center justify-center text-[1.5vw]">4</span>
          <div className="text-[1.5vw] leading-[1.13]"><h3 className="font-bold text-muted">Review</h3><p>Developers submit; reviewers refine narratives and approve versioned assessments</p></div>
        </div>
        <div className="flex gap-[1vw]">
          <span className="shrink-0 rounded-full bg-accent text-white font-bold w-[2.5vw] h-[4.4vh] flex items-center justify-center text-[1.5vw]">5</span>
          <div className="text-[1.5vw] leading-[1.13]"><h3 className="font-bold text-muted">Export</h3><p>Download company-template reports and retain approved assessment snapshots</p></div>
        </div>
      </section>
      <section className="absolute left-[70vw] top-[31vh] w-[26vw] h-[51vh] rounded-[1vw] border border-[#d5e8f3] bg-[#e8f4fb] p-[1.6vw]">
        <h2 className="text-[1.8vw] font-bold text-muted mb-[2.5vh]">Capabilities</h2>
        <ul className="list-disc pl-[1.4vw] space-y-[0.8vh] text-[1.5vw] leading-[1.1] marker:text-accent">
          <li>Object and interface assessment workspace</li>
          <li>In-use / not-in-use views with unknown usage identified</li>
          <li>Read-only GitHub source ingestion and traceable findings</li>
          <li>Editable assessments and XS–XXL complexity sizing</li>
          <li>Knowledge-first guidance and role-based approvals</li>
          <li>Company Word templates and approved export archive</li>
        </ul>
      </section>
      <div className="absolute left-[4vw] right-[4vw] top-[84vh] rounded-[0.5vw] bg-muted px-[1.6vw] py-[1.5vh] text-white text-[1.5vw] leading-[1.2]">
        Turns fragmented Clean Core evidence into a consistent, reviewable assessment and mitigation roadmap.
      </div>
      <footer className="absolute bottom-0 left-0 right-0 h-[4.7vh] flex items-center justify-center bg-gradient-to-r from-[#06245d] via-[#8199ad] to-[#f0ad1b] text-[1.5vw] text-white">
        © 2026 YASH Technologies | www.YASH.com | Confidential
      </footer>
    </div>
  );
}
