"use client";

import { QRCodeSVG } from "qrcode.react";

export function BalanceLinkQr({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <section id="friend-share-qr" className="friend-share__qr" aria-label="QR code for balance link" aria-describedby="friend-share-qr-description">
      <div className="friend-share__qr-heading">
        <div><p className="technical-label">BALANCE LINK QR</p><h3>Scan to open the balance</h3></div>
        <button className="action-link action-link--quiet" type="button" onClick={onClose}>Close QR</button>
      </div>
      <p id="friend-share-qr-description">This QR grants access to the same temporary private balance statement as the copied link.</p>
      <QRCodeSVG value={url} size={256} level="M" marginSize={4} bgColor="#FFFEFA" fgColor="#111315" title="QR code for the temporary private balance link" />
    </section>
  );
}
