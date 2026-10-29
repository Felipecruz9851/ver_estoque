import React, { useState, useEffect, useCallback, useRef, useId } from "react";
import { apiCall } from "./api";
import logoLider from "./logo_lider.png";

const SESSION_USER_KEY = "ver_estoque_intranet_user";
const SESSION_PASS_KEY = "ver_estoque_intranet_pass";

const criarLinhaPedidoVazia = () => ({
  id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  pedido: "",
  data_entrega: "",
});

export default function VerEstoque({ onVoltar, isStandalone = false }) {
  const tableId = useId();
  const simDialogTitleId = useId();
  const userFieldId = useId();
  const passFieldId = useId();

  const sentinelRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const simDialogRef = useRef(null);

  // Estados de dados
  const [itens, setItens] = useState([]);
  const [metricas, setMetricas] = useState({
    total_itens_finais: 0,
    total_disponiveis: 0,
    total_com_falta: 0,
    total_pedidos: 0,
    total_simulados: 0,
  });
  const [pedidosSimuladosAtivos, setPedidosSimuladosAtivos] = useState([]);
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
  const [filtroApenasSimulados, setFiltroApenasSimulados] = useState(false);

  // Filtros em Títulos de Colunas (Executados 100% no Backend)
  const [colFiltros, setColFiltros] = useState({});
  const [activeColMenu, setActiveColMenu] = useState(null);
  const [localColInput, setLocalColInput] = useState("");

  // Modal do Simulador de Pedidos (Intranet)
  const [intranetUsuario, setIntranetUsuario] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_USER_KEY) || "";
    } catch {
      return "";
    }
  });
  const [intranetSenha, setIntranetSenha] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_PASS_KEY) || "";
    } catch {
      return "";
    }
  });
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [linhasSimulador, setLinhasSimulador] = useState(() => [criarLinhaPedidoVazia()]);
  const [simulando, setSimulando] = useState(false);
  const [erroSimulador, setErroSimulador] = useState("");
  const [avisoSimulador, setAvisoSimulador] = useState("");

  // Modal de Detalhes de Insumos
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
          setLoadingMsg("Recalculando árvore BFS e fila cumulativa...");
        } else {
          setLoadingMsg("Calculando fila de estoque...");
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
            apenas_simulados: filtroApenasSimulados,
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
        if (Array.isArray(res.pedidos_simulados_ativos)) {
          setPedidosSimuladosAtivos(res.pedidos_simulados_ativos);
        }
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
      filtroApenasSimulados,
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
    filtroApenasSimulados,
    filtroDataInicio,
    filtroDataFim,
    colFiltros,
  ]);

  // Infinite Scroll via IntersectionObserver (posicionado 30 linhas antes do fim)
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

  // Listener de Scroll no container interno da tabela (salvaguarda de ~450px)
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

  // --- Ações do Modal Simulador de Pedidos ---
  const abrirModalSimulador = () => {
    setErroSimulador("");
    setAvisoSimulador("");
    if (linhasSimulador.length === 0) {
      setLinhasSimulador([criarLinhaPedidoVazia()]);
    }
    if (simDialogRef.current && !simDialogRef.current.open) {
      simDialogRef.current.showModal();
    }
  };

  const fecharModalSimulador = () => {
    if (simDialogRef.current && simDialogRef.current.open) {
      simDialogRef.current.close();
    }
  };

  const adicionarLinhaPedido = () => {
    setLinhasSimulador((prev) => [...prev, criarLinhaPedidoVazia()]);
  };

  const removerLinhaPedido = (id) => {
    setLinhasSimulador((prev) => {
      if (prev.length <= 1) {
        return [criarLinhaPedidoVazia()];
      }
      return prev.filter((l) => l.id !== id);
    });
  };

  const atualizarLinhaPedido = (id, campo, valor) => {
    setErroSimulador("");
    setLinhasSimulador((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [campo]: valor } : l))
    );
  };

  const handleConfirmarSimulacao = async (e) => {
    e.preventDefault();
    setErroSimulador("");
    setAvisoSimulador("");

    const pedidosValidos = linhasSimulador
      .map((l) => ({
        pedido: l.pedido.trim(),
        data_entrega: l.data_entrega.trim(),
      }))
      .filter((l) => Boolean(l.pedido));

    if (pedidosValidos.length === 0) {
      setErroSimulador("Informe ao menos um número de pedido válido.");
      return;
    }

    setSimulando(true);
    try {
      try {
        sessionStorage.setItem(SESSION_USER_KEY, intranetUsuario.trim());
        sessionStorage.setItem(SESSION_PASS_KEY, intranetSenha);
      } catch {
        // Ignora caso sessionStorage esteja indisponível no navegador
      }

      const res = await apiCall("simular_pedidos", {
        usuario: intranetUsuario.trim(),
        senha: intranetSenha,
        pedidos: pedidosValidos,
      });

      if (Array.isArray(res.pedidos_simulados_ativos)) {
        setPedidosSimuladosAtivos(res.pedidos_simulados_ativos);
      }

      setLinhasSimulador([criarLinhaPedidoVazia()]);
      await carregarDados(true, 0, false);

      if (res.pedidos_nao_encontrados && res.pedidos_nao_encontrados.length > 0) {
        setAvisoSimulador(
          `Simulação aplicada, porém o(s) pedido(s) ${res.pedidos_nao_encontrados.join(", ")} não retornaram estrutura na Intranet.`
        );
      } else {
        fecharModalSimulador();
      }
    } catch (err) {
      setErroSimulador(err.message || "Falha ao consultar pedidos na Intranet.");
    } finally {
      setSimulando(false);
    }
  };

  const handleRemoverPedidoSimulado = async (numPedido) => {
    try {
      setLoading(true);
      const res = await apiCall("remover_pedido_simulado", { pedido: numPedido });
      const ativos = res.pedidos_simulados_ativos || [];
      setPedidosSimuladosAtivos(ativos);
      if (ativos.length === 0 && filtroApenasSimulados) {
        setFiltroApenasSimulados(false);
      } else {
        await carregarDados(true, 0, false);
      }
    } catch (err) {
      alert("Erro ao remover pedido simulado: " + err.message);
      setLoading(false);
    }
  };

  const handleLimparSimulacao = async () => {
    try {
      setLoading(true);
      await apiCall("limpar_simulacao", {});
      setPedidosSimuladosAtivos([]);
      if (filtroApenasSimulados) {
        setFiltroApenasSimulados(false);
      } else {
        await carregarDados(true, 0, false);
      }
    } catch (err) {
      alert("Erro ao limpar simulação: " + err.message);
      setLoading(false);
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
          apenas_simulados: filtroApenasSimulados,
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
      const msg = String(e?.message || "");
      if (msg.toLowerCase().includes("não encontrado")) {
        setDetalhesItem({
          posicao_fila: it.posicao_fila,
          item_final: it.item_final,
          pedido: it.pedido,
          fabrica: it.fabrica,
          total_componentes: 0,
          total_faltando: 0,
          total_disponiveis: 0,
          faltando: [],
          disponiveis: [],
        });
      } else {
        alert("Erro ao obter detalhes do item: " + msg);
      }
    } finally {
      setCarregandoDetalhes(false);
    }
  };

  const abrirDetalhes = (it) => {
    const baixaInicial = filtroBaixa;
    const tipoInicial = filtroTipo;
    const abaInicial =
      filtroStatus === "disponivel"
        ? "disponiveis"
        : filtroStatus === "falta"
        ? "faltando"
        : it.componentes_faltando > 0
        ? "faltando"
        : "disponiveis";

    setItemSelecionado(it);
    setDetalhesItem(null);
    setAbaDetalhe(abaInicial);
    setModalBaixa(baixaInicial);
    setModalTipo(tipoInicial);
    carregarDetalhes(it, baixaInicial, tipoInicial);
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
    setFiltroApenasSimulados(false);
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
    filtroApenasSimulados ||
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
              Abatimento cumulativo na fila por data de abertura da OP • Estoque em Situação L
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {(dataCarga || dataCarregamento) && (
            <div
              className="hidden xl:flex items-center gap-2 px-2.5 py-1 bg-[#F9F9F9] border border-[#E0E0E0] rounded-sm text-left shadow-2xs"
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

          {/* BOTÃO CONSULTAR / SIMULAR PEDIDO ESPECÍFICO */}
          <button
            onClick={abrirModalSimulador}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-sm bg-[#4338CA] text-white text-xs font-medium hover:bg-[#3730A3] transition-colors flex items-center gap-1.5 shadow-sm"
            title="Consultar pedido específico na Intranet e simular posição na fila"
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">science</span>
            <span>Consultar / Simular Pedido</span>
            {pedidosSimuladosAtivos.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-white/20 text-[10px] font-bold">
                {pedidosSimuladosAtivos.length}
              </span>
            )}
          </button>

          {pedidosSimuladosAtivos.length > 0 && (
            <button
              onClick={handleLimparSimulacao}
              disabled={loading}
              className="px-2.5 py-1.5 rounded-sm border border-[#C62828]/40 bg-[#FFEBEE]/60 text-[#C62828] text-xs font-medium hover:bg-[#FFEBEE] transition-colors flex items-center gap-1"
              title="Limpar todos os pedidos simulados/destacados e restaurar tabela original"
              type="button"
            >
              <span className="material-symbols-outlined text-[15px]">restart_alt</span>
              <span>Limpar Simulação</span>
            </button>
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
              <span className="text-[11px] text-[#757575]">
                {metricas.total_simulados > 0
                  ? `${metricas.total_simulados} simulado(s)/destacado(s)`
                  : "ordens avaliadas"}
              </span>
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-sm border border-[#E0E0E0] shadow-xs">
            <span className="text-[10px] font-semibold text-[#2E7D32] uppercase tracking-wider block flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">check_circle</span>
              100% Disponíveis na Fila
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
              <span className="text-[11px] text-[#757575]">pedidos avaliados</span>
            </div>
          </div>
        </section>

        {/* BARRA DE FILTROS SUPERIOR (COMPACTA) */}
        <section className="shrink-0 bg-white px-4 py-2 rounded-sm border border-[#E0E0E0] shadow-xs space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Filtro: Local de Produção */}
            <div className="flex flex-col min-w-[160px]">
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
            <div className="flex flex-col min-w-[115px]">
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
            <div className="flex flex-col flex-1 min-w-[170px]">
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

            {/* BOTÃO: FILTRAR APENAS PEDIDOS SIMULADOS */}
            <div className="flex flex-col">
              <label className="text-[10px] font-medium text-[#666666] mb-0.5">
                Simulador
              </label>
              <button
                type="button"
                onClick={() => setFiltroApenasSimulados((prev) => !prev)}
                aria-pressed={filtroApenasSimulados}
                className={`px-2.5 py-1 text-xs font-semibold rounded-sm border transition-colors flex items-center gap-1.5 ${
                  filtroApenasSimulados
                    ? "bg-[#4338CA] text-white border-[#4338CA] shadow-2xs"
                    : "bg-white text-[#4338CA] border-[#4338CA]/40 hover:bg-[#EEF2FF]"
                }`}
                title="Exibir apenas as linhas com pedidos consultados/simulados (mantendo o cálculo real da fila)"
              >
                <span className="material-symbols-outlined text-[15px]">filter_alt</span>
                <span>Apenas Simulados</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    filtroApenasSimulados
                      ? "bg-white/20 text-white"
                      : "bg-[#EEF2FF] text-[#4338CA]"
                  }`}
                >
                  {metricas.total_simulados || 0}
                </span>
              </button>
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

          {/* FAIXA DE PEDIDOS SIMULADOS ATIVOS + CHIPS DE FILTROS */}
          {(pedidosSimuladosAtivos.length > 0 ||
            Object.keys(colFiltros).length > 0 ||
            filtroDataInicio ||
            filtroDataFim ||
            filtroApenasSimulados) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#EEEEEE]">
              {pedidosSimuladosAtivos.length > 0 && (
                <>
                  <span className="text-[10px] text-[#4338CA] font-bold uppercase tracking-wider flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">science</span>
                    Pedidos no Simulador:
                  </span>
                  {pedidosSimuladosAtivos.map((ps) => {
                    const isOrdCriada = ps.origem === "carteira";
                    return (
                      <span
                        key={ps.pedido}
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border ${
                          isOrdCriada
                            ? "bg-[#F8FAFC] text-[#334155] border-[#CBD5E1]"
                            : "bg-[#EEF2FF] text-[#312E81] border-[#C7D2FE]"
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
                            isOrdCriada ? "text-[#64748B]" : "text-[#4338CA]"
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
                          className="hover:text-[#C62828] font-bold leading-none"
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
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]">
                      <strong>Apenas Simulados</strong>
                      <button
                        type="button"
                        onClick={() => setFiltroApenasSimulados(false)}
                        className="hover:text-[#C62828] ml-0.5 font-bold"
                      >
                        ×
                      </button>
                    </span>
                  )}
                  {(filtroDataInicio || filtroDataFim) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#F2F2F2] text-[#1A1A1A] border border-[#D5D5D5]">
                      <strong>Abertura OP:</strong> {filtroDataInicio || "Início"} até{" "}
                      {filtroDataFim || "Fim"}
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
                </>
              )}
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
                  {renderColumnHeader("item_final", "Código (Item Final)", "pl-4 min-w-[165px]")}
                  {renderColumnHeader("descricao", "Descrição do Produto", "min-w-[250px]")}
                  {renderColumnHeader("pedido", "Pedido", "min-w-[95px]", "center")}
                  {renderColumnHeader("fabrica", "Local Produção", "min-w-[130px]")}
                  {renderColumnHeader("data_abertura", "Abertura OP ▾", "min-w-[115px] bg-[#F2F2F2]/60", "center")}
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
                      {filtroApenasSimulados
                        ? "Nenhum pedido simulado/destacado ativo no momento. Clique em 'Consultar / Simular Pedido' no topo para iniciar."
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
                              ? "bg-[#EEF2FF]/85 hover:bg-[#E0E7FF]"
                              : "hover:bg-[#F9F9F9]"
                          }`}
                        >
                          <th
                            scope="row"
                            style={
                              isSimuladoCarteira
                                ? { boxShadow: "inset 3px 0 0 #64748B" }
                                : isSimulado
                                ? { boxShadow: "inset 4px 0 0 #4338CA" }
                                : undefined
                            }
                            className="p-2.5 pl-4 font-mono font-bold text-[#1A1A1A]"
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{it.item_final}</span>
                              {isSimuladoCarteira ? (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.2 rounded-sm text-[9px] font-sans font-medium border border-[#CBD5E1] bg-white text-[#475569]"
                                  title="Pedido com ordem já criada (números originais mantidos e Data de Abertura atualizada)"
                                >
                                  Ordem criada
                                </span>
                              ) : (
                                isSimulado && (
                                  <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-sans font-bold uppercase tracking-wider bg-[#4338CA] text-white"
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
                          <td className="p-2.5 max-w-[280px] truncate" title={it.descricao}>
                            {it.descricao || "-"}
                          </td>
                          <td
                            className={`p-2.5 text-center font-mono ${
                              isSimuladoCarteira
                                ? "font-semibold text-[#334155]"
                                : isSimulado
                                ? "font-bold text-[#312E81]"
                                : "font-medium"
                            }`}
                          >
                            {it.pedido || "-"}
                          </td>
                          <td className="p-2.5 text-[#424242] font-medium">
                            {it.fabrica}
                          </td>
                          <td
                            className={`p-2.5 text-center font-mono font-semibold text-[#1A1A1A] ${
                              isSimuladoCarteira
                                ? "bg-[#F1F5F9]/60"
                                : isSimulado
                                ? "bg-[#E0E7FF]/40"
                                : "bg-[#FAFAFA]/50"
                            }`}
                          >
                            {it.data_abertura ? (
                              it.data_abertura
                            ) : isSimulado ? (
                              <span
                                className={`text-[10px] font-sans font-semibold ${
                                  isSimuladoCarteira ? "text-[#475569]" : "text-[#4338CA]"
                                }`}
                                title="Sem data de entrega informada — posicionado no final da lista"
                              >
                                Sem data (Fim)
                              </span>
                            ) : (
                              "-"
                            )}
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
                                <span>
                                  {it.componentes_disponiveis}/{it.total_componentes} disp.
                                </span>
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

          {/* RODAPÉ INFORMATIVO DE ROLAGEM INFINITA (FIXO NO FINAL DA TABELA) */}
          <div className="shrink-0 px-4 py-2 border-t border-[#E0E0E0] flex items-center justify-between text-xs text-[#666666] bg-white">
            <span className="font-medium">
              Exibindo <strong className="text-[#1A1A1A]">{itens.length}</strong> de{" "}
              <strong className="text-[#1A1A1A]">
                {totalRegistros.toLocaleString("pt-BR")}
              </strong>{" "}
              itens finais
            </span>

            <span className="text-[11px] text-[#757575]">
              {hasMore ? "Role internamente para buscar mais linhas" : "Fim dos registros"}
            </span>
          </div>
        </section>
      </main>

      {/* MODAL NATIVO <dialog> DO SIMULADOR DE PEDIDOS (INTRANET) */}
      <dialog
        ref={simDialogRef}
        aria-labelledby={simDialogTitleId}
        className="w-full max-w-2xl rounded-sm shadow-2xl border border-[#E0E0E0] p-0 bg-white text-[#1A1A1A] m-auto"
      >
        <form onSubmit={handleConfirmarSimulacao} className="flex flex-col max-h-[90vh]">
          {/* Cabeçalho do Modal */}
          <div className="px-5 py-4 border-b border-[#E0E0E0] flex items-start justify-between bg-[#FAFAFA]">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-[#4338CA]">
                  science
                </span>
                <h2 id={simDialogTitleId} className="text-sm font-bold text-[#1A1A1A]">
                  Consultar e Simular Pedidos Específicos
                </h2>
              </div>
              <p className="text-[11px] text-[#666666]">
                Consulta estrutura e saldo na Intranet (192.168.0.6), posiciona pela data de abertura e recalcula o estoque cumulativo.
              </p>
            </div>
            <button
              type="button"
              onClick={fecharModalSimulador}
              className="text-[#757575] hover:text-[#1A1A1A] p-1 rounded-sm hover:bg-[#EEEEEE]"
              aria-label="Fechar modal de simulação"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Corpo do Modal */}
          <div className="p-5 overflow-y-auto space-y-4">
            {erroSimulador && (
              <div
                role="alert"
                className="p-3 rounded-sm bg-[#FFEBEE] border border-[#EF9A9A] text-[#C62828] text-xs flex items-start gap-2"
              >
                <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">
                  error
                </span>
                <span>{erroSimulador}</span>
              </div>
            )}

            {avisoSimulador && (
              <div
                role="status"
                className="p-3 rounded-sm bg-[#FFF8E1] border border-[#FFE082] text-[#8D6E63] text-xs flex items-start gap-2"
              >
                <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">
                  info
                </span>
                <span>{avisoSimulador}</span>
              </div>
            )}

            {/* Credenciais da Intranet */}
            <fieldset className="border border-[#E0E0E0] rounded-sm p-3.5 bg-[#FAFAFA]/60">
              <legend className="px-1.5 text-[11px] font-bold uppercase tracking-wider text-[#424242]">
                Credenciais da Intranet
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <label
                    htmlFor={userFieldId}
                    className="text-[11px] font-semibold text-[#424242] mb-1"
                  >
                    Usuário da Intranet
                  </label>
                  <input
                    id={userFieldId}
                    name="username"
                    type="text"
                    autoFocus
                    autoComplete="username"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    value={intranetUsuario}
                    onChange={(e) => setIntranetUsuario(e.target.value)}
                    placeholder="Seu usuário (192.168.0.6)"
                    className="px-2.5 py-1.5 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#4338CA]"
                  />
                </div>

                <div className="flex flex-col">
                  <label
                    htmlFor={passFieldId}
                    className="text-[11px] font-semibold text-[#424242] mb-1"
                  >
                    Senha da Intranet
                  </label>
                  <div className="relative flex items-center">
                    <input
                      id={passFieldId}
                      name="password"
                      type={mostrarSenha ? "text" : "password"}
                      autoComplete="current-password"
                      value={intranetSenha}
                      onChange={(e) => setIntranetSenha(e.target.value)}
                      placeholder="Sua senha"
                      className="w-full px-2.5 py-1.5 pr-16 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#4338CA]"
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarSenha((prev) => !prev)}
                      className="absolute right-1.5 px-1.5 py-0.5 text-[10px] font-semibold text-[#666666] hover:text-[#1A1A1A] rounded hover:bg-[#F2F2F2]"
                    >
                      {mostrarSenha ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-[#757575] mt-2">
                Pedidos já em carteira mantêm seus números/saldos originais e têm a Data de Abertura atualizada pela Entrega Desejada. Pedidos novos têm saldo e estrutura importados da Intranet.
              </p>
            </fieldset>

            {/* Lista de Pedidos e Datas de Entrega */}
            <fieldset className="border border-[#E0E0E0] rounded-sm p-3.5 space-y-2.5">
              <legend className="px-1.5 text-[11px] font-bold uppercase tracking-wider text-[#424242]">
                Pedidos para Consultar / Simular
              </legend>

              <div className="space-y-2">
                {linhasSimulador.map((linha, index) => (
                  <div
                    key={linha.id}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_195px_36px] gap-2 items-end"
                  >
                    <div className="flex flex-col">
                      <label
                        htmlFor={`ped_${linha.id}`}
                        className="text-[11px] font-medium text-[#666666] mb-0.5"
                      >
                        Número do Pedido {linhasSimulador.length > 1 ? `#${index + 1}` : ""} *
                      </label>
                      <input
                        id={`ped_${linha.id}`}
                        name={`pedido_${index}`}
                        type="text"
                        inputMode="numeric"
                        spellCheck={false}
                        autoCorrect="off"
                        required={index === 0}
                        value={linha.pedido}
                        onChange={(e) =>
                          atualizarLinhaPedido(linha.id, "pedido", e.target.value)
                        }
                        placeholder="Ex: 188366 (ou 188366, 188367)"
                        className="px-2.5 py-1.5 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#4338CA] font-mono"
                      />
                    </div>

                    <div className="flex flex-col">
                      <label
                        htmlFor={`dt_${linha.id}`}
                        className="text-[11px] font-medium text-[#666666] mb-0.5"
                      >
                        Data de Entrega Desejada
                      </label>
                      <input
                        id={`dt_${linha.id}`}
                        name={`data_entrega_${index}`}
                        type="date"
                        value={linha.data_entrega}
                        onChange={(e) =>
                          atualizarLinhaPedido(linha.id, "data_entrega", e.target.value)
                        }
                        className="px-2.5 py-1.5 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#4338CA] cursor-pointer"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => removerLinhaPedido(linha.id)}
                      className="h-[30px] flex items-center justify-center rounded-sm border border-[#E0E0E0] text-[#757575] hover:text-[#C62828] hover:border-[#EF9A9A] hover:bg-[#FFEBEE]/50 transition-colors"
                      title="Remover linha"
                      aria-label={`Remover linha ${index + 1}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={adicionarLinhaPedido}
                  className="px-2.5 py-1 text-xs font-semibold text-[#4338CA] bg-[#EEF2FF] hover:bg-[#E0E7FF] border border-[#C7D2FE] rounded-sm flex items-center gap-1 transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">add</span>
                  <span>Adicionar outro pedido</span>
                </button>

                <span className="text-[10px] text-[#757575]">
                  Em branco = posiciona o pedido no <strong>final da lista</strong>.
                </span>
              </div>
            </fieldset>

            {/* Resumo de pedidos já ativos no simulador */}
            {pedidosSimuladosAtivos.length > 0 && (
              <div className="p-3 rounded-sm bg-[#EEF2FF]/60 border border-[#C7D2FE] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[#312E81]">
                    Pedidos já ativos nesta simulação ({pedidosSimuladosAtivos.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleLimparSimulacao}
                    className="text-[11px] font-semibold text-[#C62828] hover:underline"
                  >
                    Limpar todos
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pedidosSimuladosAtivos.map((ps) => (
                    <span
                      key={ps.pedido}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#C7D2FE] text-[11px] text-[#312E81]"
                    >
                      <strong className="font-mono">#{ps.pedido}</strong>
                      <span className="text-[10px] text-[#4338CA]">
                        {ps.origem === "carteira" ? "Ordem criada • " : ""}
                        {ps.data_entrega || "Fim da fila"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoverPedidoSimulado(ps.pedido)}
                        className="hover:text-[#C62828] font-bold ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Rodapé do Modal */}
          <div className="px-5 py-3.5 border-t border-[#E0E0E0] bg-[#FAFAFA] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={fecharModalSimulador}
              disabled={simulando}
              className="px-3.5 py-1.5 text-xs font-medium border border-[#D5D5D5] bg-white text-[#424242] rounded-sm hover:bg-[#F2F2F2] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={simulando}
              className="px-4 py-1.5 text-xs font-semibold bg-[#4338CA] text-white rounded-sm hover:bg-[#3730A3] transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-60"
            >
              <span
                className={`material-symbols-outlined text-[16px] ${
                  simulando ? "animate-spin" : ""
                }`}
              >
                {simulando ? "progress_activity" : "play_arrow"}
              </span>
              <span>
                {simulando ? "Consultando e Recalculando..." : "Confirmar e Recalcular Fila"}
              </span>
            </button>
          </div>
        </form>
      </dialog>

      {/* MODAL DE DETALHES DO ITEM FINAL COM FILTRO DE BAIXA E TIPO */}
      {itemSelecionado && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-5xl rounded-sm shadow-2xl flex flex-col max-h-[92vh] border border-[#E0E0E0] animate-fade-in">
            {/* Header do Modal */}
            <div className="p-5 border-b border-[#E0E0E0] flex items-start justify-between bg-[#FAFAFA]">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-base font-bold text-[#1A1A1A]">
                    {itemSelecionado.item_final}
                  </span>
                  {itemSelecionado.simulado && (
                    itemSelecionado.origem_simulacao === "carteira" ? (
                      <span className="px-2 py-0.5 rounded-sm text-[10px] font-medium border border-[#CBD5E1] bg-white text-[#475569]">
                        Ordem criada
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#4338CA] text-white flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">science</span>
                        Simulado (Intranet)
                      </span>
                    )
                  )}
                  {(detalhesItem
                    ? detalhesItem.total_faltando === 0
                    : itemSelecionado.status === "Disponível") ? (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#E8F5E9] text-[#2E7D32]">
                      100% Disponível na Fila
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFEBEE] text-[#C62828]">
                      {detalhesItem
                        ? detalhesItem.total_faltando
                        : itemSelecionado.componentes_faltando}{" "}
                      insumo(s) em falta
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#666666]">
                  {itemSelecionado.descricao || "Sem descrição comercial"}
                </p>
                <div className="flex flex-wrap gap-4 text-[11px] text-[#757575] pt-1">
                  {detalhesItem?.posicao_fila && (
                    <span>
                      Posição na Fila:{" "}
                      <strong className="text-[#4338CA] font-mono">
                        #{detalhesItem.posicao_fila}
                      </strong>
                    </span>
                  )}
                  <span>
                    Pedido:{" "}
                    <strong className="text-[#1A1A1A] font-mono">
                      {itemSelecionado.pedido || "-"}
                    </strong>
                  </span>
                  <span>
                    Fábrica:{" "}
                    <strong className="text-[#1A1A1A]">{itemSelecionado.fabrica}</strong>
                  </span>
                  <span>
                    Abertura OP:{" "}
                    <strong className="text-[#1A1A1A] font-mono">
                      {itemSelecionado.data_abertura || "Sem data (Fim da fila)"}
                    </strong>
                  </span>
                  <span>
                    Saldo: <strong className="text-[#1A1A1A]">{itemSelecionado.saldo}</strong>
                  </span>
                  <span>
                    Entrega:{" "}
                    <strong className="text-[#1A1A1A] font-mono">
                      {itemSelecionado.entrega || "-"}
                    </strong>
                  </span>
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
                  <span className="text-xs">Carregando insumos e saldo na fila...</span>
                </div>
              ) : !detalhesItem ? (
                <div className="py-8 text-center text-xs text-[#757575]">
                  Dados não disponíveis.
                </div>
              ) : abaDetalhe === "faltando" ? (
                detalhesItem.faltando.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#2E7D32] flex flex-col items-center gap-2">
                    <span className="material-symbols-outlined text-4xl">check_circle</span>
                    <strong className="text-sm">
                      Nenhum componente ou matéria-prima em falta nesta posição da fila!
                    </strong>
                    <span>
                      Todos os insumos necessários possuem saldo suficiente após o consumo das OPs anteriores.
                    </span>
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
                          <th className="p-2.5 text-right">Estoque Inicial (L)</th>
                          <th className="p-2.5 text-right">Saldo na Fila</th>
                          <th className="p-2.5 text-right">Consumo Necessário</th>
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
                            <td
                              className="p-2.5 text-[#424242] max-w-[240px] truncate"
                              title={comp.descricao}
                            >
                              {comp.descricao || "-"}
                            </td>
                            <td className="p-2.5 text-right font-mono text-[#757575]">
                              {comp.estoque_l}
                            </td>
                            <td className="p-2.5 text-right font-mono font-medium text-[#424242]">
                              {comp.saldo_fila}
                            </td>
                            <td className="p-2.5 text-right font-mono font-medium">
                              {comp.consumo}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-[#C62828]">
                              {comp.falta}
                            </td>
                            <td className="p-2.5 text-[11px] text-[#666666]">
                              {comp.ordem_prod ? `OP: ${comp.ordem_prod}` : comp.local_prod || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : detalhesItem.disponiveis.length === 0 ? (
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
                        <th className="p-2.5 text-right">Estoque Inicial (L)</th>
                        <th className="p-2.5 text-right font-bold">Saldo na Fila</th>
                        <th className="p-2.5 text-right">Consumo Necessário</th>
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
                          <td
                            className="p-2.5 text-[#424242] max-w-[280px] truncate"
                            title={comp.descricao}
                          >
                            {comp.descricao || "-"}
                          </td>
                          <td className="p-2.5 text-right font-mono text-[#757575]">
                            {comp.estoque_l}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-[#2E7D32]">
                            {comp.saldo_fila}
                          </td>
                          <td className="p-2.5 text-right font-mono font-medium">
                            {comp.consumo}
                          </td>
                          <td className="p-2.5 text-[11px] text-[#666666]">
                            {comp.ordem_prod ? `OP: ${comp.ordem_prod}` : comp.local_prod || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="p-4 border-t border-[#E0E0E0] flex justify-between items-center bg-[#FAFAFA]">
              <span className="text-[11px] text-[#757575]">
                {detalhesItem
                  ? `Total de ${detalhesItem.total_componentes} insumos cadastrados na estrutura`
                  : ""}
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
