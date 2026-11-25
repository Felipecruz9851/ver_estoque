import React, { useId } from "react";
import Topbar from "../components/Topbar";
import Icon from "../components/Icon";
import { formatarQtd, formatarPerc } from "../utils/formatters";

/**
 * Select compacto reutilizável da barra condensada de filtros.
 */
function FiltroSelect({
  id,
  label,
  value,
  onChange,
  options,
  active = false,
  toneClass = "",
  title = "",
  minWidthClass = "",
}) {
  return (
    <div className="flex flex-col min-w-0">
      <label
        htmlFor={id}
        className="text-[10px] uppercase tracking-wider text-[#757575] font-medium mb-0.5 leading-none"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        <select
          id={id}
          value={value}
          onChange={onChange}
          title={title}
          className={`select-custom touch-target h-8 appearance-none rounded-sm border pl-1.5 pr-6 text-[11px] leading-none transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[#8B5A2B] ${minWidthClass} ${
            toneClass ||
            (active
              ? "bg-[#FCFAF7] border-[#8B5A2B] text-[#1A1A1A] font-semibold"
              : "bg-white border-[#E0E0E0] text-[#1A1A1A] hover:border-[#1A1A1A]")
          }`}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <Icon
          name="expand_more"
          aria-hidden="true"
          className="pointer-events-none absolute right-1 w-4 h-4 shrink-0 text-[#757575]"
        />
      </div>
    </div>
  );
}

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
  locaisProducao: _locaisProducao = [],
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
  filtroTodasOps = false,
  setFiltroTodasOps = () => {},
  filtroEscopoAbatimento = "global",
  setFiltroEscopoAbatimento = () => {},
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
  familiasDisponiveis: _familiasDisponiveis = [],
  onAbrirModalFiltroFamilia = () => {},
  onAbrirFaltantes = () => {},
}) {
  const baseId = useId();
  const localLabelId = `${baseId}-local-lbl`;
  const familiaLabelId = `${baseId}-familia-lbl`;
  const periodoLabelId = `${baseId}-periodo-lbl`;
  const tipoDataId = `${baseId}-tipo-data`;
  const dataInicioId = `${baseId}-dt-ini`;
  const dataFimId = `${baseId}-dt-fim`;
  const baixaId = `${baseId}-baixa`;
  const origemId = `${baseId}-origem`;
  const statusId = `${baseId}-status`;
  const escopoId = `${baseId}-escopo`;
  const abatimentoId = `${baseId}-abatimento`;
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
  const isInitialLoading = loading && itens.length === 0;

  /**
   * Renderizador de cabeçalho de coluna com popover de filtro e indicação visual
   */
  const renderColumnHeader = (colKey, label, className = "", align = "left") => {
    const isFiltered = Boolean(colFiltros[colKey]);
    const isOpen = activeColMenu === colKey;

    return (
      <th
        scope="col"
        className={`p-2 relative select-none font-semibold ${className}`}
      >
        <div
          className={`flex items-center gap-1 ${
            align === "center"
              ? "justify-center"
              : align === "right"
              ? "justify-end"
              : "justify-start"
          }`}
        >
          <button
            type="button"
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            onClick={() => {
              if (isOpen) {
                setActiveColMenu(null);
              } else {
                setActiveColMenu(colKey);
                setLocalColInput(colFiltros[colKey] || "");
              }
            }}
            className={`touch-target inline-flex items-center gap-1 cursor-pointer hover:text-[#1A1A1A] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B5A2B] rounded-xs ${
              isFiltered ? "text-[#8B5A2B] font-bold" : "text-[#424242]"
            }`}
            title={`Filtrar coluna ${label}`}
          >
            <span>{label}</span>
            <Icon
              name="filter_alt"
              aria-hidden="true"
              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                isFiltered ? "text-[#8B5A2B]" : "text-[#9E9E9E]"
              }`}
            />
          </button>
          {isFiltered && (
            <button
              type="button"
              onClick={() => limparFiltroColuna(colKey)}
              aria-label={`Remover filtro da coluna ${label}`}
              className="touch-target text-[#C62828] hover:bg-[#FFEBEE] rounded-full p-0.5 text-xs font-bold leading-none cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B5A2B]"
              title={`Remover filtro da coluna ${label}`}
            >
              ✕
            </button>
          )}
        </div>

        {/* Popover de filtro da coluna */}
        {isOpen && (
          <div
            role="dialog"
            aria-label={`Filtrar: ${label}`}
            className="col-filter-popover absolute top-full left-0 mt-1 w-64 bg-white border border-[#D5D5D5] rounded-sm shadow-xl z-50 p-3 text-left font-normal normal-case animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[#EEEEEE]">
              <span className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-wider">
                Filtrar: {label}
              </span>
              <button
                type="button"
                aria-label={`Fechar filtro de ${label}`}
                onClick={() => setActiveColMenu(null)}
                className="touch-target text-[#9E9E9E] hover:text-[#1A1A1A] cursor-pointer"
              >
                <Icon name="close" className="w-4 h-4 shrink-0" aria-hidden="true" />
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
                aria-label={`Valor do filtro para ${label}`}
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
                    className="touch-target text-[11px] text-[#C62828] hover:underline cursor-pointer"
                  >
                    Limpar
                  </button>
                )}
                <div className="flex gap-1.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => setActiveColMenu(null)}
                    className="touch-target px-2.5 py-1 text-xs border border-[#D5D5D5] rounded-sm hover:bg-[#F2F2F2] cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="touch-target px-3 py-1 text-xs bg-[#222222] text-white rounded-sm hover:bg-black font-medium cursor-pointer"
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
    <div className="flex-1 flex flex-col min-w-0 min-h-0 lg:h-screen lg:overflow-hidden">
      {/* Topbar Superior */}
      <Topbar
        titulo="Painel de Disponibilidade de Estoque"
        subtitulo="Visão Geral de Ordens e Disponibilidade de Componentes"
        onAbrirSimulador={onAbrirSimulador}
      />

      {/* Conteúdo Principal */}
      <main
        id="conteudo-principal"
        tabIndex={-1}
        className="flex-1 flex flex-col px-4 lg:px-6 py-4 w-full max-w-full min-w-0 min-h-0 lg:overflow-hidden space-y-4 focus:outline-none"
      >
        {/* 1. METRICS / KPIS (5 Cards em Grid Widescreen) */}
        <section className="shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Card 1 */}
          <div className="bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between transition-all hover:border-[#D5D5D5] min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-widest text-[#757575] font-medium">
                Total de Ordens
              </span>
              <Icon name="analytics" aria-hidden="true" className="w-[18px] h-[18px] text-[#757575] shrink-0" />
            </div>
            <div className="mt-3">
              {isInitialLoading ? (
                <>
                  <div className="h-7 w-20 bg-[#EAEAEA] rounded-xs animate-pulse" />
                  <div className="h-3 w-24 bg-[#F0F0F0] rounded-xs animate-pulse mt-1.5" />
                </>
              ) : (
                <>
                  <span className="text-2xl font-medium text-[#1A1A1A] tracking-tight tabular-nums">
                    {metricas.total_itens_finais.toLocaleString("pt-BR")}
                  </span>
                  <p className="text-[11px] text-[#757575] mt-0.5">
                    {metricas.total_simulados > 0
                      ? `${metricas.total_simulados} simulado(s)`
                      : filtroTodasOps
                      ? "ordens (todas OPs)"
                      : "ordens avaliadas"}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Card 2 */}
          <div className="bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between transition-all hover:border-[#D5D5D5] min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-widest text-[#757575] font-medium">
                Saldo das Ordens
              </span>
              <Icon
                name="account_balance_wallet"
                aria-hidden="true"
                className="w-[18px] h-[18px] text-[#A0522D] shrink-0"
              />
            </div>
            <div className="mt-3">
              {isInitialLoading ? (
                <>
                  <div className="h-7 w-24 bg-[#EAEAEA] rounded-xs animate-pulse" />
                  <div className="h-3 w-20 bg-[#F0F0F0] rounded-xs animate-pulse mt-1.5" />
                </>
              ) : (
                <>
                  <span className="text-2xl font-medium text-[#1A1A1A] tracking-tight tabular-nums">
                    {formatarQtd(metricas.total_itens_avaliados ?? 0)}
                  </span>
                  <p className="text-[11px] text-[#757575] mt-0.5">saldo total</p>
                </>
              )}
            </div>
          </div>

          {/* Card 3 */}
          <div className="bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between transition-all hover:border-[#D5D5D5] min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-widest text-[#3B6E4C] font-medium">
                100% Disponíveis na Fila
              </span>
              <span className="w-2 h-2 rounded-full bg-[#3B6E4C] shrink-0" />
            </div>
            {isInitialLoading ? (
              <div className="mt-3">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="h-7 w-16 bg-[#EAEAEA] rounded-xs animate-pulse" />
                  <div className="h-4 w-10 bg-[#E8F0EA] rounded-xs animate-pulse" />
                </div>
                <div className="w-full bg-[#EEEEEE] h-1.5 rounded-full mt-2 overflow-hidden">
                  <div className="bg-[#D5E6D9] h-full w-1/2 animate-pulse" />
                </div>
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-medium text-[#1A1A1A] tracking-tight tabular-nums">
                    {metricas.total_disponiveis.toLocaleString("pt-BR")}
                  </span>
                  <span className="px-2 py-0.5 rounded-xs bg-[#3B6E4C]/10 text-[#3B6E4C] text-[11px] font-semibold tabular-nums">
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
              </>
            )}
          </div>

          {/* Card 4 */}
          <div className="bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between transition-all hover:border-[#D5D5D5] min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-widest text-[#B84A39] font-medium">
                Com Componentes Faltando
              </span>
              <span className="w-2 h-2 rounded-full bg-[#B84A39] shrink-0" />
            </div>
            {isInitialLoading ? (
              <div className="mt-3">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="h-7 w-16 bg-[#EAEAEA] rounded-xs animate-pulse" />
                  <div className="h-4 w-10 bg-[#F9E4E0] rounded-xs animate-pulse" />
                </div>
                <div className="w-full bg-[#EEEEEE] h-1.5 rounded-full mt-2 overflow-hidden">
                  <div className="bg-[#F2CBC4] h-full w-1/2 animate-pulse" />
                </div>
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-medium text-[#1A1A1A] tracking-tight tabular-nums">
                    {metricas.total_com_falta.toLocaleString("pt-BR")}
                  </span>
                  <span className="px-2 py-0.5 rounded-xs bg-[#B84A39]/10 text-[#B84A39] text-[11px] font-semibold tabular-nums">
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
              </>
            )}
            <button
              type="button"
              onClick={onAbrirFaltantes}
              className="touch-target mt-2 text-left text-[11px] font-medium text-[#8B5A2B] hover:underline cursor-pointer"
              title="Ver tudo o que falta, por local de produção e tipo, com os filtros atuais"
            >
              Ver resumo de itens faltantes →
            </button>
          </div>

          {/* Card 5 */}
          <div className="col-span-2 sm:col-span-1 bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] flex flex-col justify-between transition-all hover:border-[#D5D5D5] min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-widest text-[#757575] font-medium">
                Total de Pedidos
              </span>
              <Icon name="inventory" aria-hidden="true" className="w-[18px] h-[18px] text-[#757575] shrink-0" />
            </div>
            <div className="mt-3">
              {isInitialLoading ? (
                <>
                  <div className="h-7 w-20 bg-[#EAEAEA] rounded-xs animate-pulse" />
                  <div className="h-3 w-24 bg-[#F0F0F0] rounded-xs animate-pulse mt-1.5" />
                </>
              ) : (
                <>
                  <span className="text-2xl font-medium text-[#1A1A1A] tracking-tight tabular-nums">
                    {metricas.total_pedidos.toLocaleString("pt-BR")}
                  </span>
                  <p className="text-[11px] text-[#757575] mt-0.5">pedidos avaliados</p>
                </>
              )}
            </div>
          </div>
        </section>

        {/* 2. BARRA CONDENSADA DE FILTROS (Linha Única) */}
        <search
          aria-label="Filtros de disponibilidade de estoque"
          className="shrink-0 w-full max-w-full min-w-0 bg-white rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] overflow-hidden"
        >
          <div className="px-3 py-2 filtros-bar-single min-w-0">
            {/* Local de Produção */}
            <div className="flex flex-col min-w-0">
              <span
                id={localLabelId}
                className="text-[10px] uppercase tracking-wider text-[#757575] font-medium mb-0.5 leading-none"
              >
                Local
              </span>
              <div
                className={`h-8 min-w-[100px] max-w-[136px] rounded-sm flex items-stretch transition-all border overflow-hidden ${
                  qtdLocaisFiltrados > 0
                    ? "bg-[#FCFAF7] border-[#8B5A2B] shadow-sm"
                    : "bg-white border-[#E0E0E0] hover:border-[#1A1A1A]"
                }`}
              >
                <button
                  type="button"
                  aria-labelledby={localLabelId}
                  onClick={onAbrirModalFiltroLocal}
                  className="touch-target flex-1 min-w-0 px-2 text-[11px] flex items-center justify-between gap-1.5 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8B5A2B]"
                  title="Filtrar por fábricas e locais de produção"
                >
                  <span className="flex items-center gap-1 min-w-0">
                    <Icon
                      name="factory"
                      aria-hidden="true"
                      className={`w-4 h-4 shrink-0 ${
                        qtdLocaisFiltrados > 0 ? "text-[#8B5A2B]" : "text-[#757575]"
                      }`}
                    />
                    <span
                      className={`truncate ${
                        qtdLocaisFiltrados > 0 ? "font-semibold text-[#1A1A1A]" : "text-[#424242]"
                      }`}
                    >
                      {qtdLocaisFiltrados > 0
                        ? `${qtdLocaisFiltrados} ${qtdLocaisFiltrados === 1 ? "local" : "locais"}`
                        : "Todos"}
                    </span>
                  </span>
                  <Icon name="tune" aria-hidden="true" className="w-3.5 h-3.5 text-[#757575] shrink-0" />
                </button>
                {qtdLocaisFiltrados > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiltroLocal([])}
                    aria-label="Limpar filtro de locais"
                    title="Limpar filtro de locais"
                    className="touch-target px-1.5 flex items-center justify-center text-[#B84A39] hover:bg-[#FFEBEE] border-l border-[#8B5A2B]/25 text-[11px] font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8B5A2B]"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Família (Itens 3) */}
            <div className="flex flex-col min-w-0">
              <span
                id={familiaLabelId}
                className="text-[10px] uppercase tracking-wider text-[#757575] font-medium mb-0.5 leading-none"
              >
                Família (3)
              </span>
              <div
                className={`h-8 min-w-[82px] max-w-[116px] rounded-sm flex items-stretch transition-all border overflow-hidden ${
                  qtdFamiliasFiltradas > 0
                    ? "bg-[#FCFAF7] border-[#8B5A2B] shadow-sm"
                    : "bg-white border-[#E0E0E0] hover:border-[#1A1A1A]"
                }`}
              >
                <button
                  type="button"
                  aria-labelledby={familiaLabelId}
                  onClick={onAbrirModalFiltroFamilia}
                  className="touch-target flex-1 min-w-0 px-2 text-[11px] flex items-center justify-between gap-1.5 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8B5A2B]"
                  title="Filtrar e recalcular o consumo pelas famílias dos componentes (itens 3)"
                >
                  <span className="flex items-center gap-1 min-w-0">
                    <Icon
                      name="category"
                      aria-hidden="true"
                      className={`w-3.5 h-3.5 shrink-0 ${
                        qtdFamiliasFiltradas > 0 ? "text-[#8B5A2B]" : "text-[#757575]"
                      }`}
                    />
                    <span
                      className={`truncate ${
                        qtdFamiliasFiltradas > 0 ? "font-semibold font-mono text-[#1A1A1A]" : "text-[#424242]"
                      }`}
                    >
                      {qtdFamiliasFiltradas > 0 ? `${qtdFamiliasFiltradas} fam.` : "Todas"}
                    </span>
                  </span>
                  <Icon name="tune" aria-hidden="true" className="w-3.5 h-3.5 text-[#9E9E9E] shrink-0" />
                </button>
                {qtdFamiliasFiltradas > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiltroFamilias([])}
                    aria-label="Limpar filtro de famílias"
                    title="Limpar filtro de famílias"
                    className="touch-target px-1.5 flex items-center justify-center text-[#B84A39] hover:bg-[#FFEBEE] border-l border-[#8B5A2B]/25 text-[11px] font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8B5A2B]"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Período Unificado (Referência + De / Até) */}
            <div className="flex flex-col min-w-0 max-w-full">
              <span
                id={periodoLabelId}
                className="text-[10px] uppercase tracking-wider text-[#757575] font-medium mb-0.5 leading-none"
              >
                Período
              </span>
              <div
                className={`min-h-8 h-auto sm:h-8 inline-flex flex-wrap sm:flex-nowrap items-center max-w-full rounded-sm border overflow-hidden ${
                  filtroDataInicio || filtroDataFim
                    ? "border-[#8B5A2B] bg-[#FCFAF7]"
                    : "border-[#E0E0E0] bg-white"
                }`}
              >
                <div className="relative h-8 sm:h-full flex items-center bg-[#F5F5F5] border-r border-[#E0E0E0]">
                  <select
                    id={tipoDataId}
                    aria-label="Referência de data do período"
                    value={filtroTipoData}
                    onChange={(e) => setFiltroTipoData(e.target.value)}
                    className="select-custom touch-target h-full appearance-none bg-transparent pl-2 pr-6 text-[11px] font-medium text-[#1A1A1A] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8B5A2B]"
                    title="Alternar data base entre Abertura de OP e Entrega de Pedido"
                  >
                    <option value="abertura_op">Abertura de OP</option>
                    <option value="entrega_pedido">Entrega de Pedido</option>
                  </select>
                  <Icon
                    name="expand_more"
                    aria-hidden="true"
                    className="pointer-events-none absolute right-0.5 w-3.5 h-3.5 shrink-0 text-[#757575]"
                  />
                </div>
                <div className="flex items-center min-w-0">
                  <input
                    id={dataInicioId}
                    name="data_inicio"
                    type="date"
                    aria-label="Data inicial do período"
                    aria-describedby={periodoLabelId}
                    value={filtroDataInicio}
                    onChange={(e) => setFiltroDataInicio(e.target.value)}
                    className="touch-target h-8 sm:h-full w-[96px] min-w-0 bg-transparent px-1 text-center text-[11px] text-[#1A1A1A] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8B5A2B]"
                  />
                  <span className="text-[#9E9E9E] text-[10px] px-0.5 shrink-0" aria-hidden="true">
                    –
                  </span>
                  <input
                    id={dataFimId}
                    name="data_fim"
                    type="date"
                    aria-label="Data final do período"
                    aria-describedby={periodoLabelId}
                    value={filtroDataFim}
                    onChange={(e) => setFiltroDataFim(e.target.value)}
                    className="touch-target h-8 sm:h-full w-[96px] min-w-0 bg-transparent px-1 text-center text-[11px] text-[#1A1A1A] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8B5A2B]"
                  />
                </div>
              </div>
            </div>

            {/* Baixa */}
            <FiltroSelect
              id={baixaId}
              label="Baixa"
              value={filtroBaixa}
              onChange={(e) => setFiltroBaixa(e.target.value)}
              active={filtroBaixa !== "todos"}
              options={[
                { value: "todos", label: "Todas" },
                { value: "S", label: "Sim (S)" },
                { value: "N", label: "Não (N)" },
              ]}
            />

            {/* Origem */}
            <FiltroSelect
              id={origemId}
              label="Origem"
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              active={filtroTipo !== "todos"}
              options={[
                { value: "todos", label: "Todas" },
                { value: "C", label: "Comprado (C)" },
                { value: "P", label: "Produzido (P)" },
              ]}
            />

            {/* Status */}
            <FiltroSelect
              id={statusId}
              label="Status"
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              active={filtroStatus !== "todos"}
              toneClass={
                filtroStatus === "disponivel"
                  ? "bg-[#EBF4EC] border-[#3B6E4C] text-[#245D31] font-semibold"
                  : filtroStatus === "falta"
                  ? "bg-[#FFEBEE] border-[#B84A39] text-[#B84A39] font-semibold"
                  : ""
              }
              options={[
                { value: "todos", label: "Todos" },
                { value: "disponivel", label: "Disponíveis" },
                { value: "falta", label: "Com Falta" },
              ]}
            />

            <span className="hidden xl:inline-block h-7 w-px bg-[#EAEAEA] self-end mb-0.5" aria-hidden="true" />

            {/* Escopo */}
            <FiltroSelect
              id={escopoId}
              label="Escopo"
              value={filtroTodasOps ? "todas_ops" : "itens_finais"}
              onChange={(e) => setFiltroTodasOps(e.target.value === "todas_ops")}
              active={Boolean(filtroTodasOps)}
              toneClass={
                filtroTodasOps
                  ? "bg-[#FBF7F4] border-[#8B5A2B] text-[#8B5A2B] font-semibold"
                  : ""
              }
              title="Alterna entre itens finais raiz (MRP multinível) e todas as OPs abertas (1 nível)"
              options={[
                { value: "itens_finais", label: "Itens Finais" },
                { value: "todas_ops", label: "Todas as OPs" },
              ]}
            />

            {/* Abatimento */}
            <FiltroSelect
              id={abatimentoId}
              label="Abatimento"
              value={filtroEscopoAbatimento}
              onChange={(e) => setFiltroEscopoAbatimento(e.target.value)}
              active={filtroEscopoAbatimento === "filtrado"}
              toneClass={
                filtroEscopoAbatimento === "filtrado"
                  ? "bg-[#FBF7F4] border-[#8B5A2B] text-[#8B5A2B] font-semibold"
                  : ""
              }
              title="Define se o estoque abate pela fila global completa ou apenas entre as ordens nos filtros atuais"
              options={[
                { value: "global", label: "Fila Global" },
                { value: "filtrado", label: "Apenas no Filtro" },
              ]}
            />

            {/* Ações Rápidas */}
            <div className="flex items-center gap-1.5 ms-auto self-end">
              <button
                type="button"
                aria-pressed={Boolean(filtroApenasSimulados)}
                onClick={() => setFiltroApenasSimulados((prev) => !prev)}
                className={`touch-target h-8 px-2.5 rounded-sm border text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B5A2B] ${
                  filtroApenasSimulados
                    ? "bg-[#8B5A2B] text-white border-[#8B5A2B]"
                    : "bg-white border-[#E0E0E0] text-[#1A1A1A] hover:bg-[#F5F5F5]"
                }`}
                title="Exibir apenas as linhas com pedidos consultados/simulados"
              >
                <Icon name="tune" aria-hidden="true" className="w-4 h-4 shrink-0" />
                <span>Simulados</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none ${
                    filtroApenasSimulados
                      ? "bg-white/20 text-white"
                      : "bg-neutral-100 text-neutral-700"
                  }`}
                >
                  {metricas.total_simulados || 0}
                </span>
              </button>

              {temFiltrosAtivos && (
                <button
                  type="button"
                  onClick={limparFiltros}
                  className="touch-target h-8 px-2.5 rounded-sm border border-[#E0E0E0] bg-white text-[#666666] hover:text-[#B84A39] hover:border-[#B84A39]/50 hover:bg-[#FFF5F5] text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B5A2B]"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>

          {/* Banda Condicional: Pedidos Simulados Ativos + Chips de Filtros */}
          {(pedidosSimuladosAtivos.length > 0 ||
            Object.keys(colFiltros).length > 0 ||
            Boolean(filtroPedido) ||
            Boolean(filtroCodigo) ||
            filtroDataInicio ||
            filtroDataFim ||
            filtroApenasSimulados ||
            filtroTodasOps ||
            filtroEscopoAbatimento === "filtrado") && (
            <div className="px-3.5 py-1.5 border-t border-[#EEEEEE] bg-white filtros-row-balanced gap-1.5">
              {pedidosSimuladosAtivos.length > 0 && (
                <>
                  <span className="text-[10px] text-[#8B5A2B] font-bold uppercase tracking-wider flex items-center gap-1">
                    <Icon name="science" aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
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
                          className="hover:text-[#C62828] font-bold leading-none cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B5A2B]"
                          title={`Remover pedido ${ps.pedido} da simulação`}
                          aria-label={`Remover pedido ${ps.pedido} da simulação`}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </>
              )}

              {(Object.keys(colFiltros).length > 0 ||
                Boolean(filtroPedido) ||
                Boolean(filtroCodigo) ||
                filtroDataInicio ||
                filtroDataFim ||
                filtroApenasSimulados ||
                filtroTodasOps ||
                filtroEscopoAbatimento === "filtrado") && (
                <>
                  {pedidosSimuladosAtivos.length > 0 && (
                    <span className="h-3.5 w-px bg-[#E0E0E0] mx-1" aria-hidden="true" />
                  )}
                  <span className="text-[10px] text-[#757575] font-semibold uppercase tracking-wider">
                    Filtros Ativos:
                  </span>
                  {Boolean(filtroPedido) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] bg-[#F5F5F5] text-[#1A1A1A] border border-[#E0E0E0]">
                      <strong>Pedido:</strong> {filtroPedido}
                      <button
                        type="button"
                        onClick={() => setFiltroPedido("")}
                        className="hover:text-[#C62828] ml-0.5 font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B5A2B]"
                        title="Remover filtro de pedido"
                        aria-label="Remover filtro de pedido"
                      >
                        ×
                      </button>
                    </span>
                  )}
                  {Boolean(filtroCodigo) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] bg-[#F5F5F5] text-[#1A1A1A] border border-[#E0E0E0]">
                      <strong>Item/Desc.:</strong> {filtroCodigo}
                      <button
                        type="button"
                        onClick={() => setFiltroCodigo("")}
                        className="hover:text-[#C62828] ml-0.5 font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B5A2B]"
                        title="Remover filtro de código ou descrição"
                        aria-label="Remover filtro de código ou descrição"
                      >
                        ×
                      </button>
                    </span>
                  )}
                  {filtroTodasOps && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] bg-[#FBF7F4] text-[#8B5A2B] border border-[#8B5A2B]/30">
                      <strong>Modo Todas as OPs</strong> (com e sem pai — 1 nível por OP)
                      <button
                        type="button"
                        onClick={() => setFiltroTodasOps(false)}
                        className="hover:text-[#C62828] ml-0.5 font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B5A2B]"
                        title="Voltar ao modo padrão (apenas Itens Finais)"
                        aria-label="Voltar ao modo padrão Itens Finais"
                      >
                        ×
                      </button>
                    </span>
                  )}
                  {filtroEscopoAbatimento === "filtrado" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] bg-[#FBF7F4] text-[#8B5A2B] border border-[#8B5A2B]/30">
                      <strong>Abatimento:</strong> Apenas no Filtro
                      <button
                        type="button"
                        onClick={() => setFiltroEscopoAbatimento("global")}
                        className="hover:text-[#C62828] ml-0.5 font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B5A2B]"
                        title="Voltar ao abatimento pela fila global"
                        aria-label="Remover modo de abatimento Apenas no Filtro"
                      >
                        ×
                      </button>
                    </span>
                  )}
                  {filtroApenasSimulados && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] bg-[#FBF7F4] text-[#8B5A2B] border border-[#8B5A2B]/30">
                      <strong>Apenas Simulados</strong>
                      <button
                        type="button"
                        onClick={() => setFiltroApenasSimulados(false)}
                        className="hover:text-[#C62828] ml-0.5 font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B5A2B]"
                        title="Remover filtro Apenas Simulados"
                        aria-label="Remover filtro Apenas Simulados"
                      >
                        ×
                      </button>
                    </span>
                  )}
                  {(filtroDataInicio || filtroDataFim) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] bg-[#F5F5F5] text-[#1A1A1A] border border-[#E0E0E0]">
                      <strong>
                        {filtroTipoData === "entrega_pedido" ? "Entrega Pedido:" : "Abertura OP:"}
                      </strong>{" "}
                      {filtroDataInicio || "Início"} até {filtroDataFim || "Fim"}
                      <button
                        type="button"
                        onClick={() => {
                          setFiltroDataInicio("");
                          setFiltroDataFim("");
                        }}
                        className="hover:text-[#C62828] ml-0.5 font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B5A2B]"
                        title="Remover filtro de data"
                        aria-label="Remover filtro de data"
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
                        className="hover:text-[#C62828] ml-0.5 font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8B5A2B]"
                        title={`Remover filtro da coluna ${k}`}
                        aria-label={`Remover filtro da coluna ${k}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </>
              )}
            </div>
          )}
        </search>

        {/* 3. TABELA COMPLETA DE ITENS (LÍDER DESIGN) */}
        <section className="flex-1 flex flex-col min-h-[360px] lg:min-h-0 w-full max-w-full min-w-0 bg-white rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)] overflow-hidden">
          <div
            ref={scrollContainerRef}
            onScroll={handleScrollContainer}
            tabIndex={0}
            role="region"
            aria-labelledby={tableId}
            aria-busy={isInitialLoading}
            className="flex-1 min-h-0 max-h-[65vh] lg:max-h-none overflow-auto relative focus:outline-none"
          >
            <table className="w-full text-left text-xs border-collapse">
              <caption id={tableId} className="sr-only">
                Tabela de análise de estoque de itens finais com rolagem infinita
              </caption>
              <thead className="sticky top-0 z-20 bg-white shadow-[0_1px_0_#EAEAEA] text-[#757575] border-b border-[#EAEAEA] text-[11px] uppercase tracking-wider">
                <tr>
                  {renderColumnHeader("item_final", filtroTodasOps ? "Código / OP" : "Código (Item Final)", "pl-4 min-w-[135px]")}
                  {renderColumnHeader("descricao", "Descrição do Produto", "min-w-[165px] max-w-[230px]")}
                  {renderColumnHeader("pedido", "Pedido", "min-w-[78px]", "center")}
                  {renderColumnHeader("fabrica", "Local Produção", "min-w-[96px]")}
                  {renderColumnHeader("data_abertura", "Abertura OP", "min-w-[84px]", "center")}
                  {renderColumnHeader("saldo", "Saldo", "min-w-[66px]", "right")}
                  {renderColumnHeader("entrega", "Entrega", "min-w-[84px]", "center")}
                  <th scope="col" className="py-3 px-2.5 text-center min-w-[120px] font-medium text-[#757575]">
                    Disponibilidade
                  </th>
                  {renderColumnHeader("status", "Status", "min-w-[100px]", "center")}
                  <th
                    scope="col"
                    className="py-3 pr-4 pl-2 text-right min-w-[126px] font-medium text-[#757575] sticky right-0 z-30 bg-white xl:static shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] xl:shadow-none"
                  >
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAEAEA]">
                {isInitialLoading ? (
                  <>
                    <tr className="sr-only">
                      <td colSpan={10}>{loadingMsg}</td>
                    </tr>
                    {Array.from({ length: 8 }).map((_, sIdx) => (
                      <tr key={`skeleton-${sIdx}`} className="bg-white">
                        <td className="py-3 pl-4 pr-2">
                          <div className="h-3.5 w-24 bg-[#EAEAEA] rounded-xs animate-pulse" />
                        </td>
                        <td className="py-3 px-2">
                          <div className="h-3.5 w-36 bg-[#EEEEEE] rounded-xs animate-pulse" />
                        </td>
                        <td className="py-3 px-2 text-center">
                          <div className="h-3.5 w-12 mx-auto bg-[#EEEEEE] rounded-xs animate-pulse" />
                        </td>
                        <td className="py-3 px-2">
                          <div className="h-3.5 w-20 bg-[#EEEEEE] rounded-xs animate-pulse" />
                        </td>
                        <td className="py-3 px-2 text-center">
                          <div className="h-3.5 w-14 mx-auto bg-[#EEEEEE] rounded-xs animate-pulse" />
                        </td>
                        <td className="py-3 px-2 text-right">
                          <div className="h-3.5 w-10 ml-auto bg-[#EEEEEE] rounded-xs animate-pulse" />
                        </td>
                        <td className="py-3 px-2 text-center">
                          <div className="h-3.5 w-14 mx-auto bg-[#EEEEEE] rounded-xs animate-pulse" />
                        </td>
                        <td className="py-3 px-2.5">
                          <div className="h-2.5 w-full bg-[#EAEAEA] rounded-full animate-pulse" />
                        </td>
                        <td className="py-3 px-2 text-center">
                          <div className="h-5 w-16 mx-auto bg-[#EEEEEE] rounded-full animate-pulse" />
                        </td>
                        <td className="py-3 pr-4 pl-2 text-right sticky right-0 z-10 bg-white xl:static">
                          <div className="h-6 w-24 ml-auto bg-[#EEEEEE] rounded-sm animate-pulse" />
                        </td>
                      </tr>
                    ))}
                  </>
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
                      const stickyRowBg = isSimuladoCarteira
                        ? "bg-[#F8FAFC]"
                        : isSimulado
                        ? "bg-[#FBF7F4]"
                        : "bg-white";

                      return (
                        <tr
                          key={`${it.ordem_op || it.item_final}_${it.pedido}_${it.fabrica}_${idx}`}
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
                            className="py-3 pl-4 pr-2 font-mono text-xs font-semibold text-[#1A1A1A]"
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{it.item_final}</span>
                              {it.ordem_op && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.2 rounded-xs text-[9px] font-mono font-medium bg-[#F3F4F6] text-[#374151] border border-[#E5E7EB]"
                                  title={`Ordem de Produção ${it.ordem_op}`}
                                >
                                  OP {it.ordem_op}
                                </span>
                              )}
                              {it.eh_raiz === false && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.2 rounded-xs text-[9px] font-sans font-semibold bg-[#EEF2FF] text-[#3730A3] border border-[#C7D2FE]"
                                  title={
                                    it.item_final_pai
                                      ? `Subcomponente de ${it.item_final_pai}${it.fabrica_pai ? ` (${it.fabrica_pai})` : ""}`
                                      : "Subcomponente com item pai"
                                  }
                                >
                                  Subcomp.
                                </span>
                              )}
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
                                    <Icon name="science" aria-hidden="true" className="w-3 h-3 shrink-0" />
                                    <span>Simulado</span>
                                  </span>
                                )
                              )}
                            </div>
                            {it.eh_raiz === false && it.item_final_pai && (
                              <div
                                className="text-[10px] font-sans font-normal text-[#757575] mt-0.5 truncate max-w-[180px]"
                                title={`Item pai: ${it.item_final_pai}${it.fabrica_pai ? ` • ${it.fabrica_pai}` : ""}`}
                              >
                                Pai: <span className="font-mono">{it.item_final_pai}</span>
                                {it.fabrica_pai ? ` (${it.fabrica_pai})` : ""}
                              </div>
                            )}
                          </th>
                          <td className="py-3 px-2.5 min-w-[165px] max-w-[230px] truncate uppercase font-normal text-xs text-[#1A1A1A]" title={it.descricao}>
                            {it.descricao || "-"}
                          </td>
                          <td
                            className={`py-3 px-2 text-center font-mono ${
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
                                className="touch-target px-1.5 py-0.5 rounded-xs hover:bg-[#FAF5EE] hover:text-[#8B5A2B] transition-colors inline-flex items-center gap-0.5 text-xs font-medium text-[#1A1A1A] cursor-pointer"
                                title={`Abrir Resumo Gerencial do Pedido #${it.pedido}`}
                              >
                                <span>{it.pedido}</span>
                                <Icon name="open_in_new" aria-hidden="true" className="w-3 h-3 shrink-0 opacity-65" />
                              </button>
                            ) : (
                              <span className="text-[#9E9E9E]">-</span>
                            )}
                          </td>
                          <td className="py-3 px-2.5 text-[#555] text-xs font-medium">
                            {it.fabrica}
                          </td>
                          <td
                            className={`py-3 px-2 text-center font-mono text-xs text-[#1A1A1A] ${
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
                          <td className="py-3 px-2 text-right font-mono font-medium text-[#1A1A1A] text-xs tabular-nums">
                            {formatarQtd(it.saldo)}
                          </td>
                          <td className="py-3 px-2 text-center text-[#757575] font-mono text-xs">
                            {it.entrega || "-"}
                          </td>
                          <td className="py-3 px-2.5">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center justify-between text-[11px] gap-1">
                                <span className="text-[#757575] tabular-nums">
                                  {it.componentes_disponiveis}/{it.total_componentes}
                                </span>
                                <span className={`font-mono font-semibold tabular-nums ${isDisponivel ? "text-[#3B6E4C]" : it.perc_disponivel > 70 ? "text-[#835425]" : "text-[#B84A39]"}`}>
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
                          <td className="py-3 px-2 text-center whitespace-nowrap">
                            {isDisponivel ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#3B6E4C]/10 text-[#3B6E4C] text-[11px] font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#3B6E4C]" />
                                Disponível
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#B84A39]/10 text-[#B84A39] text-[11px] font-semibold">
                                <Icon name="warning" aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
                                Faltam {it.componentes_faltando}
                              </span>
                            )}
                          </td>
                          <td className={`py-3 pr-4 pl-2 text-right whitespace-nowrap sticky right-0 z-10 xl:static shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] xl:shadow-none ${stickyRowBg}`}>
                            <div className="inline-flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => onAbrirDetalhes(it)}
                                className="touch-target inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-[#E0E0E0] bg-transparent text-[#1A1A1A] hover:border-[#1A1A1A] text-xs transition-colors cursor-pointer"
                                title="Ver insumos deste item final"
                              >
                                <Icon name="visibility" aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-[#757575]" />
                                <span>Insumos</span>
                              </button>
                              {it.pedido && (
                                <button
                                  type="button"
                                  onClick={() => onAbrirResumoPedido(it.pedido, "TODOS")}
                                  aria-label={`Resumo Gerencial do Pedido ${it.pedido}`}
                                  className="touch-target inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-[#E0E0E0] bg-transparent text-[#1A1A1A] hover:border-[#1A1A1A] text-xs transition-colors cursor-pointer"
                                  title={`Resumo Gerencial do Pedido #${it.pedido}`}
                                >
                                  <Icon name="receipt_long" aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-[#757575]" />
                                  <span className="hidden 2xl:inline">Resumo</span>
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
                          <Icon name="progress_activity" aria-hidden="true" className="w-4 h-4 shrink-0 animate-spin text-[#1A1A1A]" />
                          <span>Carregando mais linhas...</span>
                        </div>
                      ) : hasMore ? (
                        <span className="text-[#9E9E9E] text-[11px]">
                          Role a tabela para carregar mais registros
                        </span>
                      ) : (
                        <span className="text-[#757575] font-medium text-[11px]">
                          ✓ Todos os {totalRegistros.toLocaleString("pt-BR")} {filtroTodasOps ? "registros (OPs)" : "itens finais"} carregados.
                        </span>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Rodapé informativo de rolagem infinita */}
          <div className="shrink-0 px-4 lg:px-6 py-3 border-t border-[#EAEAEA] bg-[#FAFAFA] flex flex-wrap items-center justify-between gap-4 text-xs text-[#757575]">
            <div className="flex items-center gap-3">
              <span>
                Exibindo <span className="font-medium text-[#1A1A1A] font-mono">{itens.length}</span> de{" "}
                <span className="font-medium text-[#1A1A1A] font-mono">
                  {totalRegistros.toLocaleString("pt-BR")}
                </span>{" "}
                {filtroTodasOps ? "ordens (OPs)" : "itens finais"}
              </span>
            </div>

            <div className="flex items-center gap-6">
              <span className="text-[11px] text-[#757575] italic items-center gap-1.5 hidden md:flex">
                <Icon name="mouse" aria-hidden="true" className="w-4 h-4 shrink-0" />
                {hasMore ? "Role internamente para carregar mais linhas" : "Fim dos registros"}
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
