export function SiteFooter() {
	return (
		<footer className="site-footer">
			<div className="site-footer-inner">
				<div className="site-footer-col">
					<div className="label-mono site-footer-col-title">PRODUCT</div>
					<a href="#how-it-works" className="site-footer-link">
						How it works
					</a>
					<a href="#quickstart" className="site-footer-link">
						Quickstart
					</a>
					<a href="#faq" className="site-footer-link">
						FAQ
					</a>
				</div>
				<div className="site-footer-col">
					<div className="label-mono site-footer-col-title">BUILD</div>
					<a
						href="https://github.com/sepivip/lobsterpay"
						target="_blank"
						rel="noopener noreferrer"
						className="site-footer-link"
					>
						GitHub ↗
					</a>
					<a
						href="https://github.com/sepivip/lobsterpay#readme"
						target="_blank"
						rel="noopener noreferrer"
						className="site-footer-link"
					>
						Docs ↗
					</a>
					<a
						href="https://api.lobsterpay.xyz/health"
						target="_blank"
						rel="noopener noreferrer"
						className="site-footer-link"
					>
						API health ↗
					</a>
				</div>
				<div className="site-footer-col">
					<div className="label-mono site-footer-col-title">PROGRAM</div>
					<a
						href="https://explorer.solana.com/address/A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS?cluster=devnet"
						target="_blank"
						rel="noopener noreferrer"
						className="site-footer-link"
					>
						Program · devnet ↗
					</a>
					<a
						href="https://explorer.solana.com/address/DvcQMhZmhZZQ1CX6FhGkyAiPr3YtNbBuLDP3QpuBRTHp?cluster=devnet"
						target="_blank"
						rel="noopener noreferrer"
						className="site-footer-link"
					>
						Treasury · devnet ↗
					</a>
					<span className="site-footer-muted">
						Solana Colosseum · Anchor 0.31.1 · MIT
					</span>
				</div>
			</div>
			<div className="site-footer-bar">
				<span className="label-mono">
					Built on Solana &middot; Anchor &middot; Open Source
				</span>
				<span className="label-mono">© 2026 LobsterPay</span>
			</div>
		</footer>
	);
}
