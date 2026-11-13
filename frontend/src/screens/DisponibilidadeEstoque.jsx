import React from "react";
import Topbar from "../components/Topbar";
import { formatarQtd, formatarPerc } from "../utils/formatters";

/**
 * Tela Principal de Disponibilidade de Estoque (Líder Design)
 * Exibe Topbar executiva, 5 cards de KPIs, painel de filtros avançados,
 * tabela com scroll infinito e ações rápidas ("Ver Insumos", "Resumo").
 */
export default function DisponibilidadeEstoque({
  metricas = {
    total_itens_finais: 0,
    total_itens_avaliados: 0,
    total_pedidos: 0,
    total_disponiveis: 0,
    total_com_falta: 0,
    total_simulados: 0,
  },
  filtroLocal,
  setFiltroLocal,
  locaisProducao = [],
  filtroPedido,
  setFiltroPedido,
  filtroCodigo,
  setFiltroCodigo,
  filtroTipoData,
  setFiltroTipoData,
  filtroDataInicio,
  setFiltroDataInicio,
  filtroDataFim,
  setFiltroDataFim,
  filtroBaixa,
  setFiltroBaixa,
  filtroTipo,
  setFiltroTipo,
  filtroStatus,
  setFiltroStatus,
  filtroApenasSimulados,
  setFiltroApenasSimulados,
  temFiltrosAtivos,
  limparFiltros,
  pedidosSimuladosAtivos = [],
  handleRemoverPedidoSimulado,
  colFiltros = {},
  limparFiltroColuna,
  aplicarFiltroColuna,
  activeColMenu,
  setActiveColMenu,
  localColInput,
  setLocalColInput,
  scrollContainerRef,
  handleScrollContainer,
  tableId = "tbl-disponibilidade-estoque",
  itens = [],
  loading = false,
  loadingMsg = "Carregando dados...",
  loadingMore = false,
  hasMore = false,
  sentinelRef,
  totalRegistros = 0,
  onAbrirDetalhes,
  onAbrirResumoPedido,
  onAbrirSimulador,
  onAbrirModalFiltroLocal = () => {},
  filtroFamilias = [],
  setFiltroFamilias = () => {},
  familiasDisponiveis = [],
  onAbrirModalFiltroFamilia = () => {},
  onAbrirFaltantes = () => {},
}) {
  const qtdLocaisFiltrados = Array.isArray(filtroLocal)
    ? filtroLocal.length
    : filtroLocal && String(filtroLocal).trim() && String(filtroLocal).toUpperCase() !== "TODOS"
    ? 1
    : 0;
  const qtdFamiliasFiltradas = Array.isArray(filtroFamilias)
    ? filtroFamilias.length
    : filtroFamilias && String(filtroFamilias).trim()
    ? 1
    : 0;
  /**
   * Renderizador de cabeçalho de coluna com popover de filtro e indicação visual
   */
  const renderColumnHeader = (colKey, label, className = "", align = "left") => {
    const isFiltered = Boolean(colFiltros[colKey]);
    const isOpen = activeColMenu === colKey;

    return (
      <th
        scope="col"
        className={`p-2.5 relative select-none font-semibold ${className}`}
      >
        <div
          onClick={() => {
            if (isOpen) {
              setActiveColMenu(null);
            } else {
              setActiveColMenu(colKey);
              setLocalColInput(colFiltros[colKey] || "");
            }
          }}
          className={`flex items-center gap-1.5 cursor-pointer hover:text-[#1A1A1A] transition-colors ${
            align === "center"
              ? "justify-center"
              : align === "right"
              ? "justify-end"
              : "justify-start"
          } ${isFiltered ? "text-[#8B5A2B] font-bold" : "text-[#424242]"}`}
          title="Clique para filtrar esta coluna no servidor"
        >
          <span>{label}</span>
          <span
            className={`material-symbols-outlined text-[14px] transition-colors ${
              isFiltered ? "text-[#8B5A2B]" : "text-[#9E9E9E]"
            }`}
          >
            filter_alt
          </span>
          {isFiltered && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                limparFiltroColuna(colKey);
              }}
              className="text-[#C62828] hover:bg-[#FFEBEE] rounded-full p-0.5 text-xs font-bold leading-none cursor-pointer"
              title="Remover filtro desta coluna"
            >
              ✕
            </span>
          )}
        </div>

        {/* Popover de filtro da coluna */}
        {isOpen && (
          <div
            className="col-filter-popover absolute top-full left-0 mt-1 w-64 bg-white border border-[#D5D5D5] rounded-sm shadow-xl z-50 p-3 text-left font-normal normal-case animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[#EEEEEE]">
              <span className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-wider">
                Filtrar: {label}
              </span>
              <button
                type="button"
                onClick={() => setActiveColMenu(null)}
                className="text-[#9E9E9E] hover:text-[#1A1A1A] cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                aplicarFiltroColuna(colKey);
              }}
              className="space-y-2.5"
            >
              <input
                autoFocus
                type="text"
                value={localColInput}
                onChange={(e) => setLocalColInput(e.target.value)}
                placeholder={`Buscar em ${label}...`}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#222222]"
              />

              <div className="flex items-center justify-between pt-1">
                {isFiltered && (
                  <button
                    type="button"
                    onClick={() => limparFiltroColuna(colKey)}
                    className="text-[11px] text-[#C62828] hover:underline cursor-pointer"
                  >
                    Limpar
                  </button>
                )}
                <div className="flex gap-1.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => setActiveColMenu(null)}
                    className="px-2.5 py-1 text-xs border border-[#D5D5D5] rounded-sm hover:bg-[#F2F2F2] cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 text-xs bg-[#222222] text-white rounded-sm hover:bg-black font-medium cursor-pointer"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </th>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
      {/* Topbar Superior */}
      <Topbar
        titulo="Painel de Disponibilidade de Estoque"
        subtitulo="Visão Geral de Ordens e Disponibilidade de Componentes"
        onAbrirSimulador={onAbrirSimulador}
      />

      {/* Conteúdo Principal */}
      <main className="flex-1 flex flex-col px-8 py-5 min-h-0 overflow-hidden space-y-4">
        {/* 1. METRICS / KPIS (5 Cards em Grid Widescreen) */}
        <section className="shrink-0 grid grid-cols-1 md:grid-cols-5 gap-3.5">
          {/* Card 1 */}
          <div className="bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between transition-all hover:border-[#D5D5D5]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-widest text-[#757575] font-medium">
                Total de Ordens
              </span>
              <span className="material-symbols-outlined text-[18px] text-[#757575]">analytics</span>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-medium text-[#1A1A1A] tracking-tight">
                {metricas.total_itens_finais.toLocaleString("pt-BR")}
              </span>
              <p className="text-[11px] text-[#757575] mt-0.5">
                {metricas.total_simulados > 0
                  ? `${metricas.total_simulados} simulado(s)`
                  : "ordens avaliadas"}
              </p>
            </div>
          </div>

          {/* Card 2 */}
          <div className="bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between transition-all hover:border-[#D5D5D5]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-widest text-[#757575] font-medium">
                Saldo das Ordens
              </span>
              <span className="material-symbols-outlined text-[18px] text-[#A0522D]">
                account_balance_wallet
              </span>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-medium text-[#1A1A1A] tracking-tight">
                {formatarQtd(metricas.total_itens_avaliados ?? 0)}
              </span>
              <p className="text-[11px] text-[#757575] mt-0.5">saldo pedido em carteira</p>
            </div>
          </div>

          {/* Card 3 */}
          <div className="bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between transition-all hover:border-[#D5D5D5]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-widest text-[#3B6E4C] font-medium">
                100% Disponíveis na Fila
              </span>
              <span className="w-2 h-2 rounded-full bg-[#3B6E4C]" />
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-medium text-[#1A1A1A] tracking-tight">
                {metricas.total_disponiveis.toLocaleString("pt-BR")}
              </span>
              <span className="px-2 py-0.5 rounded-xs bg-[#3B6E4C]/10 text-[#3B6E4C] text-[11px] font-semibold">
                {metricas.total_itens_finais > 0
                  ? formatarPerc((metricas.total_disponiveis / metricas.total_itens_finais) * 100)
                  : "0%"}
              </span>
            </div>
            <div className="w-full bg-[#EEEEEE] h-1.5 rounded-full mt-2 overflow-hidden">
              <div
                className="bg-[#3B6E4C] h-full transition-all duration-300"
                style={{
                  width: `${
                    metricas.total_itens_finais > 0
                      ? Math.min(100, (metricas.total_disponiveis / metricas.total_itens_finais) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          {/* Card 4 */}
          <div className="bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between transition-all hover:border-[#D5D5D5]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-widest text-[#B84A39] font-medium">
                Com Componentes Faltando
              </span>
              <span className="w-2 h-2 rounded-full bg-[#B84A39]" />
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-medium text-[#1A1A1A] tracking-tight">
                {metricas.total_com_falta.toLocaleString("pt-BR")}
              </span>
              <span className="px-2 py-0.5 rounded-xs bg-[#B84A39]/10 text-[#B84A39] text-[11px] font-semibold">
                {metricas.total_itens_finais > 0
                  ? formatarPerc((metricas.total_com_falta / metricas.total_itens_finais) * 100)
                  : "0%"}
              </span>
            </div>
            <div className="w-full bg-[#EEEEEE] h-1.5 rounded-full mt-2 overflow-hidden">
              <div
                className="bg-[#B84A39] h-full transition-all duration-300"
                style={{
                  width: `${
                    metricas.total_itens_finais > 0
                      ? Math.min(100, (metricas.total_com_falta / metricas.total_itens_finais) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
            <button
              type="button"
              onClick={onAbrirFaltantes}
              className="mt-2 text-left text-[11px] font-medium text-[#8B5A2B] hover:underline cursor-pointer"
              title="Ver tudo o que falta, por local de produção e tipo, com os filtros atuais"
            >
              Ver resumo de itens faltantes →
            </button>
          </div>

          {/* Card 5 */}
          <div className="bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between transition-all hover:border-[#D5D5D5]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-widest text-[#757575] font-medium">
                Total de Pedidos
              </span>
              <span className="material-symbols-outlined text-[18px] text-[#757575]">inventory</span>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-medium text-[#1A1A1A] tracking-tight">
                {metricas.total_pedidos.toLocaleString("pt-BR")}
              </span>
              <p className="text-[11px] text-[#757575] mt-0.5">pedidos avaliados</p>
            </div>
          </div>
        </section>

        {/* 2. PAINEL DE FILTROS AVANÇADOS */}
        <section className="shrink-0 bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col gap-3">
          {/* Linha 1: Controles de Busca e Período */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end">
            {/* Local de Produção / Centros Fabris */}
            <div className="md:col-span-3 flex flex-col">
              <label className="text-[11px] uppercase tracking-wider text-[#757575] font-medium mb-1">
                Local de Produção
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={onAbrirModalFiltroLocal}
                  className={`w-full h-9 rounded-sm px-3 text-xs flex items-center justify-between transition-all cursor-pointer border ${
                    qtdLocaisFiltrados > 0
                      ? "bg-[#FCFAF7] border-[#8B5A2B] text-[#1A1A1A] font-medium shadow-xs"
                      : "bg-white border-[#E0E0E0] text-[#1A1A1A] hover:border-[#1A1A1A]"
                  }`}
                  title="Clique para filtrar por fábricas e locais de produção"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className={`material-symbols-outlined text-[17px] ${
                        qtdLocaisFiltrados > 0 ? "text-[#8B5A2B]" : "text-[#757575]"
                      }`}
                    >
                      factory
                    </span>
                    {qtdLocaisFiltrados > 0 ? (
                      <span className="truncate">
                        {qtdLocaisFiltrados}{" "}
                        {qtdLocaisFiltrados === 1 ? "local selecionado" : "locais selecionados"}
                      </span>
                    ) : (
                      <span className="text-[#424242]">
                        Todos os Locais{" "}
                        <span className="text-[10px] text-[#9E9E9E] font-normal">(Sem filtro)</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {qtdLocaisFiltrados > 0 && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setFiltroLocal([]);
                        }}
                        className="text-[#B84A39] hover:bg-[#FFEBEE] rounded-full p-0.5 text-xs font-bold leading-none cursor-pointer"
                        title="Limpar filtro de locais"
                      >
                        ✕
                      </span>
                    )}
                    <span className="material-symbols-outlined text-[17px] text-[#757575]">
                      tune
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Número do Pedido */}
            <div className="md:col-span-2 flex flex-col">
              <label className="text-[11px] uppercase tracking-wider text-[#757575] font-medium mb-1">
                Número do Pedido
              </label>
              <input
                type="text"
                placeholder="Ex: 206473"
                value={filtroPedido}
                onChange={(e) => setFiltroPedido(e.target.value)}
                className="w-full h-9 bg-white border border-[#E0E0E0] rounded-sm px-3 text-xs text-[#1A1A1A] placeholder-[#9E9E9E] focus:outline-none focus:border-[#1A1A1A] transition-colors"
              />
            </div>

            {/* Código ou Descrição */}
            <div className="md:col-span-4 flex flex-col">
              <label className="text-[11px] uppercase tracking-wider text-[#757575] font-medium mb-1">
                Código ou Descrição do Produto
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Ex: 1APAE180 ou APARADOR"
                  value={filtroCodigo}
                  onChange={(e) => setFiltroCodigo(e.target.value)}
                  className="w-full h-9 bg-white border border-[#E0E0E0] rounded-sm px-3 pl-8 text-xs text-[#1A1A1A] placeholder-[#9E9E9E] focus:outline-none focus:border-[#1A1A1A] transition-colors"
                />
                <span className="material-symbols-outlined absolute left-2.5 top-2 text-[16px] text-[#757575]">
                  search
                </span>
              </div>
            </div>

            {/* Período De / Até com Chave Seletora */}
            <div className="md:col-span-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] uppercase tracking-wider text-[#757575] font-medium">
                  Período De / Até
                </label>
                <div className="flex items-center gap-1 bg-[#F5F5F5] p-0.5 rounded-sm">
                  <button
                    type="button"
                    onClick={() => setFiltroTipoData("abertura_op")}
                    className={`px-2 py-0.5 rounded-xs text-[10px] font-medium transition-colors cursor-pointer ${
                      filtroTipoData === "abertura_op"
                        ? "bg-white text-[#1A1A1A] shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                    title="Filtrar pela Data de Abertura da OP"
                  >
                    Abertura OP
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroTipoData("entrega_pedido")}
                    className={`px-2 py-0.5 rounded-xs text-[10px] font-medium transition-colors cursor-pointer ${
                      filtroTipoData === "entrega_pedido"
                        ? "bg-white text-[#1A1A1A] shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                    title="Filtrar pela Data de Entrega do Pedido"
                  >
                    Entrega Pedido
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={filtroDataInicio}
                  onChange={(e) => setFiltroDataInicio(e.target.value)}
                  className="w-full h-9 bg-white border border-[#E0E0E0] rounded-sm px-2 text-center text-xs text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] cursor-pointer"
                />
                <span className="text-[#757575] text-[11px]">até</span>
                <input
                  type="date"
                  value={filtroDataFim}
                  onChange={(e) => setFiltroDataFim(e.target.value)}
                  className="w-full h-9 bg-white border border-[#E0E0E0] rounded-sm px-2 text-center text-xs text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-[#EAEAEA] w-full" />

          {/* Linha 2: Segmented Pills & Ações */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-5">
              {/* Baixa Comp. */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-[#757575] font-medium">
                  Baixa Comp.:
                </span>
                <div className="inline-flex p-0.5 rounded-xs border border-[#E0E0E0] bg-[#F8F8F8]">
                  <button
                    type="button"
                    onClick={() => setFiltroBaixa("todos")}
                    className={`px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                      filtroBaixa === "todos"
                        ? "bg-white text-[#1A1A1A] shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                  >
                    Todas
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroBaixa("S")}
                    className={`px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                      filtroBaixa === "S"
                        ? "bg-white text-[#1A1A1A] shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                  >
                    Baixa Sim (S)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroBaixa("N")}
                    className={`px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                      filtroBaixa === "N"
                        ? "bg-white text-[#1A1A1A] shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                  >
                    Baixa Não (N)
                  </button>
                </div>
              </div>

              {/* Origem */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-[#757575] font-medium">
                  Origem:
                </span>
                <div className="inline-flex p-0.5 rounded-xs border border-[#E0E0E0] bg-[#F8F8F8]">
                  <button
                    type="button"
                    onClick={() => setFiltroTipo("todos")}
                    className={`px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                      filtroTipo === "todos"
                        ? "bg-white text-[#1A1A1A] shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                  >
                    Todas
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroTipo("C")}
                    className={`px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                      filtroTipo === "C"
                        ? "bg-white text-[#1A1A1A] shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                  >
                    Comprado (C)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroTipo("P")}
                    className={`px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                      filtroTipo === "P"
                        ? "bg-white text-[#1A1A1A] shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                  >
                    Produzido (P)
                  </button>
                </div>
              </div>

              {/* Família (Itens 3) */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-[#757575] font-medium">
                  Família (Itens 3):
                </span>
                <button
                  type="button"
                  onClick={onAbrirModalFiltroFamilia}
                  className={`h-7 px-2.5 rounded-xs text-xs flex items-center gap-1.5 transition-all cursor-pointer border ${
                    qtdFamiliasFiltradas > 0
                      ? "bg-[#FCFAF7] border-[#8B5A2B] text-[#1A1A1A] font-semibold shadow-xs"
                      : "bg-[#F8F8F8] border-[#E0E0E0] text-[#757575] hover:text-[#1A1A1A] hover:border-[#1A1A1A]"
                  }`}
                  title="Clique para filtrar e recalcular o consumo pelas famílias dos componentes (itens 3)"
                >
                  <span
                    className={`material-symbols-outlined text-[15px] ${
                      qtdFamiliasFiltradas > 0 ? "text-[#8B5A2B]" : "text-[#757575]"
                    }`}
                  >
                    category
                  </span>
                  {qtdFamiliasFiltradas > 0 ? (
                    <span className="truncate font-mono">
                      {qtdFamiliasFiltradas}{" "}
                      {qtdFamiliasFiltradas === 1 ? "família" : "famílias"}
                    </span>
                  ) : (
                    <span>Todas</span>
                  )}
                  {qtdFamiliasFiltradas > 0 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setFiltroFamilias([]);
                      }}
                      className="text-[#B84A39] hover:bg-[#FFEBEE] rounded-full p-0.5 text-[11px] font-bold leading-none cursor-pointer ml-0.5"
                      title="Limpar filtro de famílias"
                    >
                      ✕
                    </span>
                  )}
                  <span className="material-symbols-outlined text-[14px] text-[#9E9E9E]">
                    tune
                  </span>
                </button>
              </div>

              {/* Status */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-[#757575] font-medium">
                  Status:
                </span>
                <div className="inline-flex p-0.5 rounded-xs border border-[#E0E0E0] bg-[#F8F8F8]">
                  <button
                    type="button"
                    onClick={() => setFiltroStatus("todos")}
                    className={`px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                      filtroStatus === "todos"
                        ? "bg-[#1A1A1A] text-white shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroStatus("disponivel")}
                    className={`px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                      filtroStatus === "disponivel"
                        ? "bg-[#3B6E4C] text-white shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                  >
                    Disponíveis
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroStatus("falta")}
                    className={`px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                      filtroStatus === "falta"
                        ? "bg-[#B84A39] text-white shadow-xs font-semibold"
                        : "text-[#757575] hover:text-[#1A1A1A]"
                    }`}
                  >
                    Com Falta
                  </button>
                </div>
              </div>
            </div>

            {/* Botões de Ação na Direita */}
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setFiltroApenasSimulados((prev) => !prev)}
                className={`h-8 px-3 rounded-xs border text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                  filtroApenasSimulados
                    ? "bg-[#8B5A2B] text-white border-[#8B5A2B]"
                    : "bg-white border-[#E0E0E0] text-[#1A1A1A] hover:bg-[#F8F8F8]"
                }`}
                title="Exibir apenas as linhas com pedidos consultados/simulados"
              >
                <span className="material-symbols-outlined text-[16px]">tune</span>
                <span>Apenas Simulados</span>
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-neutral-100 text-neutral-700 text-[10px] font-semibold">
                  {metricas.total_simulados || 0}
                </span>
              </button>

              {temFiltrosAtivos && (
                <button
                  type="button"
                  onClick={limparFiltros}
                  className="h-8 px-3.5 rounded-xs border border-[#E0E0E0] bg-transparent text-[#757575] hover:text-[#1A1A1A] hover:border-[#1A1A1A] text-xs transition-colors cursor-pointer"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>

          {/* FAIXA DE PEDIDOS SIMULADOS ATIVOS + CHIPS DE FILTROS */}
          {(pedidosSimuladosAtivos.length > 0 ||
            Object.keys(colFiltros).length > 0 ||
            filtroDataInicio ||
            filtroDataFim ||
            filtroApenasSimulados) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#EEEEEE]">
              {pedidosSimuladosAtivos.length > 0 && (
                <>
                  <span className="text-[10px] text-[#8B5A2B] font-bold uppercase tracking-wider flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">science</span>
                    Pedidos no Simulador:
                  </span>
                  {pedidosSimuladosAtivos.map((ps) => {
                    const isOrdCriada = ps.origem === "carteira";
                    return (
                      <span
                        key={ps.pedido}
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-xs text-[11px] border ${
                          isOrdCriada
                            ? "bg-[#F8FAFC] text-[#334155] border-[#CBD5E1]"
                            : "bg-[#FBF7F4] text-[#8B5A2B] border-[#8B5A2B]/30"
                        }`}
                        title={
                          isOrdCriada
                            ? `Pedido ${ps.pedido} com ordem criada (números originais mantidos e abertura recalculada)`
                            : `Pedido ${ps.pedido} simulado via Intranet (${ps.qtd_itens_finais} item(ns) final(is))`
                        }
                      >
                        <strong className="font-mono">#{ps.pedido}</strong>
                        <span
                          className={`text-[10px] ${
                            isOrdCriada ? "text-[#64748B]" : "text-[#8B5A2B]"
                          }`}
                        >
                          {isOrdCriada ? "Ordem criada • " : ""}
                          {ps.data_entrega
                            ? `Entrega: ${ps.data_entrega}`
                            : "Sem data (Fim da fila)"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoverPedidoSimulado(ps.pedido)}
                          className="hover:text-[#C62828] font-bold leading-none cursor-pointer"
                          title={`Remover pedido ${ps.pedido} da simulação`}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </>
              )}

              {(Object.keys(colFiltros).length > 0 ||
                filtroDataInicio ||
                filtroDataFim ||
                filtroApenasSimulados) && (
                <>
                  {pedidosSimuladosAtivos.length > 0 && (
                    <span className="h-3.5 w-px bg-[#E0E0E0] mx-1" />
                  )}
                  <span className="text-[10px] text-[#757575] font-semibold uppercase tracking-wider">
                    Filtros Ativos:
                  </span>
                  {filtroApenasSimulados && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] bg-[#FBF7F4] text-[#8B5A2B] border border-[#8B5A2B]/30">
                      <strong>Apenas Simulados</strong>
                      <button
                        type="button"
                        onClick={() => setFiltroApenasSimulados(false)}
                        className="hover:text-[#C62828] ml-0.5 font-bold cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  )}
                  {(filtroDataInicio || filtroDataFim) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] bg-[#F5F5F5] text-[#1A1A1A] border border-[#E0E0E0]">
                      <strong>Abertura OP:</strong> {filtroDataInicio || "Início"} até{" "}
                      {filtroDataFim || "Fim"}
                      <button
                        type="button"
                        onClick={() => {
                          setFiltroDataInicio("");
                          setFiltroDataFim("");
                        }}
                        className="hover:text-[#C62828] ml-0.5 font-bold cursor-pointer"
                        title="Remover filtro de data"
                      >
                        ×
                      </button>
                    </span>
                  )}
                  {Object.entries(colFiltros).map(([k, val]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] bg-[#F5F5F5] text-[#1A1A1A] border border-[#E0E0E0]"
                    >
                      <strong className="capitalize">{k}:</strong> {val}
                      <button
                        type="button"
                        onClick={() => limparFiltroColuna(k)}
                        className="hover:text-[#C62828] ml-0.5 font-bold cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </>
              )}
            </div>
          )}
        </section>

        {/* 3. TABELA COMPLETA DE ITENS (LÍDER DESIGN) */}
        <section className="flex-1 flex flex-col min-h-0 bg-white rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] overflow-hidden">
          <div
            ref={scrollContainerRef}
            onScroll={handleScrollContainer}
            tabIndex={0}
            role="region"
            aria-labelledby={tableId}
            className="flex-1 min-h-0 overflow-auto relative focus:outline-none"
          >
            <table className="w-full text-left text-xs border-collapse">
              <caption id={tableId} className="sr-only">
                Tabela de análise de estoque de itens finais com rolagem infinita
              </caption>
              <thead className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs text-[#757575] border-b border-[#EAEAEA] text-[11px] uppercase tracking-wider">
                <tr>
                  {renderColumnHeader("item_final", "Código (Item Final)", "pl-5 min-w-[170px]")}
                  {renderColumnHeader("descricao", "Descrição do Produto", "min-w-[320px]")}
                  {renderColumnHeader("pedido", "Pedido", "min-w-[95px]", "center")}
                  {renderColumnHeader("fabrica", "Local Produção", "min-w-[130px]")}
                  {renderColumnHeader("data_abertura", "Abertura OP", "min-w-[115px]", "center")}
                  {renderColumnHeader("saldo", "Saldo", "min-w-[90px]", "right")}
                  {renderColumnHeader("entrega", "Entrega", "min-w-[95px]", "center")}
                  <th scope="col" className="py-3 px-4 text-center min-w-[170px] font-medium text-[#757575]">
                    Disponibilidade
                  </th>
                  {renderColumnHeader("status", "Status", "min-w-[120px]", "center")}
                  <th scope="col" className="py-3 pr-5 text-right min-w-[140px] font-medium text-[#757575]">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAEAEA]">
                {loading && itens.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-12 text-center text-[#757575]">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <span className="material-symbols-outlined text-3xl animate-spin text-[#1A1A1A]">
                          progress_activity
                        </span>
                        <span className="text-xs">{loadingMsg}</span>
                      </div>
                    </td>
                  </tr>
                ) : itens.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-12 text-center text-[#757575]">
                      {filtroApenasSimulados
                        ? "Nenhum pedido simulado/destacado ativo no momento. Clique em 'Simulador de Pedidos' na barra lateral para iniciar."
                        : "Nenhum item final encontrado para os filtros selecionados."}
                    </td>
                  </tr>
                ) : (
                  (() => {
                    const sentinelIndex =
                      hasMore && itens.length > 0 ? Math.max(0, itens.length - 30) : -1;
                    return itens.map((it, idx) => {
                      const isDisponivel = it.status === "Disponível";
                      const isSimulado = Boolean(it.simulado);
                      const isSimuladoCarteira = it.origem_simulacao === "carteira";

                      return (
                        <tr
                          key={`${it.item_final}_${it.pedido}_${it.fabrica}_${idx}`}
                          ref={idx === sentinelIndex ? sentinelRef : null}
                          className={`transition-colors ${
                            isSimuladoCarteira
                              ? "bg-[#F8FAFC] hover:bg-[#F1F5F9]"
                              : isSimulado
                              ? "bg-[#FBF7F4] hover:bg-[#F7EFE9]"
                              : isDisponivel
                              ? "hover:bg-[#F9F9F9]"
                              : "bg-[#B84A39]/[0.02] hover:bg-[#B84A39]/[0.06]"
                          }`}
                        >
                          <th
                            scope="row"
                            style={
                              isSimuladoCarteira
                                ? { boxShadow: "inset 3px 0 0 #64748B" }
                                : isSimulado
                                ? { boxShadow: "inset 4px 0 0 #8B5A2B" }
                                : undefined
                            }
                            className="py-3 px-5 font-mono text-xs font-semibold text-[#1A1A1A]"
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{it.item_final}</span>
                              {isSimuladoCarteira ? (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.2 rounded-xs text-[9px] font-sans font-medium border border-[#CBD5E1] bg-white text-[#475569]"
                                  title="Pedido com ordem já criada (números originais mantidos e Data de Abertura atualizada)"
                                >
                                  Ordem criada
                                </span>
                              ) : (
                                isSimulado && (
                                  <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-xs text-[9px] font-sans font-bold uppercase tracking-wider bg-[#8B5A2B] text-white"
                                    title="Pedido simulado consultado na Intranet"
                                  >
                                    <span className="material-symbols-outlined text-[11px]">
                                      science
                                    </span>
                                    <span>Simulado</span>
                                  </span>
                                )
                              )}
                            </div>
                          </th>
                          <td className="py-3 px-4 max-w-[320px] truncate uppercase font-normal text-xs text-[#1A1A1A]" title={it.descricao}>
                            {it.descricao || "-"}
                          </td>
                          <td
                            className={`py-3 px-3 text-center font-mono ${
                              isSimuladoCarteira
                                ? "font-semibold text-[#334155]"
                                : isSimulado
                                ? "font-bold text-[#8B5A2B]"
                                : "font-medium"
                            }`}
                          >
                            {it.pedido ? (
                              <button
                                type="button"
                                onClick={() => onAbrirResumoPedido(it.pedido, "TODOS")}
                                className="px-1.5 py-0.5 rounded-xs hover:bg-[#FAF5EE] hover:text-[#8B5A2B] transition-colors inline-flex items-center gap-0.5 text-xs font-medium text-[#1A1A1A] cursor-pointer"
                                title={`Abrir Resumo Gerencial do Pedido #${it.pedido}`}
                              >
                                <span>{it.pedido}</span>
                                <span className="material-symbols-outlined text-[12px] opacity-65">
                                  open_in_new
                                </span>
                              </button>
                            ) : (
                              <span className="text-[#9E9E9E]">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-[#555] text-xs font-medium">
                            {it.fabrica}
                          </td>
                          <td
                            className={`py-3 px-3 text-center font-mono text-xs text-[#1A1A1A] ${
                              isSimuladoCarteira
                                ? "bg-[#F1F5F9]/60"
                                : isSimulado
                                ? "bg-[#FAF5EE]/40"
                                : ""
                            }`}
                          >
                            {it.data_abertura ? (
                              it.data_abertura
                            ) : isSimulado ? (
                              <span
                                className={`text-[10px] font-sans font-semibold ${
                                  isSimuladoCarteira ? "text-[#475569]" : "text-[#8B5A2B]"
                                }`}
                                title="Sem data de entrega informada — posicionado no final da lista"
                              >
                                Sem data (Fim)
                              </span>
                            ) : (
                              <span className="text-[#9E9E9E]">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-medium text-[#1A1A1A] text-xs">
                            {formatarQtd(it.saldo)}
                          </td>
                          <td className="py-3 px-3 text-center text-[#757575] font-mono text-xs">
                            {it.entrega || "-"}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-[#757575]">
                                  {it.componentes_disponiveis}/{it.total_componentes} disp.
                                </span>
                                <span className={`font-mono font-semibold ${isDisponivel ? "text-[#3B6E4C]" : it.perc_disponivel > 70 ? "text-[#835425]" : "text-[#B84A39]"}`}>
                                  {formatarPerc(it.perc_disponivel)}
                                </span>
                              </div>
                              <div className="w-full bg-[#EEEEEE] h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    isDisponivel
                                      ? "bg-[#3B6E4C]"
                                      : it.perc_disponivel > 70
                                      ? "bg-[#835425]"
                                      : "bg-[#B84A39]"
                                  }`}
                                  style={{ width: `${Math.min(100, it.perc_disponivel)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            {isDisponivel ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#3B6E4C]/10 text-[#3B6E4C] text-[11px] font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#3B6E4C]" />
                                Disponível
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#B84A39]/10 text-[#B84A39] text-[11px] font-semibold">
                                <span className="material-symbols-outlined text-[13px]">warning</span>
                                Faltam {it.componentes_faltando}
                              </span>
                            )}
                          </td>
                          <td className="py-3 pr-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => onAbrirDetalhes(it)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm border border-[#E0E0E0] bg-transparent text-[#1A1A1A] hover:border-[#1A1A1A] text-xs transition-colors cursor-pointer"
                                title="Ver insumos deste item final"
                              >
                                <span className="material-symbols-outlined text-[14px] text-[#757575]">
                                  visibility
                                </span>
                                <span>Ver Insumos</span>
                              </button>
                              {it.pedido && (
                                <button
                                  type="button"
                                  onClick={() => onAbrirResumoPedido(it.pedido, "TODOS")}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-[#E0E0E0] bg-transparent text-[#1A1A1A] hover:border-[#1A1A1A] text-xs transition-colors cursor-pointer"
                                  title={`Resumo Gerencial do Pedido #${it.pedido}`}
                                >
                                  <span className="material-symbols-outlined text-[14px] text-[#757575]">
                                    receipt_long
                                  </span>
                                  <span>Resumo</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()
                )}

                {/* Indicador de status / loading ao final da tabela */}
                {itens.length > 0 && (
                  <tr>
                    <td colSpan={10} className="p-3 text-center text-xs text-[#757575] bg-[#FAFAFA]">
                      {loadingMore ? (
                        <div className="flex items-center justify-center gap-2">
                          <span className="material-symbols-outlined text-[16px] animate-spin text-[#1A1A1A]">
                            progress_activity
                          </span>
                          <span>Carregando mais linhas...</span>
                        </div>
                      ) : hasMore ? (
                        <span className="text-[#9E9E9E] text-[11px]">
                          Role a tabela para carregar mais registros
                        </span>
                      ) : (
                        <span className="text-[#757575] font-medium text-[11px]">
                          ✓ Todos os {totalRegistros.toLocaleString("pt-BR")} itens finais carregados.
                        </span>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Rodapé informativo de rolagem infinita */}
          <div className="shrink-0 px-6 py-3 border-t border-[#EAEAEA] bg-[#FAFAFA] flex flex-wrap items-center justify-between gap-4 text-xs text-[#757575]">
            <div className="flex items-center gap-3">
              <span>
                Exibindo <span className="font-medium text-[#1A1A1A] font-mono">{itens.length}</span> de{" "}
                <span className="font-medium text-[#1A1A1A] font-mono">
                  {totalRegistros.toLocaleString("pt-BR")}
                </span>{" "}
                itens finais
              </span>
            </div>

            <div className="flex items-center gap-6">
              <span className="text-[11px] text-[#757575] italic flex items-center gap-1.5 hidden md:flex">
                <span className="material-symbols-outlined text-[15px]">mouse</span>
                {hasMore ? "Role internamente para carregar mais linhas" : "Fim dos registros"}
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
