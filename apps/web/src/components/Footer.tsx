export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <span className="footer-disclaimer">
          SHARPE is a technology demonstration on Solana devnet using TxLINE data. Nothing here
          is gambling services or financial advice.
        </span>
        <span className="footer-credit">
          data by TxLINE / TxODDS · settlement on Solana ·{" "}
          <a
            href="https://github.com/Ritik200238/sharpe"
            target="_blank"
            rel="noopener noreferrer"
          >
            repo ↗
          </a>
        </span>
      </div>
    </footer>
  );
}
