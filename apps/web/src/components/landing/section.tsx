import type { ReactNode } from "react";

interface SectionProps {
	eyebrow?: string;
	title: string;
	blurb?: string;
	children: ReactNode;
	id?: string;
}

export function Section({ eyebrow, title, blurb, children, id }: SectionProps) {
	return (
		<section className="landing-section" id={id}>
			<div className="landing-section-inner">
				<div className="landing-section-head">
					{eyebrow && <span className="label-mono">{eyebrow}</span>}
					<h2 className="landing-section-title">{title}</h2>
					{blurb && <p className="landing-section-blurb">{blurb}</p>}
				</div>
				{children}
			</div>
		</section>
	);
}
