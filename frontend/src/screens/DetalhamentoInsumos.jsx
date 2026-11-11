import React from "react";
import SecaoGerencialInsumos from "../components/SecaoGerencialInsumos";
import { formatarQtd } from "../utils/formatters";

/**
 * Tela de Detalhamento de Insumos do Item Final (Líder Design)
 * Ocupa a área principal da tela, com navegação integrada à Sidebar.
 * Exibe metadados completos da OP, posição na fila cumulativa e
 * separação entre Matéria-Prima (Tipo C) e Componentes por Fábrica (Tipo P).
 */
export default function DetalhamentoInsumos({
  itemSelecionado,
  detalhesItem,
  carregandoDetalhes = false,
  abaDetalhe = "faltando",
  setAbaDetalhe,
  modalBaixa = "todos",
  setModalBaixa,
  modalTipo = "todos",
  setModalTipo,
  carregarDetalhes,
  onAbrirResumoPedido,
  onVoltar,
}) {
  if (!itemSelecionado) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#F8F8F8]">
        <div className="bg-white border border-[#E0E0E0] p-8 rounded-xs text-center max-w-md shadow-xs">
          <span className="material-symbols-outlined text-4xl text-[#757575] mb-2">
            inventory_2
          </span>
          <h3 className="text-sm font-semibold text-[#1A1A1A] mb-1">
            Nenhum item final selecionado
          </h3>
          <p className="text-xs text-[#757575] mb-4">
            Selecione uma ordem na tela de Disponibilidade de Estoque e clique em "Ver Insumos".
          </p>
          {onVoltar && (
            <button
              type="button"
              onClick={onVoltar}
              className="px-4 py-2 bg-[#1A1A1A] text-white text-xs font-medium rounded-xs hover:bg-black transition-colors cursor-pointer"
            >
              Ir para Disponibilidade de Estoque
            </button>
          )}
        </div>
      </div>
    );
  }

  const isDisponivel = detalhesItem
    ? detalhesItem.total_faltando === 0
    : itemSelecionado.status === "Disponível";

  const totalFaltando = detalhesItem
    ? detalhesItem.total_faltando
    : itemSelecionado.componentes_faltando;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-[#F8F8F8]">
      {/* Header do Detalhamento Líder Design */}
      <header className="h-[68px] px-8 bg-white border-b border-[#EAEAEA] flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          {onVoltar && (
            <button
              type="button"
              onClick={onVoltar}
              className="p-1.5 text-[#666] hover:text-[#1A1A1A] hover:bg-[#F2F2F2] rounded-xs transition-colors cursor-pointer mr-1"
              title="Voltar para Disponibilidade de Estoque"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </button>
          )}

          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[17px] font-semibold text-[#1A1A1A] tracking-tight font-serif">
                Detalhamento de Insumos por Item Final
              </h2>

              {itemSelecionado.simulado && (
                itemSelecionado.origem_simulacao === "carteira" ? (
                  <span className="px-2 py-0.5 rounded-xs text-[10px] font-medium border border-[#CBD5E1] bg-white text-[#475569]">
                    Ordem criada
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-xs text-[10px] font-semibold uppercase tracking-wider bg-[#8B5A2B] text-white flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">science</span>
                    Simulado (Intranet)
                  </span>
                )
              )}

              {isDisponivel ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[11px] font-medium bg-[#EBF4EC] text-[#245D31] border border-[#D5E8D7]">
                  ● 100% Disponível na Fila
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[11px] font-semibold bg-[#FFEBEE] text-[#C62828] border border-[#FFCDD2]">
                  ● {totalFaltando} insumo(s) em falta
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#757575] mt-0.5">
              Abatimento cumulativo na fila por data de abertura da OP • Estoque em Situação L
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-xs bg-[#F5F5F5] border border-[#E0E0E0] text-[11px] text-[#444] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1A1A1A]"></span>
            MATRIZ INDUSTRIAL
          </div>
          <div className="flex items-center gap-2.5 pl-2 border-l border-[#EDEDED]">
            <div className="text-right hidden sm:block">
              <div className="text-[12px] font-semibold text-[#1A1A1A] leading-tight">Controladoria Fabril</div>
              <div className="text-[10px] text-[#888]">PCP &amp; Engenharia</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#222] text-white flex items-center justify-center font-medium text-[11px]">
              CF
            </div>
          </div>
        </div>
      </header>

      {/* Item Card Meta Section */}
      <div className="px-8 pt-6 pb-2 bg-[#F8F8F8] shrink-0">
        <section className="bg-white border border-[#E5E5E5] rounded-xs p-5 shadow-[0_2px_12px_rgba(0,0,0,0.02)]">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-[#F0F0F0] pb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs uppercase tracking-wider text-[#8B5A2B] bg-[#F7F2ED] px-2 py-0.5 rounded-xs font-semibold border border-[#E8DFD5]">
                  Código: {itemSelecionado.item_final}
                </span>
                <span className="text-xs text-[#888]">• Item Final Faturável</span>
              </div>
              <h3 className="text-base font-medium text-[#1A1A1A] tracking-tight font-sans">
                {itemSelecionado.descricao || "Sem descrição comercial"}
              </h3>
            </div>

            {itemSelecionado.pedido && onAbrirResumoPedido && (
              <div className="shrink-0 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onAbrirResumoPedido(itemSelecionado.pedido, "TODOS")}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#8B5A2B] hover:bg-[#784c22] text-white text-xs font-medium rounded-xs shadow-xs transition-all cursor-pointer"
                  title="Abrir tela de resumo gerencial para o pedido completo"
                >
                  <svg className="w-4 h-4 text-white/90" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Resumo do Pedido #{itemSelecionado.pedido}</span>
                </button>
              </div>
            )}
          </div>

          {/* Metadados da Fila em Grid Minimalista */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-3 text-xs">
            <div>
              <span className="text-[10px] text-[#757575] block mb-0.5 uppercase tracking-wide">Posição na Fila</span>
              <span className="font-semibold text-[#1A1A1A] text-sm font-mono">
                {detalhesItem?.posicao_fila ? `#${detalhesItem.posicao_fila}` : "-"}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-[#757575] block mb-0.5 uppercase tracking-wide">Número do Pedido</span>
              <span className="font-semibold text-[#1A1A1A] text-sm font-mono">
                {itemSelecionado.pedido || "-"}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-[#757575] block mb-0.5 uppercase tracking-wide">Fábrica Responsável</span>
              <span className="font-medium text-[#1A1A1A]">{itemSelecionado.fabrica}</span>
            </div>
            <div>
              <span className="text-[10px] text-[#757575] block mb-0.5 uppercase tracking-wide">Abertura da OP</span>
              <span className="font-medium text-[#1A1A1A] font-mono">
                {itemSelecionado.data_abertura || "Sem data"}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-[#757575] block mb-0.5 uppercase tracking-wide">Saldo OP</span>
              <span className="font-semibold text-[#1A1A1A] text-sm font-mono">
                {formatarQtd(itemSelecionado.saldo)} un
              </span>
            </div>
            <div>
              <span className="text-[10px] text-[#757575] block mb-0.5 uppercase tracking-wide">Data de Entrega</span>
              <span className="font-medium text-[#1A1A1A] font-mono">
                {itemSelecionado.entrega || "-"}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* BARRA DE CONTROLES E FILTROS INTERNOS */}
      <div className="px-8 py-3 bg-[#F8F8F8] flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 border-b border-[#E5E5E5] shrink-0">
        {/* Abas: Faltando vs Disponíveis */}
        <div className="flex items-center space-x-2" role="tablist">
          <button
            type="button"
            onClick={() => setAbaDetalhe("faltando")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-xs transition-colors cursor-pointer ${
              abaDetalhe === "faltando"
                ? "font-semibold text-[#1A1A1A] bg-white border border-[#DDD] shadow-xs"
                : "text-[#757575] hover:text-[#1A1A1A]"
            }`}
          >
            <svg className="w-3.5 h-3.5 text-[#B84A39]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>O que falta para o item</span>
            <span className="text-[10px] bg-[#EAEAEA] text-[#666] px-1.5 py-0.2 rounded-full font-mono">
              {detalhesItem?.total_faltando || 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setAbaDetalhe("disponiveis")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-xs transition-colors cursor-pointer ${
              abaDetalhe === "disponiveis"
                ? "font-semibold text-[#1A1A1A] bg-white border border-[#DDD] shadow-xs"
                : "text-[#757575] hover:text-[#1A1A1A]"
            }`}
          >
            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Disponíveis</span>
            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded-full font-mono font-bold">
              {detalhesItem?.total_disponiveis || 0}
            </span>
          </button>
        </div>

        {/* FILTROS INTERNOS (BAIXA E TIPO) */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-[#666]">
          {/* Filtro Baixa */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-[#888]">Baixa:</span>
            <div className="inline-flex border border-[#E0E0E0] rounded-xs bg-white p-0.5">
              <button
                type="button"
                onClick={() => {
                  setModalBaixa("todos");
                  carregarDetalhes(itemSelecionado, "todos", modalTipo);
                }}
                className={`px-2 py-0.5 text-[11px] rounded-xs cursor-pointer ${
                  modalBaixa === "todos"
                    ? "bg-[#1A1A1A] text-white font-medium"
                    : "text-[#555] hover:text-black"
                }`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalBaixa("S");
                  carregarDetalhes(itemSelecionado, "S", modalTipo);
                }}
                className={`px-2 py-0.5 text-[11px] rounded-xs cursor-pointer ${
                  modalBaixa === "S"
                    ? "bg-[#1A1A1A] text-white font-medium"
                    : "text-[#555] hover:text-black"
                }`}
              >
                S
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalBaixa("N");
                  carregarDetalhes(itemSelecionado, "N", modalTipo);
                }}
                className={`px-2 py-0.5 text-[11px] rounded-xs cursor-pointer ${
                  modalBaixa === "N"
                    ? "bg-[#1A1A1A] text-white font-medium"
                    : "text-[#555] hover:text-black"
                }`}
              >
                N
              </button>
            </div>
          </div>

          {/* Filtro Tipo */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-[#888]">Origem:</span>
            <div className="inline-flex border border-[#E0E0E0] rounded-xs bg-white p-0.5">
              <button
                type="button"
                onClick={() => {
                  setModalTipo("todos");
                  carregarDetalhes(itemSelecionado, modalBaixa, "todos");
                }}
                className={`px-2 py-0.5 text-[11px] rounded-xs cursor-pointer ${
                  modalTipo === "todos"
                    ? "bg-[#1A1A1A] text-white font-medium"
                    : "text-[#555] hover:text-black"
                }`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalTipo("C");
                  carregarDetalhes(itemSelecionado, modalBaixa, "C");
                }}
                className={`px-2 py-0.5 text-[11px] rounded-xs cursor-pointer ${
                  modalTipo === "C"
                    ? "bg-[#1A1A1A] text-white font-medium"
                    : "text-[#555] hover:text-black"
                }`}
              >
                Matéria-Prima (C)
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalTipo("P");
                  carregarDetalhes(itemSelecionado, modalBaixa, "P");
                }}
                className={`px-2 py-0.5 text-[11px] rounded-xs cursor-pointer ${
                  modalTipo === "P"
                    ? "bg-[#1A1A1A] text-white font-medium"
                    : "text-[#555] hover:text-black"
                }`}
              >
                Componente (P)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Conteúdo Gerencial (Separado em Matéria-Prima e Componentes por Fábrica) */}
      <div className="p-8 overflow-y-auto flex-1 bg-[#F8F8F8]">
        {carregandoDetalhes ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2 text-[#757575] bg-white border border-[#E8E8E8] rounded-xs">
            <span className="material-symbols-outlined text-3xl animate-spin text-[#1A1A1A]">
              progress_activity
            </span>
            <span className="text-xs">
              Carregando insumos, saldos de estoque, OPs de componentes e OCs...
            </span>
          </div>
        ) : !detalhesItem ? (
          <div className="py-12 text-center text-xs text-[#757575] bg-white border border-[#E8E8E8] rounded-xs">
            Dados não disponíveis.
          </div>
        ) : (
          <SecaoGerencialInsumos
            blocoGerencial={
              abaDetalhe === "faltando"
                ? detalhesItem.gerencial_faltando
                : detalhesItem.gerencial_disponiveis
            }
            isAbaFaltando={abaDetalhe === "faltando"}
            exibirItensAfetados={false}
          />
        )}
      </div>

      {/* Rodapé da Tela de Detalhes */}
      <footer className="px-8 py-4 border-t border-[#EAEAEA] flex justify-between items-center bg-white shrink-0">
        <span className="text-[11px] text-[#757575]">
          {detalhesItem
            ? `Total de ${detalhesItem.total_componentes} insumos cadastrados na estrutura`
            : ""}
        </span>
        {onVoltar && (
          <button
            type="button"
            onClick={onVoltar}
            className="px-5 py-2 rounded-xs bg-[#1A1A1A] text-white text-xs font-medium hover:bg-black transition-colors cursor-pointer"
          >
            Voltar para Disponibilidade
          </button>
        )}
      </footer>
    </div>
  );
}
