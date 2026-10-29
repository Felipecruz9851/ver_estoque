import React, { useState, useEffect, useCallback, useRef, useId } from "react";
import { apiCall } from "./api";
import logoLider from "./logo_lider.png";

export default function VerEstoque({ onVoltar, isStandalone = false }) {
  const tableId = useId();
  const sentinelRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Estados de dados
  const [itens, setItens] = useState([]);
  const [metricas, setMetricas] = useState({
    total_itens_finais: 0,
    total_disponiveis: 0,
    total_com_falta: 0,
    total_pedidos: 0,
  });
  const [locaisProducao, setLocaisProducao] = useState([]);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [dataCarga, setDataCarga] = useState("");
  const [dataCarregamento, setDataCarregamento] = useState("");

  // Estados de carregamento e paginação contínua (Infinite Scroll)
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [exportando, setExportando] = useState(false);

  // Filtros Globais
  const [filtroLocal, setFiltroLocal] = useState("");
  const [filtroPedido, setFiltroPedido] = useState("");
  const [filtroCodigo, setFiltroCodigo] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos"); // 'todos' | 'disponivel' | 'falta'
  const [filtroBaixa, setFiltroBaixa] = useState("todos"); // 'todos' | 'S' | 'N'
  const [filtroTipo, setFiltroTipo] = useState("todos"); // 'todos' | 'C' | 'P'
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  // Filtros em Títulos de Colunas (Executados 100% no Backend)
  const [colFiltros, setColFiltros] = useState({});
  const [activeColMenu, setActiveColMenu] = useState(null);
  const [localColInput, setLocalColInput] = useState("");

  // Modal de Detalhes
  const [itemSelecionado, setItemSelecionado] = useState(null);
  const [detalhesItem, setDetalhesItem] = useState(null);
  const [carregandoDetalhes, setCarregandoDetalhes] = useState(false);
  const [abaDetalhe, setAbaDetalhe] = useState("faltando"); // 'faltando' | 'disponiveis'
  const [modalBaixa, setModalBaixa] = useState("todos"); // 'todos' | 'S' | 'N'
  const [modalTipo, setModalTipo] = useState("todos"); // 'todos' | 'C' | 'P'

  // Fecha menu de coluna ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (activeColMenu && !e.target.closest(".col-filter-popover")) {
        setActiveColMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeColMenu]);

  // Função centralizada para carregar dados (reset ou append)
  const carregarDados = useCallback(
    async (isReset = true, paginaDestino = 0, recarregarCache = false) => {
      if (isReset) {
        setLoading(true);
        if (recarregarCache) {
          setLoadingMsg("Recalculando árvore BFS sem filtros...");
        } else {
          setLoadingMsg("Carregando itens finais...");
        }
      } else {
        setLoadingMore(true);
      }

      try {
        const payload = {
          filtros: {
            local_producao: filtroLocal,
            pedido: filtroPedido,
            codigo: filtroCodigo,
            status: filtroStatus,
            baixa: filtroBaixa,
            tipo: filtroTipo,
            col_filtros: colFiltros,
            data_inicio: filtroDataInicio,
            data_fim: filtroDataFim,
          },
          page: paginaDestino,
          page_size: pageSize,
          recarregar: recarregarCache,
        };

        const res = await apiCall("obter_estoque_itens_finais", payload);
        if (res && res.erro) throw new Error(res.erro);

        const novosItens = res.itens || [];
        const total = res.total_registros || 0;

        if (isReset) {
          setItens(novosItens);
          setPage(0);
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
          }
        } else {
          setItens((prev) => [...prev, ...novosItens]);
          setPage(paginaDestino);
        }

        setTotalRegistros(total);
        setHasMore((paginaDestino + 1) * pageSize < total);

        if (res.metricas) setMetricas(res.metricas);
        if (res.locais_producao) setLocaisProducao(res.locais_producao);
        if (res.data_carga) setDataCarga(res.data_carga);
        if (res.data_carregamento) setDataCarregamento(res.data_carregamento);
      } catch (e) {
        alert("Erro ao carregar análise de estoque: " + e.message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      filtroLocal,
      filtroPedido,
      filtroCodigo,
      filtroStatus,
      filtroBaixa,
      filtroTipo,
      filtroDataInicio,
      filtroDataFim,
      colFiltros,
      pageSize,
    ]
  );

  // Recarrega do início sempre que qualquer filtro mudar
  useEffect(() => {
    carregarDados(true, 0);
  }, [
    filtroLocal,
    filtroPedido,
    filtroCodigo,
    filtroStatus,
    filtroBaixa,
    filtroTipo,
    filtroDataInicio,
    filtroDataFim,
    colFiltros,
  ]);

  // Infinite Scroll via IntersectionObserver (posicionado 10 linhas antes do fim)
  useEffect(() => {
    if (!sentinelRef.current || loading || loadingMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          carregarDados(false, page + 1);
        }
      },
      {
        root: scrollContainerRef.current,
        threshold: 0.1,
      }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, page, carregarDados, itens.length]);

  // Listener de Scroll no container interno da tabela (salvaguarda de ~10 linhas / ~450px)
  const handleScrollContainer = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (
      scrollHeight - scrollTop - clientHeight < 450 &&
      hasMore &&
      !loading &&
      !loadingMore
    ) {
      carregarDados(false, page + 1);
    }
  };

  const handleExportarExcel = async () => {
    try {
      setExportando(true);
      const res = await apiCall("exportar_analise_estoque", {
        filtros: {
          local_producao: filtroLocal,
          pedido: filtroPedido,
          codigo: filtroCodigo,
          status: filtroStatus,
          baixa: filtroBaixa,
          tipo: filtroTipo,
          col_filtros: colFiltros,
          data_inicio: filtroDataInicio,
          data_fim: filtroDataFim,
        },
      });
      if (res && res.erro) throw new Error(res.erro);
      if (res.url) {
        const a = document.createElement("a");
        a.href = res.url;
        a.download = res.nome || "analise_estoque_itens_finais.xlsx";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {
      alert("Erro ao exportar Excel: " + e.message);
    } finally {
      setExportando(false);
    }
  };

  // Carrega modal com filtros locais do modal
  const carregarDetalhes = async (it, bFiltro = modalBaixa, tFiltro = modalTipo) => {
    setCarregandoDetalhes(true);
    try {
      const res = await apiCall("obter_detalhes_item_final", {
        item_final: it.item_final,
        pedido: it.pedido,
        fabrica: it.fabrica,
        baixa: bFiltro,
        tipo: tFiltro,
      });
      if (res && res.erro) throw new Error(res.erro);
      setDetalhesItem(res);
    } catch (e) {
      alert("Erro ao obter detalhes do item: " + e.message);
    } finally {
      setCarregandoDetalhes(false);
    }
  };

  const abrirDetalhes = (it) => {
    setItemSelecionado(it);
    setAbaDetalhe(it.componentes_faltando > 0 ? "faltando" : "disponiveis");
    setModalBaixa("todos");
    setModalTipo("todos");
    carregarDetalhes(it, "todos", "todos");
  };

  const fecharDetalhes = () => {
    setItemSelecionado(null);
    setDetalhesItem(null);
  };

  const limparFiltros = () => {
    setFiltroLocal("");
    setFiltroPedido("");
    setFiltroCodigo("");
    setFiltroStatus("todos");
    setFiltroBaixa("todos");
    setFiltroTipo("todos");
    setFiltroDataInicio("");
    setFiltroDataFim("");
    setColFiltros({});
  };

  const temFiltrosAtivos =
    Boolean(filtroLocal) ||
    Boolean(filtroPedido) ||
    Boolean(filtroCodigo) ||
    filtroStatus !== "todos" ||
    filtroBaixa !== "todos" ||
    filtroTipo !== "todos" ||
    Boolean(filtroDataInicio) ||
    Boolean(filtroDataFim) ||
    Object.values(colFiltros).some((v) => Boolean(v && v.trim()));

  // Aplica filtro digitado no título da coluna no Backend
  const aplicarFiltroColuna = (colKey) => {
    const val = localColInput.trim();
    setColFiltros((prev) => {
      const novo = { ...prev };
      if (val) {
        novo[colKey] = val;
      } else {
        delete novo[colKey];
      }
      return novo;
    });
    setActiveColMenu(null);
  };

  const limparFiltroColuna = (colKey) => {
    setColFiltros((prev) => {
      const novo = { ...prev };
      delete novo[colKey];
      return novo;
    });
    setActiveColMenu(null);
  };

  // Renderizador de Cabeçalho com Filtro Popover Backend
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
              className="text-[#C62828] hover:bg-[#FFEBEE] rounded-full p-0.5 text-xs font-bold leading-none"
              title="Remover filtro desta coluna"
            >
              ✕
            </span>
          )}
        </div>

        {/* POPOVER DE FILTRO DA COLUNA */}
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
                className="text-[#9E9E9E] hover:text-[#1A1A1A]"
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
                    className="text-[11px] text-[#C62828] hover:underline"
                  >
                    Limpar
                  </button>
                )}
                <div className="flex gap-1.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => setActiveColMenu(null)}
                    className="px-2.5 py-1 text-xs border border-[#D5D5D5] rounded-sm hover:bg-[#F2F2F2]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 text-xs bg-[#222222] text-white rounded-sm hover:bg-black font-medium"
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
    <div className="h-screen max-h-screen w-screen overflow-hidden flex flex-col bg-[#F8F8F8] text-[#1A1A1A] font-sans">
      {/* HEADER SUPERIOR LÍDER DESIGN (FIXO NO TOPO) */}
      <header className="h-14 shrink-0 bg-white/95 backdrop-blur-md border-b border-[#E0E0E0] px-6 py-2.5 flex items-center justify-between shadow-xs z-30">
        <div className="flex items-center gap-4">
          {!isStandalone && onVoltar && (
            <button
              onClick={onVoltar}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-[#D5D5D5] bg-white text-[#1A1A1A] text-xs font-medium hover:bg-[#F2F2F2] transition-colors"
              title="Voltar"
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              <span>Voltar</span>
            </button>
          )}

          <img src={logoLider} alt="Líder Design" className="h-7 w-auto" />

          <div className="h-4 w-px bg-[#E0E0E0]" />

          <div>
            <h1 className="text-base font-semibold tracking-tight text-[#1A1A1A]">
              Disponibilidade de Estoque por Item Final
            </h1>
            <p className="text-[11px] text-[#666666]">
              Ordenado por data de abertura da OP • Consumo multinível comparado ao estoque em Situação L
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {(dataCarga || dataCarregamento) && (
            <div
              className="flex items-center gap-2 px-2.5 py-1 bg-[#F9F9F9] border border-[#E0E0E0] rounded-sm text-left shadow-2xs"
              title={`Base de dados ERP: ${dataCarga}\nProcessado em memória: ${dataCarregamento || dataCarga}`}
            >
              <span className="material-symbols-outlined text-[16px] text-[#757575]">
                schedule
              </span>
              <div className="flex flex-col leading-none">
                <span className="text-[9px] font-semibold text-[#888888] uppercase tracking-wider">
                  Dados Carregados
                </span>
                <span className="text-[11px] font-semibold text-[#1A1A1A] font-mono mt-0.5">
                  {dataCarga || dataCarregamento}
                </span>
              </div>
            </div>
          )}

          <button
            onClick={() => carregarDados(true, 0, true)}
            disabled={loading || loadingMore}
            className="px-3 py-1.5 rounded-sm border border-[#D5D5D5] bg-white text-[#1A1A1A] text-xs font-medium hover:bg-[#F2F2F2] transition-colors flex items-center gap-1"
            title="Recalcular estrutura BFS e atualizar dados"
            type="button"
          >
            <span className={`material-symbols-outlined text-[16px] ${loading ? "animate-spin" : ""}`}>
              sync
            </span>
            <span>Recarregar Dados</span>
          </button>

          <button
            onClick={handleExportarExcel}
            disabled={exportando || totalRegistros === 0}
            className="px-3.5 py-1.5 rounded-sm bg-[#222222] text-white text-xs font-medium hover:bg-black transition-colors flex items-center gap-1.5 shadow-sm"
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">
              {exportando ? "hourglass_top" : "download"}
            </span>
            <span>{exportando ? "Exportando..." : "Exportar Excel"}</span>
          </button>
        </div>
      </header>

      {/* CONTEÚDO PRINCIPAL AJUSTADO À ALTURA DA TELA (SEM OVERFLOW VERTICAL EXTERNO) */}
      <main className="flex-1 flex flex-col px-6 py-3 w-full max-w-[1850px] mx-auto min-h-0 overflow-hidden space-y-2.5">
        {/* CARDS DE RESUMO (COMPACTOS E FIXOS) */}
        <section className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white p-2.5 rounded-sm border border-[#E0E0E0] shadow-xs">
            <span className="text-[10px] font-semibold text-[#757575] uppercase tracking-wider block">
              Total de Itens Finais
            </span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="text-xl font-bold text-[#1A1A1A]">
                {metricas.total_itens_finais.toLocaleString("pt-BR")}
              </span>
              <span className="text-[11px] text-[#757575]">ordens avaliadas</span>
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-sm border border-[#E0E0E0] shadow-xs">
            <span className="text-[10px] font-semibold text-[#2E7D32] uppercase tracking-wider block flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">check_circle</span>
              100% Disponíveis
            </span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="text-xl font-bold text-[#2E7D32]">
                {metricas.total_disponiveis.toLocaleString("pt-BR")}
              </span>
              <span className="text-[11px] text-[#2E7D32] font-medium">
                {metricas.total_itens_finais > 0
                  ? `${((metricas.total_disponiveis / metricas.total_itens_finais) * 100).toFixed(1)}%`
                  : "0%"}
              </span>
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-sm border border-[#E0E0E0] shadow-xs">
            <span className="text-[10px] font-semibold text-[#C62828] uppercase tracking-wider block flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">warning</span>
              Com Componentes Faltando
            </span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="text-xl font-bold text-[#C62828]">
                {metricas.total_com_falta.toLocaleString("pt-BR")}
              </span>
              <span className="text-[11px] text-[#C62828] font-medium">
                {metricas.total_itens_finais > 0
                  ? `${((metricas.total_com_falta / metricas.total_itens_finais) * 100).toFixed(1)}%`
                  : "0%"}
              </span>
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-sm border border-[#E0E0E0] shadow-xs">
            <span className="text-[10px] font-semibold text-[#8B5A2B] uppercase tracking-wider block">
              Total de Pedidos
            </span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="text-xl font-bold text-[#8B5A2B]">
                {metricas.total_pedidos.toLocaleString("pt-BR")}
              </span>
              <span className="text-[11px] text-[#757575]">pedidos em carteira</span>
            </div>
          </div>
        </section>

        {/* BARRA DE FILTROS SUPERIOR (COMPACTA) */}
        <section className="shrink-0 bg-white px-4 py-2 rounded-sm border border-[#E0E0E0] shadow-xs space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Filtro: Local de Produção */}
            <div className="flex flex-col min-w-[170px]">
              <label className="text-[10px] font-medium text-[#666666] mb-0.5">
                Local de Produção
              </label>
              <select
                value={filtroLocal}
                onChange={(e) => setFiltroLocal(e.target.value)}
                className="px-2.5 py-1 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#222222]"
              >
                <option value="">Todos os Locais</option>
                {locaisProducao.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>

            {/* Filtro: Pedido */}
            <div className="flex flex-col min-w-[120px]">
              <label className="text-[10px] font-medium text-[#666666] mb-0.5">
                Número do Pedido
              </label>
              <input
                type="text"
                placeholder="Ex: 206473"
                value={filtroPedido}
                onChange={(e) => setFiltroPedido(e.target.value)}
                className="px-2.5 py-1 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#222222]"
              />
            </div>

            {/* Filtro: Código / Descrição */}
            <div className="flex flex-col flex-1 min-w-[180px]">
              <label className="text-[10px] font-medium text-[#666666] mb-0.5">
                Código ou Descrição
              </label>
              <input
                type="text"
                placeholder="Ex: 1APAE180 ou APARADOR"
                value={filtroCodigo}
                onChange={(e) => setFiltroCodigo(e.target.value)}
                className="px-2.5 py-1 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#222222]"
              />
            </div>

            {/* Filtro: Janela de Data Abertura da Ordem */}
            <div className="flex flex-col">
              <label className="text-[10px] font-medium text-[#666666] mb-0.5">
                Abertura OP (De / Até)
              </label>
              <div className="flex items-center gap-1 bg-white border border-[#D5D5D5] rounded-sm px-1.5 py-0.5">
                <input
                  type="date"
                  value={filtroDataInicio}
                  onChange={(e) => setFiltroDataInicio(e.target.value)}
                  className="text-xs bg-transparent focus:outline-none text-[#1A1A1A] cursor-pointer"
                  title="Data Início (em branco = considera todas até a data fim)"
                />
                <span className="text-[10px] text-[#757575] font-medium">até</span>
                <input
                  type="date"
                  value={filtroDataFim}
                  onChange={(e) => setFiltroDataFim(e.target.value)}
                  className="text-xs bg-transparent focus:outline-none text-[#1A1A1A] cursor-pointer"
                  title="Data Fim (em branco = considera todas a partir da data início)"
                />
              </div>
            </div>

            {/* BOTÕES: FILTRAR COMPONENTES POR BAIXA (S / N) */}
            <div className="flex flex-col">
              <label className="text-[10px] font-medium text-[#666666] mb-0.5">
                Baixa (Componente)
              </label>
              <div className="flex rounded-sm border border-[#D5D5D5] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setFiltroBaixa("todos")}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    filtroBaixa === "todos"
                      ? "bg-[#222222] text-white"
                      : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                  }`}
                  title="Todos os componentes"
                >
                  Todas
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroBaixa("S")}
                  className={`px-2 py-1 text-xs font-medium transition-colors border-l border-[#D5D5D5] ${
                    filtroBaixa === "S"
                      ? "bg-[#2E7D32] text-white"
                      : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                  }`}
                  title="Apenas componentes com Baixa = S (Sofre baixa)"
                >
                  Baixa Sim (S)
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroBaixa("N")}
                  className={`px-2 py-1 text-xs font-medium transition-colors border-l border-[#D5D5D5] ${
                    filtroBaixa === "N"
                      ? "bg-[#8B5A2B] text-white"
                      : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                  }`}
                  title="Apenas componentes com Baixa = N (Não sofre baixa)"
                >
                  Baixa Não (N)
                </button>
              </div>
            </div>

            {/* BOTÕES: FILTRAR COMPONENTES POR TIPO (COMPRADO / PRODUZIDO) */}
            <div className="flex flex-col">
              <label className="text-[10px] font-medium text-[#666666] mb-0.5">
                Origem do Componente
              </label>
              <div className="flex rounded-sm border border-[#D5D5D5] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setFiltroTipo("todos")}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    filtroTipo === "todos"
                      ? "bg-[#222222] text-white"
                      : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                  }`}
                  title="Todos os tipos de componentes"
                >
                  Todas
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroTipo("C")}
                  className={`px-2 py-1 text-xs font-medium transition-colors border-l border-[#D5D5D5] ${
                    filtroTipo === "C"
                      ? "bg-[#8B5A2B] text-white"
                      : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                  }`}
                  title="Apenas insumos e matérias-primas compradas (Tipo C)"
                >
                  Comprado (C)
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroTipo("P")}
                  className={`px-2 py-1 text-xs font-medium transition-colors border-l border-[#D5D5D5] ${
                    filtroTipo === "P"
                      ? "bg-[#1565C0] text-white"
                      : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                  }`}
                  title="Apenas peças e subconjuntos produzidos internamente (Tipo P)"
                >
                  Produzido (P)
                </button>
              </div>
            </div>

            {/* Filtro: Status de Disponibilidade */}
            <div className="flex flex-col">
              <label className="text-[10px] font-medium text-[#666666] mb-0.5">
                Status
              </label>
              <div className="flex rounded-sm border border-[#D5D5D5] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setFiltroStatus("todos")}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    filtroStatus === "todos"
                      ? "bg-[#222222] text-white"
                      : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                  }`}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroStatus("disponivel")}
                  className={`px-2 py-1 text-xs font-medium transition-colors border-l border-[#D5D5D5] ${
                    filtroStatus === "disponivel"
                      ? "bg-[#2E7D32] text-white"
                      : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                  }`}
                >
                  Disponíveis
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroStatus("falta")}
                  className={`px-2 py-1 text-xs font-medium transition-colors border-l border-[#D5D5D5] ${
                    filtroStatus === "falta"
                      ? "bg-[#C62828] text-white"
                      : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                  }`}
                >
                  Com Falta
                </button>
              </div>
            </div>

            {/* Limpar Filtros */}
            {temFiltrosAtivos && (
              <div className="flex flex-col self-end">
                <button
                  type="button"
                  onClick={limparFiltros}
                  className="px-2.5 py-1 text-xs text-[#757575] hover:text-[#C62828] font-medium flex items-center gap-1 transition-colors"
                  title="Limpar todos os filtros ativos"
                >
                  <span className="material-symbols-outlined text-[15px]">close</span>
                  <span>Limpar</span>
                </button>
              </div>
            )}
          </div>

          {/* CHIPS DE FILTROS ATIVOS (COLUNAS E DATAS) */}
          {(Object.keys(colFiltros).length > 0 || filtroDataInicio || filtroDataFim) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#EEEEEE]">
              <span className="text-[10px] text-[#757575] font-semibold uppercase tracking-wider">
                Filtros Ativos:
              </span>
              {(filtroDataInicio || filtroDataFim) && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#F2F2F2] text-[#1A1A1A] border border-[#D5D5D5]">
                  <strong>Abertura OP:</strong> {filtroDataInicio || "Início"} até {filtroDataFim || "Fim"}
                  <button
                    type="button"
                    onClick={() => {
                      setFiltroDataInicio("");
                      setFiltroDataFim("");
                    }}
                    className="hover:text-[#C62828] ml-0.5 font-bold"
                    title="Remover filtro de data"
                  >
                    ×
                  </button>
                </span>
              )}
              {Object.entries(colFiltros).map(([k, val]) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#F2F2F2] text-[#1A1A1A] border border-[#D5D5D5]"
                >
                  <strong className="capitalize">{k}:</strong> {val}
                  <button
                    type="button"
                    onClick={() => limparFiltroColuna(k)}
                    className="hover:text-[#C62828] ml-0.5 font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* TABELA RESPONSIVA COM ALTURA FLEXÍVEL (FLEX-1 MIN-H-0 OVERFLOW-AUTO) */}
        <section className="flex-1 flex flex-col min-h-0 bg-white rounded-sm border border-[#E0E0E0] shadow-xs overflow-hidden">
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
              <thead className="sticky top-0 z-20 bg-[#FAFAFA] text-[#424242] border-b border-[#E0E0E0] shadow-xs">
                <tr>
                  {renderColumnHeader("item_final", "Código (Item Final)", "pl-4 min-w-[140px]")}
                  {renderColumnHeader("descricao", "Descrição do Produto", "min-w-[260px]")}
                  {renderColumnHeader("pedido", "Pedido", "min-w-[90px]", "center")}
                  {renderColumnHeader("fabrica", "Local Produção", "min-w-[130px]")}
                  {renderColumnHeader("data_abertura", "Abertura OP ▾", "min-w-[110px] bg-[#F2F2F2]/60", "center")}
                  {renderColumnHeader("saldo", "Saldo Pedido", "min-w-[90px]", "right")}
                  {renderColumnHeader("entrega", "Entrega", "min-w-[95px]", "center")}
                  <th scope="col" className="p-2.5 text-center min-w-[130px] font-semibold text-[#424242]">
                    Disponibilidade
                  </th>
                  {renderColumnHeader("status", "Status", "min-w-[110px]", "center")}
                  <th scope="col" className="p-2.5 pr-4 text-center min-w-[100px] font-semibold text-[#424242]">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEEEEE]">
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
                      Nenhum item final encontrado para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  (() => {
                    const sentinelIndex =
                      hasMore && itens.length > 0 ? Math.max(0, itens.length - 30) : -1;
                    return itens.map((it, idx) => {
                      const isDisponivel = it.status === "Disponível";
                      return (
                        <tr
                          key={`${it.item_final}_${it.pedido}_${idx}`}
                          ref={idx === sentinelIndex ? sentinelRef : null}
                          className="hover:bg-[#F9F9F9] transition-colors"
                        >
                          <th scope="row" className="p-2.5 pl-4 font-mono font-bold text-[#1A1A1A]">
                            {it.item_final}
                          </th>
                          <td className="p-2.5 max-w-[280px] truncate" title={it.descricao}>
                            {it.descricao || "-"}
                          </td>
                          <td className="p-2.5 text-center font-mono font-medium">
                            {it.pedido || "-"}
                          </td>
                          <td className="p-2.5 text-[#424242] font-medium">
                            {it.fabrica}
                          </td>
                          <td className="p-2.5 text-center font-mono font-semibold text-[#1A1A1A] bg-[#FAFAFA]/50">
                            {it.data_abertura || "-"}
                          </td>
                          <td className="p-2.5 text-right font-mono font-semibold">
                            {it.saldo}
                          </td>
                          <td className="p-2.5 text-center text-[#666666] font-mono">
                            {it.entrega || "-"}
                          </td>
                          <td className="p-2.5">
                            <div className="flex flex-col gap-1 items-center">
                              <div className="flex justify-between w-full text-[10px] text-[#666666]">
                                <span>{it.componentes_disponiveis}/{it.total_componentes} disp.</span>
                                <span className="font-semibold">{it.perc_disponivel}%</span>
                              </div>
                              <div className="w-full bg-[#E0E0E0] h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-300 ${
                                    isDisponivel
                                      ? "bg-[#2E7D32]"
                                      : it.perc_disponivel > 70
                                      ? "bg-[#F57C00]"
                                      : "bg-[#C62828]"
                                  }`}
                                  style={{ width: `${Math.min(100, it.perc_disponivel)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="p-2.5 text-center">
                            {isDisponivel ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#E8F5E9] text-[#2E7D32]">
                                <span className="material-symbols-outlined text-[12px]">check</span>
                                Disponível
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FFEBEE] text-[#C62828]">
                                <span className="material-symbols-outlined text-[12px]">warning</span>
                                Faltam {it.componentes_faltando}
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 pr-4 text-center">
                            <button
                              type="button"
                              onClick={() => abrirDetalhes(it)}
                              className="px-2 py-1 text-xs font-medium rounded-sm border border-[#D5D5D5] bg-white text-[#1A1A1A] hover:bg-[#F2F2F2] transition-colors inline-flex items-center gap-1 shadow-xs"
                            >
                              <span className="material-symbols-outlined text-[14px]">visibility</span>
                              <span>Ver Insumos</span>
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()
                )}

                {/* INDICADOR DE STATUS / LOADING AO FINAL DA TABELA */}
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
                        <span className="text-[#9E9E9E] text-[11px]">Role a tabela para carregar mais registros</span>
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

          {/* RODAPÉ INFORMATIVO DE ROLAGEM INFINITA (FIXO NO FINAL DA TABELA) */}
          <div className="shrink-0 px-4 py-2 border-t border-[#E0E0E0] flex items-center justify-between text-xs text-[#666666] bg-white">
            <span className="font-medium">
              Exibindo <strong className="text-[#1A1A1A]">{itens.length}</strong> de{" "}
              <strong className="text-[#1A1A1A]">{totalRegistros.toLocaleString("pt-BR")}</strong> itens finais
            </span>

            <span className="text-[11px] text-[#757575]">
              {hasMore ? "Role internamente para buscar mais linhas" : "Fim dos registros"}
            </span>
          </div>
        </section>
      </main>

      {/* MODAL / GAVETA DE DETALHES DO ITEM FINAL COM FILTRO DE BAIXA E TIPO */}
      {itemSelecionado && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-5xl rounded-sm shadow-2xl flex flex-col max-h-[92vh] border border-[#E0E0E0] animate-fade-in">
            {/* Header do Modal */}
            <div className="p-5 border-b border-[#E0E0E0] flex items-start justify-between bg-[#FAFAFA]">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-bold text-[#1A1A1A]">
                    {itemSelecionado.item_final}
                  </span>
                  {itemSelecionado.status === "Disponível" ? (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#E8F5E9] text-[#2E7D32]">
                      100% Disponível
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFEBEE] text-[#C62828]">
                      {itemSelecionado.componentes_faltando} insumo(s) em falta
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#666666]">
                  {itemSelecionado.descricao || "Sem descrição comercial"}
                </p>
                <div className="flex flex-wrap gap-4 text-[11px] text-[#757575] pt-1">
                  <span>Pedido: <strong className="text-[#1A1A1A] font-mono">{itemSelecionado.pedido || "-"}</strong></span>
                  <span>Fábrica: <strong className="text-[#1A1A1A]">{itemSelecionado.fabrica}</strong></span>
                  <span>Abertura OP: <strong className="text-[#1A1A1A] font-mono">{itemSelecionado.data_abertura || "-"}</strong></span>
                  <span>Saldo: <strong className="text-[#1A1A1A]">{itemSelecionado.saldo}</strong></span>
                  <span>Entrega: <strong className="text-[#1A1A1A] font-mono">{itemSelecionado.entrega || "-"}</strong></span>
                </div>
              </div>

              <button
                type="button"
                onClick={fecharDetalhes}
                className="text-[#757575] hover:text-[#1A1A1A] p-1.5 rounded-sm hover:bg-[#F2F2F2] transition-colors"
                title="Fechar"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* BARRA DE CONTROLES E FILTROS INTERNOS DO MODAL */}
            <div className="px-5 py-2.5 border-b border-[#E0E0E0] flex flex-wrap items-center justify-between gap-3 bg-white">
              {/* Abas: Faltando vs Disponíveis */}
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setAbaDetalhe("faltando")}
                  className={`py-1.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
                    abaDetalhe === "faltando"
                      ? "border-[#C62828] text-[#C62828]"
                      : "border-transparent text-[#757575] hover:text-[#1A1A1A]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  <span>Faltando ({detalhesItem?.total_faltando || 0})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAbaDetalhe("disponiveis")}
                  className={`py-1.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
                    abaDetalhe === "disponiveis"
                      ? "border-[#2E7D32] text-[#2E7D32]"
                      : "border-transparent text-[#757575] hover:text-[#1A1A1A]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>Disponíveis ({detalhesItem?.total_disponiveis || 0})</span>
                </button>
              </div>

              {/* FILTROS INTERNOS DO MODAL (BAIXA E TIPO) */}
              <div className="flex items-center gap-3">
                {/* Filtro Baixa no Modal */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#666666]">Baixa:</span>
                  <div className="flex rounded-sm border border-[#D5D5D5] overflow-hidden text-[10px]">
                    <button
                      type="button"
                      onClick={() => {
                        setModalBaixa("todos");
                        carregarDetalhes(itemSelecionado, "todos", modalTipo);
                      }}
                      className={`px-2 py-0.5 font-medium ${
                        modalBaixa === "todos"
                          ? "bg-[#222222] text-white"
                          : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
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
                      className={`px-2 py-0.5 font-medium border-l border-[#D5D5D5] ${
                        modalBaixa === "S"
                          ? "bg-[#2E7D32] text-white"
                          : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
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
                      className={`px-2 py-0.5 font-medium border-l border-[#D5D5D5] ${
                        modalBaixa === "N"
                          ? "bg-[#8B5A2B] text-white"
                          : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                      }`}
                    >
                      N
                    </button>
                  </div>
                </div>

                {/* Filtro Tipo no Modal */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#666666]">Origem:</span>
                  <div className="flex rounded-sm border border-[#D5D5D5] overflow-hidden text-[10px]">
                    <button
                      type="button"
                      onClick={() => {
                        setModalTipo("todos");
                        carregarDetalhes(itemSelecionado, modalBaixa, "todos");
                      }}
                      className={`px-2 py-0.5 font-medium ${
                        modalTipo === "todos"
                          ? "bg-[#222222] text-white"
                          : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
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
                      className={`px-2 py-0.5 font-medium border-l border-[#D5D5D5] ${
                        modalTipo === "C"
                          ? "bg-[#8B5A2B] text-white"
                          : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                      }`}
                    >
                      Comprado (C)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setModalTipo("P");
                        carregarDetalhes(itemSelecionado, modalBaixa, "P");
                      }}
                      className={`px-2 py-0.5 font-medium border-l border-[#D5D5D5] ${
                        modalTipo === "P"
                          ? "bg-[#1565C0] text-white"
                          : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                      }`}
                    >
                      Produzido (P)
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Conteúdo da Tabela do Modal */}
            <div className="p-5 overflow-y-auto flex-1">
              {carregandoDetalhes ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-[#757575]">
                  <span className="material-symbols-outlined text-3xl animate-spin text-[#1A1A1A]">
                    progress_activity
                  </span>
                  <span className="text-xs">Carregando insumos da árvore BFS...</span>
                </div>
              ) : !detalhesItem ? (
                <div className="py-8 text-center text-xs text-[#757575]">
                  Dados não disponíveis.
                </div>
              ) : abaDetalhe === "faltando" ? (
                detalhesItem.faltando.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#2E7D32] flex flex-col items-center gap-2">
                    <span className="material-symbols-outlined text-4xl">check_circle</span>
                    <strong className="text-sm">Nenhum componente ou matéria-prima em falta!</strong>
                    <span>Todos os insumos necessários possuem estoque suficiente em Situação L.</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-[#E0E0E0] rounded-sm">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#FFEBEE]/60 text-[#C62828] font-semibold border-b border-[#E0E0E0]">
                        <tr>
                          <th className="p-2.5">Tipo</th>
                          <th className="p-2.5 text-center">Baixa</th>
                          <th className="p-2.5">Item</th>
                          <th className="p-2.5">Descrição</th>
                          <th className="p-2.5 text-right">Consumo Necessário</th>
                          <th className="p-2.5 text-right">Estoque (Situação L)</th>
                          <th className="p-2.5 text-right font-bold">Falta Líquida</th>
                          <th className="p-2.5">Local Prod / OP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EEEEEE]">
                        {detalhesItem.faltando.map((comp, cIdx) => (
                          <tr key={cIdx} className="hover:bg-[#FFF5F5]">
                            <td className="p-2.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  comp.tipo === "C"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-blue-100 text-blue-800"
                                }`}
                              >
                                {comp.tipo === "C" ? "Matéria Prima (C)" : "Componente (P)"}
                              </span>
                            </td>
                            <td className="p-2.5 text-center">
                              <span
                                className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                                  comp.baixa === "S"
                                    ? "bg-[#E8F5E9] text-[#2E7D32]"
                                    : "bg-[#F2F2F2] text-[#757575]"
                                }`}
                              >
                                {comp.baixa || "-"}
                              </span>
                            </td>
                            <td className="p-2.5 font-mono font-bold text-[#1A1A1A]">{comp.item}</td>
                            <td className="p-2.5 text-[#424242] max-w-[280px] truncate" title={comp.descricao}>
                              {comp.descricao || "-"}
                            </td>
                            <td className="p-2.5 text-right font-mono font-medium">{comp.consumo}</td>
                            <td className="p-2.5 text-right font-mono text-[#757575]">{comp.estoque_l}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-[#C62828]">
                              {comp.falta}
                            </td>
                            <td className="p-2.5 text-[11px] text-[#666666]">
                              {comp.ordem_prod ? `OP: ${comp.ordem_prod}` : (comp.local_prod || "-")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                detalhesItem.disponiveis.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#757575]">
                    Nenhum componente registrado como disponível para os filtros selecionados.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-[#E0E0E0] rounded-sm">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#E8F5E9]/60 text-[#2E7D32] font-semibold border-b border-[#E0E0E0]">
                        <tr>
                          <th className="p-2.5">Tipo</th>
                          <th className="p-2.5 text-center">Baixa</th>
                          <th className="p-2.5">Item</th>
                          <th className="p-2.5">Descrição</th>
                          <th className="p-2.5 text-right">Consumo Necessário</th>
                          <th className="p-2.5 text-right font-bold">Estoque (Situação L)</th>
                          <th className="p-2.5">Local Prod / OP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EEEEEE]">
                        {detalhesItem.disponiveis.map((comp, cIdx) => (
                          <tr key={cIdx} className="hover:bg-[#F1F8F1]">
                            <td className="p-2.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  comp.tipo === "C"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-blue-100 text-blue-800"
                                }`}
                              >
                                {comp.tipo === "C" ? "Matéria Prima (C)" : "Componente (P)"}
                              </span>
                            </td>
                            <td className="p-2.5 text-center">
                              <span
                                className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                                  comp.baixa === "S"
                                    ? "bg-[#E8F5E9] text-[#2E7D32]"
                                    : "bg-[#F2F2F2] text-[#757575]"
                                }`}
                              >
                                {comp.baixa || "-"}
                              </span>
                            </td>
                            <td className="p-2.5 font-mono font-bold text-[#1A1A1A]">{comp.item}</td>
                            <td className="p-2.5 text-[#424242] max-w-[320px] truncate" title={comp.descricao}>
                              {comp.descricao || "-"}
                            </td>
                            <td className="p-2.5 text-right font-mono font-medium">{comp.consumo}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-[#2E7D32]">{comp.estoque_l}</td>
                            <td className="p-2.5 text-[11px] text-[#666666]">
                              {comp.ordem_prod ? `OP: ${comp.ordem_prod}` : (comp.local_prod || "-")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="p-4 border-t border-[#E0E0E0] flex justify-between items-center bg-[#FAFAFA]">
              <span className="text-[11px] text-[#757575]">
                {detalhesItem ? `Total de ${detalhesItem.total_componentes} insumos cadastrados na estrutura` : ""}
              </span>
              <button
                type="button"
                onClick={fecharDetalhes}
                className="px-4 py-1.5 rounded-sm bg-[#222222] text-white text-xs font-medium hover:bg-black transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
