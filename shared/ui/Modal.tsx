"use client";

import { useEffect } from "react";

type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
};

export default function Modal({ title, onClose, children, wide }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[rgba(17,17,19,0.28)] backdrop-blur-md o-fade-in" onClick={onClose} />
      <div className={`relative bg-surface rounded-2xl border border-line o-elev-pop o-modal-in ${wide ? "w-full max-w-2xl" : "w-full max-w-lg"} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose}
            className="w-8 h-8 -mr-1.5 rounded-full flex items-center justify-center text-faint hover:text-ink hover:bg-shade/[0.06] transition-colors text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
