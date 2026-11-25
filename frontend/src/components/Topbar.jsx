import React from "react";

/**
 * Topbar executiva padrão Líder Design
 */
export default function Topbar({
  titulo,
  subtitulo,
  badgeStatus,
  acoesDireita,
}) {
  return (
    <header className="min-h-[64px] py-2.5 px-4 lg:px-6 bg-white border-b border-[#EAEAEA] flex flex-wrap items-center justify-between gap-3 shrink-0 sticky top-0 z-10">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[15px] sm:text-[17px] font-semibold text-[#1A1A1A] tracking-tight font-serif">
              {titulo}
            </h1>
            {badgeStatus}
          </div>
          {subtitulo && (
            <p className="text-[11px] text-[#757575] mt-0.5 leading-snug">
              {subtitulo}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs shrink-0">
        {acoesDireita}

        <span className="hidden sm:inline-flex px-2.5 py-1 bg-[#F8F8F8] border border-[#E0E0E0] rounded-xs text-[#1A1A1A] font-medium items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#1A1A1A]"></span>
          Matriz Industrial
        </span>

        <div className="flex items-center gap-2.5 pl-2 border-l border-[#EDEDED]">
          <div className="text-right hidden sm:block">
            <p className="font-medium text-[#1A1A1A] text-[12px] leading-tight">Controladoria Fabril</p>
            <p className="text-[10px] text-[#757575]">PCP &amp; Engenharia</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-[#222222] text-white flex items-center justify-center text-xs font-semibold">
            CF
          </div>
        </div>
      </div>
    </header>
  );
}
