import type { Brief } from "@/lib/brief";

export function BriefCard({ brief, label }: { brief: Brief | null; label: string }) {
  if (!brief || brief.bullets.length === 0) return null;
  return (
    <section className="brief" aria-label={label}>
      <h3>Summary</h3>
      <p className="brief-note">From the notes on file.</p>
      {brief.lead ? <p className="brief-lead">{brief.lead}</p> : null}
      <ul>
        {brief.bullets.map((bullet, index) => (
          <li key={`${index}-${bullet}`}>{bullet}</li>
        ))}
      </ul>
    </section>
  );
}
