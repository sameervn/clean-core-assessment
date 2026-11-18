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
      <p className="absolute left-[4vw] top-[14vh] w-[86vw] text-[2vw] leading-[1.15] text-slate-600">Evidence-led decisions for custom objects and interfaces, targeting S/4HANA 2025.</p>
      <p className="absolute left-[4vw] top-[22vh] text-[1.5vw] font-semibold uppercase tracking-[0.08em] text-primary">Collect → Assess → Recommend → Review → Export</p>
      <section className="absolute left-[4vw] top-[28vh] w-[28.5vw] h-[36vh] rounded-[0.7vw] border border-slate-200 bg-[#f2f6f8] p-[1.4vw]">
        <h2 className="text-[2.1vw] font-bold text-muted mb-[1.5vh]">Evidence in</h2>
        <ul className="list-disc pl-[1.6vw] space-y-[1.5vh] text-[2vw] leading-[1.1] marker:text-accent">
          <li>Inventory &amp; ATC evidence</li>
          <li>GitHub: read-only code per object</li>
          <li>Dialog / batch &amp; interface usage</li>
        </ul>
      </section>
      <section className="absolute left-[35vw] top-[28vh] w-[28.5vw] h-[36vh] p-[1.4vw]">
        <h2 className="text-[2.1vw] font-bold text-muted mb-[1.5vh]">Governed assessment</h2>
        <ul className="list-disc pl-[1.6vw] space-y-[1.5vh] text-[2vw] leading-[1.1] marker:text-accent">
          <li>Classification &amp; recommendations</li>
          <li>Editable narratives; XS–XXL sizing</li>
          <li>Developer / reviewer approvals</li>
        </ul>
      </section>
      <section className="absolute left-[67.5vw] top-[28vh] w-[28.5vw] h-[36vh] rounded-[0.7vw] border border-[#d5e8f3] bg-[#e8f4fb] p-[1.4vw]">
        <h2 className="text-[2.1vw] font-bold text-muted mb-[1.5vh]">Client deliverables</h2>
        <ul className="list-disc pl-[1.6vw] space-y-[1.5vh] text-[2vw] leading-[1.1] marker:text-accent">
          <li>Mitigation roadmap</li>
          <li>Company-template Word reports</li>
          <li>Approved archive &amp; exports</li>
        </ul>
      </section>
      <p className="absolute left-[4vw] top-[65.5vh] w-[92vw] text-[1.5vw] leading-[1.15] text-slate-600">GitHub: no code writes or commits • Knowledge-first guidance • Unknown usage remains explicit</p>
      <section className="absolute left-[4vw] top-[71vh] w-[44.5vw] h-[19vh] rounded-[0.5vw] bg-muted px-[1.8vw] py-[1.5vh] text-white">
        <h2 className="text-[2vw] font-bold leading-[1.1] mb-[1vh]">Client-managed deployment</h2>
        <p className="text-[2vw] leading-[1.1]">Kubernetes + PostgreSQL / AWS RDS; files on a persistent volume. No S3 required.</p>
      </section>
      <section className="absolute left-[51.5vw] top-[71vh] w-[44.5vw] h-[19vh] rounded-[0.5vw] bg-[#e8f4fb] border border-[#d5e8f3] px-[1.8vw] py-[1.5vh]">
        <h2 className="text-[2vw] font-bold leading-[1.1] mb-[1vh] text-muted">YASHtech-hosted option</h2>
        <p className="text-[2vw] leading-[1.1]">Same container on YASH Kubernetes; dedicated client database &amp; file storage.</p>
      </section>
      <p className="absolute left-[4vw] top-[91vh] w-[92vw] text-[1.5vw] leading-[1.1] text-slate-600">Both: HTTPS + RBAC • Secret-mounted .env • Approved AI gateway • PVC: single replica • Subject to IT approval</p>
      <footer className="absolute bottom-0 left-0 right-0 h-[4.7vh] flex items-center justify-center bg-gradient-to-r from-[#06245d] via-[#8199ad] to-[#f0ad1b] text-[1.5vw] text-white">
        © 2026 YASH Technologies | www.YASH.com | Confidential
      </footer>
    </div>
  );
}
