const LOGO = `░█░░░█▀█░█▀▄░█▀▀░▀█▀░█▀▀░█▀▄░█▀█░█▀█░█░█
░█░░░█░█░█▀▄░▀▀█░░█░░█▀▀░█▀▄░█▀█░█▀█░░█░
░▀▀▀░▀▀▀░▀▀░░▀▀▀░░▀░░▀▀▀░▀░▀░▀░░░▀░▀░░▀░`;

export function LogoAscii({ size = "hero" }: { size?: "hero" | "nav" }) {
  return (
    <pre
      aria-label="LobsterPay"
      className={size === "nav" ? "ascii-logo ascii-logo-nav" : "ascii-logo ascii-logo-hero"}
    >
      {LOGO}
    </pre>
  );
}
