import { forwardRef } from "react";
import { estimate, type ContractFull, type LineItem } from "../lib/estimate";
import { brandAssets } from "../lib/brandAssets";
import styles from "./QuotationDocument.module.css";

type Props = { contract: ContractFull; className?: string };

const INCLUDED = [
  "BWP, Anti Termite Ply, Outer & Inner Sunmica Finish",
  "Design consultation & space planning",
  "3D visualisation and drawings",
  "Carpentry and modular furniture",
  "Electrical work and lighting for furnitures",
  "Installation and final finishing",
  "Cleaning the rubbish materials and placing the sacs outside",
];

const NOT_INCLUDED = [
  "Appliances (AC, fridge, chimney, geyser, etc.)",
  "Loose furniture (sofa, dining table, chairs, etc.), except mentioned in the scope above",
  "Curtains, mattress, blinds and rugs",
  "Decorative accessories, wall paint, lights and artefacts",
  "Government / building charges",
  "Items not mentioned in the scope above",
];

const PAYMENTS = [
  { pct: 10, title: "Booking / Confirmation", sub: "On agreement signing" },
  { pct: 20, title: "Design Approval", sub: "After final 3D design & material selection" },
  { pct: 30, title: "Material Procurement", sub: "On start of production / procurement" },
  { pct: 30, title: "Installation", sub: "On-site execution and installation" },
  { pct: 10, title: "Handover", sub: "After final completion and handover" },
];

const TIMELINE = [
  { title: "Design", sub: "2–3 weeks" },
  { title: "Material Finalisation", sub: "1–2 weeks" },
  { title: "Production", sub: "3–4 weeks" },
  { title: "Installation", sub: "3–4 weeks" },
  { title: "Handover", sub: "" },
];

const TERMS = [
  "This quotation is valid for 15 days from the date of issue.",
  "Any changes in scope or materials may affect the final cost and timeline.",
  "Work will be executed as per approved drawings and material selection.",
  "Advance payments are non-refundable.",
  "Delays due to client-side changes, approvals or site conditions may impact the timeline.",
];

const ROWS_PER_PAGE = 19;
const ROWS_WITH_TOTALS = 16;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}

/** Table pages: full pages hold ROWS_PER_PAGE rows, the last one leaves room for the totals. */
function paginateRows<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  let rest = rows;
  while (rest.length > ROWS_WITH_TOTALS) {
    const take = Math.min(ROWS_PER_PAGE, rest.length - 1);
    out.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  out.push(rest);
  return out;
}

type Row = { kind: "group"; label: string } | { kind: "line"; n: string; child: boolean; line: LineItem };

function PageHead({ num, title }: { num: string; title: string }) {
  return (
    <div className={styles.pageHead}>
      <div>
        <div className={styles.secNum}>{num}</div>
        <div className={styles.secTitle}>{title}</div>
      </div>
      <img src={brandAssets.logoDark} alt="Interior Editors" className={styles.miniLogo} />
    </div>
  );
}

function Foot() {
  return <div className={styles.foot}>{brandAssets.contact.website}</div>;
}

function Img({ src, className }: { src?: string; className?: string }) {
  return src ? (
    <img src={src} alt="" className={`${styles.img} ${className ?? ""}`} />
  ) : (
    <div className={`${styles.img} ${styles.imgPlaceholder} ${className ?? ""}`} />
  );
}

export const QuotationDocument = forwardRef<HTMLDivElement, Props>(function QuotationDocument({ contract, className }, ref) {
  const groups = estimate.groupByCategory(contract.lineItems);

  const rows: Row[] = [];
  let n = 0;
  const multiRoom = groups.length > 1;
  for (const g of groups) {
    if (multiRoom) rows.push({ kind: "group", label: g.category });
    let sub = 0;
    for (const line of g.lines) {
      const child = line.parentItemId != null && g.lines.some((l) => l.itemId === line.parentItemId);
      if (child) rows.push({ kind: "line", n: `${n}.${++sub}`, child, line });
      else {
        sub = 0;
        rows.push({ kind: "line", n: String(++n), child: false, line });
      }
    }
  }
  /** "TV Unit (Puja Unit, Crockery Display)" for the scope page. */
  const scopeText = (lines: LineItem[]) =>
    lines
      .filter((l) => l.parentItemId == null || !lines.some((m) => m.itemId === l.parentItemId))
      .map((m) => {
        const kids = lines.filter((l) => l.parentItemId === m.itemId).map((l) => l.name);
        return kids.length ? `${m.name} (with ${kids.join(", ")})` : m.name;
      })
      .join(", ");
  const costPages = paginateRows(rows);
  // Scope rows grow with their text, so fill each page by estimated height.
  const scopePages: (typeof groups)[] = [[]];
  let used = 70; // intro line on the first page
  for (const g of groups) {
    const lines = Math.ceil(scopeText(g.lines).length / 40);
    const h = Math.max(140, lines * 23 + 36) + 16;
    if (used + h > 900 && scopePages[scopePages.length - 1].length) {
      scopePages.push([]);
      used = 0;
    }
    scopePages[scopePages.length - 1].push(g);
    used += h;
  }
  const dateStr = estimate.formatDate(contract.signedAt || contract.createdAt);
  const tierLabel = estimate.TIERS[contract.tier]?.label ?? contract.tier;

  return (
    <div ref={ref} className={`${styles.doc} ${className ?? ""}`}>
      {/* Cover */}
      <section className={`${styles.page} ${styles.cover}`} data-pdf-page>
        <img src={brandAssets.cover} alt="" className={styles.coverImg} />
        <div className={styles.coverShade} />
        <div className={styles.coverInner}>
          <img src={brandAssets.logoLight} alt="Interior Editors" className={styles.coverLogo} />
          <div className={styles.coverText}>
            <div className={styles.coverKicker}>DESIGN &nbsp;·&nbsp; TRANSFORM &nbsp;·&nbsp; INSPIRE</div>
            <div className={styles.coverTitle}>
              Interior Design
              <br />
              Quotation
            </div>
            <div className={styles.coverRule} />
            <div className={styles.coverLine}>A home that feels like you</div>
            <div className={styles.coverFor}>
              Prepared for <strong>{contract.clientName}</strong> · {contract.quotationNo}
            </div>
          </div>
          <div className={styles.coverWeb}>{brandAssets.contact.website}</div>
        </div>
      </section>

      {/* Overview */}
      <section className={styles.page} data-pdf-page>
        <PageHead num="01" title="Project Overview" />
        <div className={styles.overview}>
          <div className={styles.overviewLeft}>
            <table className={styles.facts}>
              <tbody>
                {[
                  ["Client Name", contract.clientName],
                  ["Project Scope", contract.projectScope || groups.map((g) => g.category).join(", ")],
                  ["Address", contract.siteAddress || "—"],
                  ["Configuration", `${contract.bhk} BHK · ${tierLabel} finish`],
                  ["Carpet Area", `${estimate.formatNumber(contract.carpetArea)} sq. ft. approx`],
                  ["Quotation No.", contract.quotationNo],
                  ["Date", dateStr],
                  ["Quotation Validity", "15 Days"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td>:</td>
                    <td className={k === "Project Scope" && v.length > 40 ? styles.factLong : undefined}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.rule} />
            <div className={styles.h2}>Design Vision</div>
            <p className={styles.vision}>
              A modern, functional and elegant home designed around the client's lifestyle. Our approach blends thoughtful
              design, quality materials and seamless execution to create a space you'll love for years.
            </p>
            <div className={styles.script}>
              Let's build
              <br />
              something usable!!
            </div>
          </div>
          <Img src={brandAssets.overview} className={styles.overviewImg} />
        </div>
        <Foot />
      </section>

      {/* Scope */}
      {scopePages.map((page, pi) => (
        <section key={`scope-${pi}`} className={styles.page} data-pdf-page>
          <PageHead num="02" title={pi === 0 ? "Scope of Work" : "Scope of Work (contd.)"} />
          {pi === 0 && <p className={styles.intro}>Our scope covers complete interior design and execution for the following areas:</p>}
          <div className={styles.scopeList}>
            {page.map((g) => (
              <div key={g.category} className={styles.scopeRow}>
                <Img src={brandAssets.scope[g.category] || brandAssets.scopeFallback} className={styles.scopeImg} />
                <div className={styles.scopeCat}>{g.category}</div>
                <div className={styles.scopeItems}>{scopeText(g.lines)}</div>
              </div>
            ))}
          </div>
          <Foot />
        </section>
      ))}

      {/* Costing */}
      {costPages.map((page, pi) => {
        const last = pi === costPages.length - 1;
        return (
          <section key={`cost-${pi}`} className={styles.page} data-pdf-page>
            <PageHead num="03" title={pi === 0 ? "Detailed Costing" : "Detailed Costing (contd.)"} />
            <table className={styles.cost}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Rate (₹)</th>
                  <th>Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {page.map((r, i) =>
                  r.kind === "group" ? (
                    <tr key={`g-${i}`} className={styles.groupRow}>
                      <td colSpan={6}>{r.label}</td>
                    </tr>
                  ) : (
                    <tr key={`l-${r.line.itemId}-${i}`} className={r.child ? styles.childRow : undefined}>
                      <td>{r.n}</td>
                      <td>{r.child ? `+ ${r.line.name}` : r.line.name}</td>
                      <td>{r.line.description}</td>
                      <td>
                        {r.line.unit === "lumpsum" ? "" : estimate.formatNumber(r.line.qty)}
                        {r.line.unit !== "lumpsum" && r.line.unit !== "sqft" ? <small> {estimate.UNIT_LABEL[r.line.unit]}</small> : null}
                      </td>
                      <td>{r.line.rate ? estimate.formatNumber(r.line.rate) : ""}</td>
                      <td>{r.line.amount ? estimate.formatNumber(r.line.amount) : "Included"}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {last && (
              <div className={styles.totals}>
                <div className={styles.totalRow}>
                  <span>Total</span>
                  <span>{estimate.formatNumber(contract.total)}</span>
                </div>
                <div className={styles.projectValue}>
                  <span>
                    PROJECT
                    <br />
                    VALUE
                  </span>
                  <span>{estimate.formatNumber(contract.total)}</span>
                </div>
              </div>
            )}
            {last && (
              <p className={styles.note}>
                Note: This is an estimated quotation. Final pricing will vary based on final design, material selection and
                site conditions.
              </p>
            )}
            <Foot />
          </section>
        );
      })}

      {/* Included */}
      <section className={styles.page} data-pdf-page>
        <PageHead num="04" title="What's Included" />
        <ul className={styles.checks}>
          {INCLUDED.map((t) => (
            <li key={t}>
              <span className={styles.badge}>✓</span>
              {t}
            </li>
          ))}
        </ul>
        <div className={styles.ruleWide} />
        <div className={styles.h2}>What's Not Included</div>
        <ul className={styles.checks}>
          {NOT_INCLUDED.map((t) => (
            <li key={t}>
              <span className={`${styles.badge} ${styles.badgeX}`}>×</span>
              {t}
            </li>
          ))}
        </ul>
        <Foot />
      </section>

      {/* Payment */}
      <section className={styles.page} data-pdf-page>
        <PageHead num="05" title="Payment Schedule" />
        <div className={styles.payments}>
          {PAYMENTS.map((p) => (
            <div key={p.title} className={styles.payRow}>
              <span className={styles.payDot} />
              <span className={styles.payPct}>{p.pct}%</span>
              <span>
                <strong>{p.title}</strong>
                <br />
                <span className={styles.paySub}>
                  {p.sub} · ₹{estimate.formatNumber((contract.total * p.pct) / 100)}
                </span>
              </span>
            </div>
          ))}
        </div>
        <div className={styles.ruleWide} />
        <div className={styles.h2}>Project Timeline (Estimated)</div>
        <div className={styles.timeline}>
          {TIMELINE.map((t, i) => (
            <div key={t.title} className={styles.tStep}>
              <div className={styles.tDotRow}>
                <span className={styles.tDot}>{i + 1}</span>
                {i < TIMELINE.length - 1 && <span className={styles.tLine} />}
              </div>
              <strong>{t.title}</strong>
              <small>{t.sub}</small>
            </div>
          ))}
        </div>
        <Foot />
      </section>

      {/* Terms */}
      <section className={styles.page} data-pdf-page>
        <PageHead num="06" title="Terms & Acceptance" />
        <ol className={styles.terms}>
          {TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <div className={styles.ruleWide} />
        <div className={styles.ready}>
          <div className={styles.readyTitle}>Ready to transform your space?</div>
          <div>We're excited to bring your dream home to life.</div>
        </div>
        <div className={styles.signs}>
          <div className={styles.signCol}>
            <div className={styles.signValue}>{contract.clientName}</div>
            <div className={styles.signLine} />
            <small>Client Name</small>
          </div>
          <div className={styles.signCol}>
            {contract.clientSignature && <img src={contract.clientSignature} alt="Client signature" className={styles.signImg} />}
            <div className={styles.signLine} />
            <small>Signature</small>
          </div>
          <div className={styles.signCol}>
            <div className={styles.signValue}>{dateStr}</div>
            <div className={styles.signLine} />
            <small>Date</small>
          </div>
        </div>
        <div className={styles.signs}>
          <div className={styles.signCol}>
            <div className={styles.signValue}>{contract.designerName || "Interior Editors"}</div>
            <div className={styles.signLine} />
            <small>For Interior Editors</small>
          </div>
          <div className={styles.signCol}>
            {contract.designerSignature && (
              <img src={contract.designerSignature} alt="Designer signature" className={styles.signImg} />
            )}
            <div className={styles.signLine} />
            <small>Signature</small>
          </div>
          <div className={styles.signCol} />
        </div>
        <div className={styles.h3}>Let's stay in touch</div>
        <div className={styles.contact}>
          <div>☎ &nbsp; {brandAssets.contact.phone}</div>
          <div>✉ &nbsp; {brandAssets.contact.email}</div>
          <div>⌂ &nbsp; {brandAssets.contact.city}</div>
        </div>
        <img src={brandAssets.logoStackBrass} alt="Interior Editors" className={styles.logo} />
        <Foot />
      </section>
    </div>
  );
});
