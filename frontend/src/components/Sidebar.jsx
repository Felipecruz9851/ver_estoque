import React, { useEffect, useRef } from "react";
import Icon from "./Icon";
import logoLider from "./logo_lider.png";

/**
 * Conteúdo interno reutilizado entre a Sidebar desktop (expandida/colapsada) e o Drawer mobile.
 */
function SidebarConteudo({
  compact = false,
  isMobile = false,
  telaAtiva,
  onNavegar,
  onFecharMobile,
  onToggleColapso,
  pedidosSimuladosAtivos,
  onAbrirSimulador,
  onLimparSimulacao,
  handleRecarregar,
  handleExportar,
  isLoading,
  loading,
  exportando,
  sid,
  dtSnapshot,
  snapshotNome,
  dataOc,
}) {
  const navegar = (tela) => {
    onNavegar?.(tela);
    if (isMobile) onFecharMobile?.();
  };

  const abrirSimulador = () => {
    onAbrirSimulador?.();
    if (isMobile) onFecharMobile?.();
  };

  const limparSimulacao = () => {
    onLimparSimulacao?.();
    if (isMobile) onFecharMobile?.();
  };

  const itensNavegacao = [
    {
      id: "disponibilidade",
      label: "Disponibilidade de Estoque",
      icon: "inventory_2",
      ativo: telaAtiva === "disponibilidade" || telaAtiva === "detalhes",
    },
    {
      id: "matriz",
      label: "Faltas Produzidos (Matriz)",
      icon: "precision_manufacturing",
      ativo: telaAtiva === "matriz",
    },
    {
      id: "faltantes",
      label: "Itens Faltantes",
      icon: "playlist_remove",
      ativo: telaAtiva === "faltantes",
    },
    {
      id: "resumo",
      label: "Resumo do Pedido",
      icon: "receipt_long",
      ativo: telaAtiva === "resumo",
    },
  ];

  return (
    <div className="h-full flex flex-col justify-between bg-[#FAFAFA]">
      <div className="flex flex-col min-h-0 overflow-y-auto">
        {/* Topo Brand Líder + Botão Recolher/Fechar */}
        <div
          className={`h-[68px] border-b border-[#EAEAEA] flex items-center shrink-0 ${
            compact ? "justify-center px-2" : "justify-between px-5"
          }`}
        >
          {!compact && (
            <img
              src={logoLider}
              alt="Líder Design"
              width={104}
              height={28}
              className="h-7 w-auto brightness-50 contrast-125"
            />
          )}

          {isMobile ? (
            <button
              type="button"
              onClick={onFecharMobile}
              aria-label="Fechar menu"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xs text-[#555] hover:text-[#1A1A1A] hover:bg-[#EAEAEA]/70 transition-colors cursor-pointer"
            >
              <Icon name="close" className="w-5 h-5" />
            </button>
          ) : (
            onToggleColapso && (
              <button
                type="button"
                onClick={onToggleColapso}
                aria-label={compact ? "Expandir menu lateral" : "Recolher menu lateral"}
                title={compact ? "Expandir menu" : "Recolher menu"}
                className="p-1.5 rounded-xs text-[#666] hover:text-[#1A1A1A] hover:bg-[#EAEAEA]/70 transition-colors cursor-pointer"
              >
                <Icon name={compact ? "menu" : "menu_open"} className="w-[18px] h-[18px]" />
              </button>
            )
          )}
        </div>

        {/* Seção Navegação do Sistema */}
        {!compact && (
          <div className="px-5 py-3">
            <span className="text-[10px] uppercase tracking-wider text-[#8C8C8C] font-semibold">
              Navegação do Sistema
            </span>
          </div>
        )}

        <nav
          aria-label="Navegação principal"
          className={`flex flex-col gap-1 text-xs ${compact ? "px-2 pt-3" : "px-3"}`}
        >
          {itensNavegacao.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navegar(item.id)}
              title={compact ? item.label : undefined}
              aria-label={compact ? item.label : undefined}
              aria-current={item.ativo ? "page" : undefined}
              className={`w-full flex items-center rounded-xs transition-all cursor-pointer touch-target ${
                compact ? "justify-center px-2 py-2.5" : "px-3 py-2.5 text-left"
              } ${
                item.ativo
                  ? "bg-[#1A1A1A] text-white font-medium shadow-[0_1px_8px_rgba(0,0,0,0.06)]"
                  : "text-[#555] hover:bg-[#EAEAEA]/70 hover:text-[#1A1A1A]"
              }`}
            >
              <Icon
                name={item.icon}
                className={`w-[18px] h-[18px] shrink-0 ${compact ? "" : "mr-3"} ${
                  item.ativo ? "text-neutral-300" : "text-[#757575]"
                }`}
              />
              {!compact && <span className="tracking-tight text-xs">{item.label}</span>}
            </button>
          ))}

          {/* 4. Simulador de Pedidos (Abre em Modal) */}
          <button
            type="button"
            onClick={abrirSimulador}
            disabled={loading}
            title={compact ? "Simulador de Pedidos" : undefined}
            aria-label={compact ? "Simulador de Pedidos" : undefined}
            className={`relative w-full flex items-center rounded-xs text-[#555] hover:bg-[#EAEAEA]/70 hover:text-[#1A1A1A] transition-all cursor-pointer touch-target disabled:opacity-50 ${
              compact ? "justify-center px-2 py-2.5" : "px-3 py-2.5 text-left"
            }`}
          >
            <Icon
              name="tune"
              className={`w-[18px] h-[18px] shrink-0 text-[#757575] ${compact ? "" : "mr-3"}`}
            />
            {!compact && <span className="tracking-tight text-xs flex-1">Simulador de Pedidos</span>}
            {pedidosSimuladosAtivos.length > 0 && (
              <span
                className={`rounded-full bg-[#8B5A2B] text-white font-bold font-mono ${
                  compact
                    ? "absolute top-1 right-1 px-1 text-[9px] leading-tight"
                    : "px-1.5 py-0.2 text-[10px]"
                }`}
              >
                {pedidosSimuladosAtivos.length}
              </span>
            )}
          </button>

          {/* Ação rápida para limpar simulação se ativa */}
          {pedidosSimuladosAtivos.length > 0 && (
            <button
              type="button"
              onClick={limparSimulacao}
              disabled={loading}
              className={`w-full flex items-center rounded-xs text-[#C62828] hover:bg-[#FFEBEE] transition-all text-xs cursor-pointer mt-1 touch-target disabled:opacity-50 ${
                compact ? "justify-center px-2 py-2" : "px-3 py-2 text-left"
              }`}
              title="Limpar todos os pedidos simulados"
              aria-label={compact ? "Limpar Simulação" : undefined}
            >
              <Icon
                name="restart_alt"
                className={`w-4 h-4 shrink-0 text-[#C62828] ${compact ? "" : "mr-3"}`}
              />
              {!compact && <span className="tracking-tight text-xs">Limpar Simulação</span>}
            </button>
          )}
        </nav>
      </div>

      {/* Bloco Inferior: Metadados da Sessão e Ações de Sistema */}
      <div className={`border-t border-[#EAEAEA] bg-[#FAFAFA] ${compact ? "p-2 space-y-2" : "p-4 space-y-3"}`}>
        {!compact && (
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
            {(dtSnapshot || snapshotNome || dataOc) && (
              <div className="text-[10px] text-[#888] pt-1 leading-snug">
                {(dtSnapshot || snapshotNome) && (
                  <div>
                    Snapshot:{" "}
                    <span className="font-mono text-[#555]" title={snapshotNome}>
                      {snapshotNome ? snapshotNome.replace(/^snapshot_/, "") : "Padrão"}
                    </span>
                  </div>
                )}
                {dtSnapshot && (
                  <div
                    className="font-mono text-[9px] text-[#777]"
                    title="Data e hora dos metadados do snapshot coletado"
                  >
                    {dtSnapshot.startsWith("Atualiz") ? dtSnapshot : `Atualização: ${dtSnapshot}`}
                  </div>
                )}
                <div
                  className="font-mono text-[9px] text-[#777]"
                  title="Data e hora da última sincronização das Ordens de Compra na Intranet"
                >
                  OCs Intranet: {dataOc || "—"}
                </div>
              </div>
            )}
          </div>
        )}

        <div className={`${compact ? "space-y-1.5" : "pt-2 space-y-1.5"}`}>
          <button
            type="button"
            onClick={handleRecarregar}
            disabled={isLoading}
            title={compact ? (isLoading ? "Recarregando..." : "Recarregar Dados") : undefined}
            aria-label={compact ? "Recarregar Dados" : undefined}
            className={`w-full flex items-center justify-center gap-2 py-1.5 text-[11px] font-medium text-[#333] bg-white border border-[#E0E0E0] rounded-xs hover:border-[#999] transition-colors cursor-pointer disabled:opacity-50 touch-target ${
              compact ? "px-2" : "px-3"
            }`}
          >
            <Icon
              name="sync"
              className={`w-3.5 h-3.5 text-[#666] -scale-x-100 ${isLoading ? "animate-spin" : ""}`}
            />
            {!compact && <span>{isLoading ? "Recarregando..." : "Recarregar Dados"}</span>}
          </button>

          <button
            type="button"
            onClick={handleExportar}
            disabled={exportando || isLoading}
            title={compact ? (exportando ? "Exportando..." : "Exportar Excel") : undefined}
            aria-label={compact ? "Exportar Excel" : undefined}
            className={`w-full flex items-center justify-center gap-2 py-1.5 text-[11px] font-medium text-[#333] bg-white border border-[#E0E0E0] rounded-xs hover:border-[#999] transition-colors cursor-pointer disabled:opacity-50 touch-target ${
              compact ? "px-2" : "px-3"
            }`}
          >
            <Icon
              name={exportando ? "hourglass_top" : "download"}
              className="w-3.5 h-3.5 text-[#666]"
            />
            {!compact && <span>{exportando ? "Exportando..." : "Exportar Excel"}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Barra lateral persistente comum a todas as telas do sistema (Desktop colapsável + Drawer mobile <dialog>)
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
  dataOc = "",
  snapshotNome = "",
  colapsada = false,
  onToggleColapso,
  menuMobileAberto = false,
  onFecharMobile,
}) {
  const mobileDialogRef = useRef(null);
  const closingProgrammaticallyRef = useRef(false);
  const pointerDownOutsideRef = useRef(false);

  const handleRecarregar = onRecarregar || carregarDados;
  const handleExportar = onExportarExcel || exportarParaExcel;
  const isLoading = loading || carregando;
  const dtSnapshot = dataCarregamento || dataCarga;
  const sid = sessionId || hashSessao;

  useEffect(() => {
    const dialog = mobileDialogRef.current;
    if (!dialog) return;
    if (menuMobileAberto && !dialog.open) {
      closingProgrammaticallyRef.current = false;
      dialog.showModal();
    } else if (!menuMobileAberto && dialog.open) {
      closingProgrammaticallyRef.current = true;
      dialog.close();
    }
  }, [menuMobileAberto]);

  const isClickOutsideDialog = (e, dialog) => {
    const rect = dialog.getBoundingClientRect();
    return (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
  };

  const handlePointerDown = (e) => {
    const dialog = mobileDialogRef.current;
    if (!dialog || e.target !== dialog) {
      pointerDownOutsideRef.current = false;
      return;
    }
    pointerDownOutsideRef.current = isClickOutsideDialog(e, dialog);
  };

  const handlePointerUp = (e) => {
    const dialog = mobileDialogRef.current;
    if (
      pointerDownOutsideRef.current &&
      dialog &&
      e.target === dialog &&
      isClickOutsideDialog(e, dialog)
    ) {
      onFecharMobile?.();
    }
    pointerDownOutsideRef.current = false;
  };

  const handleMobileClose = () => {
    if (closingProgrammaticallyRef.current) {
      closingProgrammaticallyRef.current = false;
      return;
    }
    onFecharMobile?.();
  };

  const sharedProps = {
    telaAtiva,
    onNavegar,
    onFecharMobile,
    onToggleColapso,
    pedidosSimuladosAtivos,
    onAbrirSimulador,
    onLimparSimulacao,
    handleRecarregar,
    handleExportar,
    isLoading,
    loading,
    exportando,
    sid,
    dtSnapshot,
    snapshotNome,
    dataOc,
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex h-screen bg-[#FAFAFA] border-r border-[#EAEAEA] flex-col justify-between shrink-0 select-none z-30 transition-[width] duration-200 ${
          colapsada
            ? "w-[68px] min-w-[68px] max-w-[68px]"
            : "w-64 min-w-[256px] max-w-[256px]"
        }`}
      >
        <SidebarConteudo {...sharedProps} compact={colapsada} isMobile={false} />
      </aside>

      {/* Mobile Drawer nativo (< 1024px) */}
      <dialog
        ref={mobileDialogRef}
        closedby="any"
        aria-label="Menu de navegação"
        onClose={handleMobileClose}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className="mobile-drawer lg:hidden w-72 max-w-[85vw] bg-[#FAFAFA] border-r border-[#EAEAEA] shadow-2xl"
      >
        <SidebarConteudo {...sharedProps} compact={false} isMobile={true} />
      </dialog>
    </>
  );
}
