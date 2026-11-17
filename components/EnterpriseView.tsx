import { Fragment, useMemo, useState } from "react";
import {
  DEAL_STATUS_LABELS,
  DEAL_TYPE_LABELS,
  SECTION_LABELS,
  sectionPath,
  type TrackerCompany,
} from "@/lib/enterprise";
import { formatPretty } from "@/lib/format";
import type { DealStatus, NewsItem, TrackerSection } from "@/lib/types";

const SECTIONS: TrackerSection[] = ["deal", "neocloud", "datacenter"];
const STATUSES: DealStatus[] = ["done", "in_the_works", "rumored"];

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function latestItem(companyId: string, items: NewsItem[], today: string): NewsItem | null {
  const mine = items.filter((item) => item.tracker_companies?.includes(companyId));
  const done = mine.filter((item) => item.deal_status === "done" && item.date <= today);
  const pool = done.length > 0 ? done : mine.filter((item) => item.date <= today);
  return [...pool].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))[0] ?? null;
}

export function EnterpriseView({
  items,
  companies,
  section,
  today,
  onOpen,
}: {
  items: NewsItem[];
  companies: TrackerCompany[];
  section: TrackerSection;
  today: string;
  onOpen: (id: string) => void;
}) {
  const [companiesOn, setCompaniesOn] = useState<string[]>([]);
  const [typesOn, setTypesOn] = useState<string[]>([]);
  const [statusesOn, setStatusesOn] = useState<DealStatus[]>([]);
  const trackerItems = useMemo(() => items.filter((item) => item.enterprise_ai), [items]);
  const inSection = useMemo(
    () => trackerItems.filter((item) => item.tracker_sections?.includes(section)),
    [trackerItems, section],
  );
  const chips = useMemo(
    () => companies.filter((company) => company.sections.includes(section)).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [companies, section],
  );
  const cards = chips.filter((company) => company.card_in.includes(section));
  const types = [...new Set(inSection.map((item) => item.deal_type).filter((value): value is string => Boolean(value)))];
  const filtered = inSection.filter((item) => {
    if (companiesOn.length > 0 && !item.tracker_companies?.some((id) => companiesOn.includes(id))) return false;
    if (typesOn.length > 0 && !typesOn.includes(item.deal_type ?? "")) return false;
    if (statusesOn.length > 0 && !statusesOn.includes(item.deal_status ?? "done")) return false;
    return true;
  });
  const ordered = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  const groups: { date: string; items: NewsItem[] }[] = [];
  for (const item of ordered) {
    const last = groups[groups.length - 1];
    if (!last || last.date !== item.date) groups.push({ date: item.date, items: [item] });
    else last.items.push(item);
  }

  return (
    <div className="eai">
      <header className="eai-intro">
        <p className="kicker">Enterprise AI</p>
        <h2>Deals, neoclouds, and data-center buildouts</h2>
        <p>
          Partnerships, contracts, capacity, and campus updates from company pages and filings. A reported item is marked.
          The same item shows under every company it names, and on the calendar with the Enterprise AI badge.
          Connected tickers are names that appear in that company's sources.
        </p>
      </header>
      <nav className="eai-subnav" aria-label="Enterprise AI sections">
        {SECTIONS.map((entry) => (
          <a key={entry} href={sectionPath(entry)} aria-current={entry === section ? "page" : undefined}>
            {SECTION_LABELS[entry]}
          </a>
        ))}
      </nav>
      {cards.length > 0 ? (
        <div className={section === "deal" ? "watch-grid" : "watch-grid wide"}>
          {cards.map((company) => (
            <CompanyCard key={company.id} company={company} items={trackerItems} today={today} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
      <div className="eai-filters">
        <fieldset>
          <legend>Company</legend>
          <div className="chips">
            {chips.map((company) => (
              <button
                key={company.id}
                type="button"
                className="chip"
                aria-pressed={companiesOn.includes(company.id)}
                onClick={() => setCompaniesOn((current) => toggle(current, company.id))}
              >
                {company.ticker || company.name}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Type</legend>
          <div className="chips">
            {types.map((type) => (
              <button
                key={type}
                type="button"
                className="chip"
                aria-pressed={typesOn.includes(type)}
                onClick={() => setTypesOn((current) => toggle(current, type))}
              >
                {DEAL_TYPE_LABELS[type] ?? type}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Status</legend>
          <div className="chips">
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className="chip"
                aria-pressed={statusesOn.includes(status)}
                onClick={() =>
                  setStatusesOn((current) =>
                    current.includes(status) ? current.filter((entry) => entry !== status) : [...current, status],
                  )
                }
              >
                {DEAL_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <p className="tally">
        {ordered.length} {section === "deal" ? "deal" : section === "neocloud" ? "neocloud" : "data-center"} update
        {ordered.length === 1 ? "" : "s"} in this section.
      </p>
      {groups.length === 0 ? <p className="empty">Nothing matches these filters.</p> : null}
      <div className="timeline">
        {groups.map((group) => (
          <section key={group.date} className="t-day">
            <h3>{formatPretty(group.date)}</h3>
            <div className="t-cards">
              {group.items.map((item) => (
                <article key={item.id} className="card eai-card">
                  <button type="button" className="card-hit" onClick={() => onOpen(item.id)}>
                    <span className="swatch eai-swatch" aria-hidden="true" />
                    <span className="card-body">
                      <span className="card-title">{item.title}</span>
                      <span className="meta">
                        {item.deal_status ? (
                          <span className={`badge enterprise ${item.deal_status}`}>{DEAL_STATUS_LABELS[item.deal_status]}</span>
                        ) : null}
                        {item.unconfirmed ? <span className="badge enterprise reported">Reported</span> : null}
                        <span className="badge enterprise">Enterprise AI</span>
                        <span>{DEAL_TYPE_LABELS[item.deal_type ?? ""] ?? item.deal_type}</span>
                        <span>{item.companies.join(", ")}</span>
                      </span>
                      <span className="card-summary">{item.summary}</span>
                      {item.key_number ? <span className="eai-key">{item.key_number}</span> : null}
                      {item.why_it_matters ? <span className="follow">{item.why_it_matters}</span> : null}
                    </span>
                  </button>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function CompanyCard({
  company,
  items,
  today,
  onOpen,
}: {
  company: TrackerCompany;
  items: NewsItem[];
  today: string;
  onOpen: (id: string) => void;
}) {
  const latest = latestItem(company.id, items, today);
  const next = company.next_event;
  return (
    <article className="watch-card">
      <p className="kicker">{company.ticker || "Private"}</p>
      <h3>{company.name}</h3>
      <p>{company.blurb}</p>
      {company.location ? (
        <p className="watch-meta">
          {company.location}
          {company.project_status ? ` · ${company.project_status}` : ""}
        </p>
      ) : null}
      {company.size || company.cost || company.power ? (
        <dl className="watch-facts">
          {company.size ? (
            <>
              <dt>Size</dt>
              <dd>{company.size}</dd>
            </>
          ) : null}
          {company.cost ? (
            <>
              <dt>Cost</dt>
              <dd>{company.cost}</dd>
            </>
          ) : null}
          {company.power ? (
            <>
              <dt>Power</dt>
              <dd>{company.power}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {company.facts.length > 0 ? (
        <dl className="watch-facts">
          {company.facts.map((fact) => (
            <Fragment key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      {company.partners ? <p className="watch-meta">{company.partners}</p> : null}
      {company.links.length > 0 ? <p className="watch-meta">Connected: {company.links.join(", ")}</p> : null}
      <p className="watch-line">
        <span>Latest</span>
        {latest ? (
          <button type="button" onClick={() => onOpen(latest.id)}>
            {latest.title}
          </button>
        ) : (
          <span>No dated item yet.</span>
        )}
      </p>
      <p className="watch-line">
        <span>Next</span>
        {next ? (
          <button type="button" onClick={() => onOpen(next.item_id)}>
            {formatPretty(next.date)} · {next.label}
            {next.unconfirmed ? " · reported" : ""}
          </button>
        ) : (
          <span>No dated event announced.</span>
        )}
      </p>
    </article>
  );
}
