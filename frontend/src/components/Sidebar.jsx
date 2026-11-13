
import React from "react";
import logoLider from "./logo_lider.png";
/**
 * Barra lateral persistente comum a todas as telas do sistema
 */
export default function Sidebar({
  telaAtiva,
  onNavegar,
  pedidosSimuladosAtivos = [],
  onAbrirSimulador,
  onLimparSimulacao,
  onRecarregar,
  carregarDados,
  onExportarExcel,
  exportarParaExcel,
  loading = false,
  carregando = false,
  exportando = false,
  sessionId = "",
  hashSessao = "",
  dataCarregamento = "",
  dataCarga = "",
  snapshotNome = "",
}) {
  const handleRecarregar = onRecarregar || carregarDados;
  const handleExportar = onExportarExcel || exportarParaExcel;
  const isLoading = loading || carregando;
  const dtSnapshot = dataCarregamento || dataCarga;
  const sid = sessionId || hashSessao;
  return (
    <aside className="w-64 min-w-[256px] max-w-[256px] h-screen bg-[#FAFAFA] border-r border-[#EAEAEA] flex flex-col justify-between shrink-0 select-none z-30">
      <div className="flex flex-col">
        {/* Topo Brand Líder */}
        <div className="h-[68px] p-6 border-b border-[#EAEAEA]">
          <img src={logoLider} alt="Líder Design" className="h-7 w-auto" />
        </div>

        {/* Seção Navegação do Sistema */}
        <div className="px-5 py-3">
          <span className="text-[10px] uppercase tracking-wider text-[#8C8C8C] font-semibold">
            Navegação do Sistema
          </span>
        </div>

        <nav className="px-3 flex flex-col gap-1 text-xs">
          {/* 1. Disponibilidade de Estoque */}
          <button
            type="button"
            onClick={() => onNavegar("disponibilidade")}
            className={`w-full flex items-center px-3 py-2.5 rounded-xs transition-all text-left cursor-pointer ${
              telaAtiva === "disponibilidade" || telaAtiva === "detalhes"
                ? "bg-[#1A1A1A] text-white font-medium shadow-[0_1px_8px_rgba(0,0,0,0.06)]"
                : "text-[#555] hover:bg-[#EAEAEA]/70 hover:text-[#1A1A1A]"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[18px] mr-3 ${
                telaAtiva === "disponibilidade" || telaAtiva === "detalhes"
                  ? "text-neutral-300"
                  : "text-[#757575]"
              }`}
            >
              inventory_2
            </span>
            <span className="tracking-tight text-xs">Disponibilidade de Estoque</span>
          </button>

          {/* 2. Faltas Produzidos (Matriz) */}
          <button
            type="button"
            onClick={() => onNavegar("matriz")}
            className={`w-full flex items-center px-3 py-2.5 rounded-xs transition-all text-left cursor-pointer ${
              telaAtiva === "matriz"
                ? "bg-[#1A1A1A] text-white font-medium shadow-[0_1px_8px_rgba(0,0,0,0.06)]"
                : "text-[#555] hover:bg-[#EAEAEA]/70 hover:text-[#1A1A1A]"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[18px] mr-3 ${
                telaAtiva === "matriz" ? "text-neutral-300" : "text-[#757575]"
              }`}
            >
              precision_manufacturing
            </span>
            <span className="tracking-tight text-xs">Faltas Produzidos (Matriz)</span>
          </button>

          {/* 2b. Itens Faltantes (resumo por local de produção e tipo) */}
          <button
            type="button"
            onClick={() => onNavegar("faltantes")}
            className={`w-full flex items-center px-3 py-2.5 rounded-xs transition-all text-left cursor-pointer ${
              telaAtiva === "faltantes"
                ? "bg-[#1A1A1A] text-white font-medium shadow-[0_1px_8px_rgba(0,0,0,0.06)]"
                : "text-[#555] hover:bg-[#EAEAEA]/70 hover:text-[#1A1A1A]"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[18px] mr-3 ${
                telaAtiva === "faltantes" ? "text-neutral-300" : "text-[#757575]"
              }`}
            >
              playlist_remove
            </span>
            <span className="tracking-tight text-xs">Itens Faltantes</span>
          </button>

          {/* 3. Resumo do Pedido */}
          <button
            type="button"
            onClick={() => onNavegar("resumo")}
            className={`w-full flex items-center px-3 py-2.5 rounded-xs transition-all text-left cursor-pointer ${
              telaAtiva === "resumo"
                ? "bg-[#1A1A1A] text-white font-medium shadow-[0_1px_8px_rgba(0,0,0,0.06)]"
                : "text-[#555] hover:bg-[#EAEAEA]/70 hover:text-[#1A1A1A]"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[18px] mr-3 ${
                telaAtiva === "resumo" ? "text-neutral-300" : "text-[#757575]"
              }`}
            >
              receipt_long
            </span>
            <span className="tracking-tight text-xs">Resumo do Pedido</span>
          </button>

          {/* 4. Simulador de Pedidos (Abre em Modal) */}
          <button
            type="button"
            onClick={onAbrirSimulador}
            disabled={loading}
            className="w-full flex items-center px-3 py-2.5 rounded-xs text-[#555] hover:bg-[#EAEAEA]/70 hover:text-[#1A1A1A] transition-all text-left cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px] mr-3 text-[#757575]">
              tune
            </span>
            <span className="tracking-tight text-xs flex-1">Simulador de Pedidos</span>
            {pedidosSimuladosAtivos.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-[#8B5A2B] text-white text-[10px] font-bold font-mono">
                {pedidosSimuladosAtivos.length}
              </span>
            )}
          </button>

          {/* Ação rápida para limpar simulação se ativa */}
          {pedidosSimuladosAtivos.length > 0 && (
            <button
              type="button"
              onClick={onLimparSimulacao}
              disabled={loading}
              className="w-full flex items-center px-3 py-2 rounded-xs text-[#C62828] hover:bg-[#FFEBEE] transition-all text-left text-xs cursor-pointer mt-1"
              title="Limpar todos os pedidos simulados"
            >
              <span className="material-symbols-outlined text-[16px] mr-3 text-[#C62828]">
                restart_alt
              </span>
              <span className="tracking-tight text-xs">Limpar Simulação</span>
            </button>
          )}
        </nav>
      </div>

      {/* Bloco Inferior: Metadados da Sessão e Ações de Sistema */}
      <div className="p-4 border-t border-[#EAEAEA] space-y-3 bg-[#FAFAFA]">
        <div className="text-[11px] space-y-1">
          <div className="flex items-center gap-1.5 text-[#555]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
            <span className="font-medium tracking-wide uppercase text-[10px] text-[#777]">
              Sessão Isolada
            </span>
          </div>
          <div className="font-mono text-[11px] text-[#333] pl-3.5">
            {sid ? sid.slice(0, 8) : "ativa"}
          </div>
          {(dtSnapshot || snapshotNome) && (
            <div className="text-[10px] text-[#888] pt-1 leading-snug">
              <div>
                Snapshot:{" "}
                <span className="font-mono text-[#555]" title={snapshotNome}>
                  {snapshotNome ? snapshotNome.replace(/^snapshot_/, "") : "Padrão"}
                </span>
              </div>
              {dtSnapshot && (
                <div className="font-mono text-[9px] text-[#777]">
                  {dtSnapshot}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="pt-2 space-y-1.5">
          <button
            type="button"
            onClick={handleRecarregar}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-medium text-[#333] bg-white border border-[#E0E0E0] rounded-xs hover:border-[#999] transition-colors cursor-pointer disabled:opacity-50"
          >
            <span
              className={`inline-block ${
                isLoading ? "animate-spin" : ""
              }`}
            >
              <span className="material-symbols-outlined text-[14px] text-[#666] -scale-x-100 block">
                sync
              </span>
            </span>
            <span>{isLoading ? "Recarregando..." : "Recarregar Dados"}</span>
          </button>

          <button
            type="button"
            onClick={handleExportar}
            disabled={exportando || isLoading}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-medium text-[#333] bg-white border border-[#E0E0E0] rounded-xs hover:border-[#999] transition-colors cursor-pointer disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[14px] text-[#666]">
              {exportando ? "hourglass_top" : "download"}
            </span>
            <span>{exportando ? "Exportando..." : "Exportar Excel"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
