import Link from "next/link";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backHref,
  backLabel
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return <header className="page-header"><div className="page-heading">{backHref ? <Link className="back-link" href={backHref}>← {backLabel || "Back"}</Link> : null}{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}<h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="page-actions">{actions}</div> : null}</header>;
}
