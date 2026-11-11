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

const formatarQtd = (val) => {
  if (val === null || val === undefined || val === "") return "-";
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

const formatarPerc = (val) => {
  if (val === null || val === undefined || val === "") return "0%";
  const num = Number(val);
  if (isNaN(num)) return "0%";
  return `${num.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
};

export default function VerEstoque({ onVoltar, isStandalone = false }) {
  const tableId = useId();
  const simDialogTitleId = useId();
  const resumoDialogTitleId = useId();
  const matrizDialogTitleId = useId();
  const userFieldId = useId();
  const passFieldId = useId();

  const sentinelRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const simDialogRef = useRef(null);
  const resumoDialogRef = useRef(null);
  const matrizDialogRef = useRef(null);

  // Estados de dados
  const [itens, setItens] = useState([]);
  const [metricas, setMetricas] = useState({
    total_itens_finais: 0,
    total_itens_avaliados: 0,
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
  const [snapshotNome, setSnapshotNome] = useState("");
  const [sessionId, setSessionId] = useState("");

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
  const [filtroTipoData, setFiltroTipoData] = useState("abertura_op"); // 'abertura_op' | 'entrega_pedido'
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

  // Modal Gerencial de Resumo do Pedido ("O que falta para resolver o pedido ou o item")
  const [resumoPedidoInput, setResumoPedidoInput] = useState("");
  const [resumoDados, setResumoDados] = useState(null);
  const [carregandoResumo, setCarregandoResumo] = useState(false);
  const [erroResumo, setErroResumo] = useState("");
  const [abaResumo, setAbaResumo] = useState("faltando"); // 'faltando' | 'disponiveis'
  const [resumoBaixa, setResumoBaixa] = useState("todos"); // 'todos' | 'S' | 'N'
  const [resumoTipo, setResumoTipo] = useState("todos"); // 'todos' | 'C' | 'P'
  const [resumoItemEscopo, setResumoItemEscopo] = useState("TODOS"); // 'TODOS' | cod_item_final

  // Modal / Tela de Matriz Pivot de Componentes Produzidos Faltantes (Local Pai × Local Comp × Prazo Expedição)
  const [opcoesMatriz, setOpcoesMatriz] = useState({
    locais_item_final: [],
    locais_componente: [],
    prazos_disponiveis: [3, 8, 10],
    prazos_colunas: [

      { prazo: 10, key: "10", label: "R. Multimarcas e Nordeste" },
      { prazo: 8, key: "8", label: "Fora de MG" },
      { prazo: 3, key: "3", label: "MG e franquia" },
    ],
  });
  const [matrizLocaisPaiSel, setMatrizLocaisPaiSel] = useState([]);
  const [matrizLocaisCompSel, setMatrizLocaisCompSel] = useState([]);
  const [matrizBuscaLocalPai, setMatrizBuscaLocalPai] = useState("");
  const [matrizBuscaLocalComp, setMatrizBuscaLocalComp] = useState("");
  const [matrizBaixa, setMatrizBaixa] = useState("todos"); // 'todos' | 'S' | 'N'
  const [matrizEscopoAbatimento, setMatrizEscopoAbatimento] = useState("global"); // 'global' | 'filtrado'
  const [matrizDataInicio, setMatrizDataInicio] = useState("");
  const [matrizDataFim, setMatrizDataFim] = useState("");
  const [matrizBuscaItem, setMatrizBuscaItem] = useState("");
  const [matrizMenuAberto, setMatrizMenuAberto] = useState(true);
  const [matrizModoVisao, setMatrizModoVisao] = useState("agrupado"); // 'agrupado' | 'consolidado'
  const [matrizDados, setMatrizDados] = useState(null);
  const [carregandoMatriz, setCarregandoMatriz] = useState(false);
  const [exportandoMatriz, setExportandoMatriz] = useState(false);
  const [erroMatriz, setErroMatriz] = useState("");
  const [gruposExpandidos, setGruposExpandidos] = useState({});

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
          setLoadingMsg("Sincronizando snapshots de 366n, atualizando OCs e recalculando fila...");
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
            tipo_data: filtroTipoData,
          },
          page: paginaDestino,
          page_size: pageSize,
          recarregar: recarregarCache,
          forcar_oc: recarregarCache,
          sincronizar_snapshot: recarregarCache,
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
        if (res.snapshot) setSnapshotNome(res.snapshot);
        if (res.session_id) setSessionId(res.session_id);
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
      filtroTipoData,
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
    filtroTipoData,
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
          tipo_data: filtroTipoData,
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

  // --- Ações da Tela / Modal Gerencial de Resumo de Pedido ---
  const carregarResumoPedido = async (
    numPed,
    itEscopo = "TODOS",
    bFiltro = resumoBaixa,
    tFiltro = resumoTipo,
    fabFiltro = ""
  ) => {
    const pedLimpo = String(numPed || "").trim();
    const itemLimpo = String(itEscopo || "TODOS").trim();
    if (!pedLimpo && (!itemLimpo || itemLimpo === "TODOS")) {
      setErroResumo("Informe o número de um pedido para consultar o resumo gerencial.");
      return;
    }

    setCarregandoResumo(true);
    setErroResumo("");
    try {
      const res = await apiCall("obter_resumo_pedido", {
        pedido: pedLimpo,
        item_final: itemLimpo === "TODOS" ? "" : itemLimpo,
        fabrica: fabFiltro,
        baixa: bFiltro,
        tipo: tFiltro,
      });
      if (res && res.erro) throw new Error(res.erro);
      setResumoDados(res);
      if (res.pedido) {
        setResumoPedidoInput(res.pedido);
      }
      setResumoItemEscopo(res.escopo_item_final || "TODOS");
      if ((res.total_faltando || 0) === 0 && (res.total_disponiveis || 0) > 0) {
        setAbaResumo("disponiveis");
      } else {
        setAbaResumo("faltando");
      }
    } catch (e) {
      setErroResumo(e.message || "Não foi possível carregar o resumo do pedido.");
      setResumoDados(null);
    } finally {
      setCarregandoResumo(false);
    }
  };

  const abrirResumoPedido = (pedidoAlvo = "", itemEscopoInicial = "TODOS", fabricaAlvo = "") => {
    const pedEfetivo =
      String(pedidoAlvo || "").trim() ||
      String(filtroPedido || "").trim() ||
      (itens.find((x) => x.pedido)?.pedido || "");

    const bIni = filtroBaixa;
    const tIni = filtroTipo;
    setResumoBaixa(bIni);
    setResumoTipo(tIni);
    setResumoPedidoInput(pedEfetivo);
    setResumoItemEscopo(itemEscopoInicial || "TODOS");
    setErroResumo("");

    if (resumoDialogRef.current && !resumoDialogRef.current.open) {
      resumoDialogRef.current.showModal();
    }

    if (pedEfetivo || (itemEscopoInicial && itemEscopoInicial !== "TODOS")) {
      carregarResumoPedido(pedEfetivo, itemEscopoInicial || "TODOS", bIni, tIni, fabricaAlvo);
    } else {
      setResumoDados(null);
    }
  };

  const fecharResumoPedido = () => {
    if (resumoDialogRef.current && resumoDialogRef.current.open) {
      resumoDialogRef.current.close();
    }
  };

  // --- Ações da Tela / Modal de Matriz Pivot de Componentes Produzidos Faltantes ---
  const carregarMatrizFaltantes = async (overrideParams = {}) => {
    const locaisPai = overrideParams.locais_item_final ?? matrizLocaisPaiSel;
    const locaisComp = overrideParams.locais_componente ?? matrizLocaisCompSel;
    const bFiltro = overrideParams.baixa ?? matrizBaixa;
    const escopoAbat = overrideParams.escopo_abatimento ?? matrizEscopoAbatimento;
    const dtIni = overrideParams.data_inicio ?? matrizDataInicio;
    const dtFim = overrideParams.data_fim ?? matrizDataFim;
    const txtBusca = overrideParams.busca ?? matrizBuscaItem;

    setCarregandoMatriz(true);
    setErroMatriz("");
    try {
      const res = await apiCall("obter_matriz_faltantes_producao", {
        filtros: {
          locais_item_final: locaisPai,
          locais_componente: locaisComp,
          baixa: bFiltro,
          escopo_abatimento: escopoAbat,
          data_inicio: dtIni,
          data_fim: dtFim,
          busca: txtBusca,
        },
      });
      if (res && res.erro) throw new Error(res.erro);
      setMatrizDados(res);
      if (res.opcoes_filtros) {
        setOpcoesMatriz(res.opcoes_filtros);
      }
      setGruposExpandidos({});
    } catch (e) {
      setErroMatriz(e.message || "Não foi possível calcular a matriz de componentes faltantes.");
    } finally {
      setCarregandoMatriz(false);
    }
  };

  const abrirMatrizFaltantes = async () => {
    setErroMatriz("");
    setMatrizMenuAberto(true);

    if (matrizDialogRef.current && !matrizDialogRef.current.open) {
      matrizDialogRef.current.showModal();
    }

    try {
      const opRes = await apiCall("obter_opcoes_filtros_faltantes", {});
      if (opRes && !opRes.erro) {
        setOpcoesMatriz(opRes);
        const paiInicial =
          matrizLocaisPaiSel.length > 0
            ? matrizLocaisPaiSel
            : filtroLocal
            ? [filtroLocal]
            : opRes.locais_item_final || [];
        const compInicial =
          matrizLocaisCompSel.length > 0
            ? matrizLocaisCompSel
            : opRes.locais_componente || [];

        setMatrizLocaisPaiSel(paiInicial);
        setMatrizLocaisCompSel(compInicial);

        if (!matrizDados) {
          await carregarMatrizFaltantes({
            locais_item_final: paiInicial,
            locais_componente: compInicial,
            baixa: filtroBaixa,
            data_inicio: filtroDataInicio,
            data_fim: filtroDataFim,
          });
        }
      }
    } catch (e) {
      setErroMatriz(e.message || "Erro ao carregar opções de filtros.");
    }
  };

  const fecharMatrizFaltantes = () => {
    if (matrizDialogRef.current && matrizDialogRef.current.open) {
      matrizDialogRef.current.close();
    }
  };

  const toggleLocalPaiMatriz = (local) => {
    setMatrizLocaisPaiSel((prev) =>
      prev.includes(local) ? prev.filter((x) => x !== local) : [...prev, local]
    );
  };

  const toggleLocalCompMatriz = (local) => {
    setMatrizLocaisCompSel((prev) =>
      prev.includes(local) ? prev.filter((x) => x !== local) : [...prev, local]
    );
  };

  const handleExportarMatrizExcel = async () => {
    try {
      setExportandoMatriz(true);
      const res = await apiCall("exportar_matriz_faltantes_excel", {
        filtros: {
          locais_item_final: matrizLocaisPaiSel,
          locais_componente: matrizLocaisCompSel,
          baixa: matrizBaixa,
          escopo_abatimento: matrizEscopoAbatimento,
          data_inicio: matrizDataInicio,
          data_fim: matrizDataFim,
          busca: matrizBuscaItem,
        },
      });
      if (res && res.erro) throw new Error(res.erro);
      if (res.url) {
        const a = document.createElement("a");
        a.href = res.url;
        a.download = res.nome || "matriz_faltantes_producao.xlsx";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {
      alert("Erro ao exportar Matriz Excel: " + e.message);
    } finally {
      setExportandoMatriz(false);
    }
  };

  // Exporta uma tabela da Matriz Pivot como imagem PNG de alta definição (por fábrica do componente)
  const exportarTabelaMatrizComoImagem = ({
    tituloPrincipal,
    subtitulo,
    itens,
    prazosCols,
    nomeArquivoBase = "tabela_faltantes",
  }) => {
    try {
      if (!itens || itens.length === 0) {
        alert("Não há linhas nesta tabela para gerar a imagem.");
        return;
      }

      const truncar = (str, maxLen) => {
        const s = String(str ?? "-").trim() || "-";
        return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
      };

      const colsPrazoEfetivas =
        prazosCols && prazosCols.length > 0
          ? prazosCols
          : [
              { prazo: 10, key: "10", label: "R. Multimarcas e Nordeste" },
              { prazo: 3, key: "3", label: "MG e franquia" },
              { prazo: 8, key: "8", label: "Fora de MG" },
            ];

      const colunas = [
        { key: "item", label: "Componente", width: 150, align: "left", mono: true, bold: true },
        { key: "descricao", label: "Descrição", width: 320, align: "left" },
        ...colsPrazoEfetivas.map((colP) => ({
          key: `prazo_${colP.key}`,
          prazoKey: colP.key,
          label: colP.label,
          width: 150,
          align: "right",
          mono: true,
          isPrazo: true,
        })),
        {
          key: "falta_total",
          label: "Total Faltante",
          width: 145,
          align: "right",
          mono: true,
          isTotal: true,
        },
      ];

      const padX = 24;
      const padY = 20;
      const headerBannerH = 66;
      const tableHeaderH = 38;
      const rowH = 30;
      const footerH = 38;

      const tableW = colunas.reduce((acc, c) => acc + c.width, 0);
      const totalW = tableW + padX * 2;
      const totalH =
        padY * 2 + headerBannerH + tableHeaderH + itens.length * rowH + footerH;

      const scale = 2; // 2x Retina para máxima nitidez
      const canvas = document.createElement("canvas");
      canvas.width = totalW * scale;
      canvas.height = totalH * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);

      // Fundo geral branco
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, totalW, totalH);

      // Banner superior institucional
      ctx.fillStyle = "#0D47A1";
      ctx.fillRect(padX, padY, tableW, headerBannerH);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 16px Inter, Segoe UI, Arial, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(tituloPrincipal || "Faltantes Produzidos por Fábrica", padX + 16, padY + 24);

      ctx.fillStyle = "#E3F2FD";
      ctx.font = "12px Inter, Segoe UI, Arial, sans-serif";
      const dataGeracao = new Date().toLocaleString("pt-BR");
      const subTexto = `${subtitulo || ""} • ${itens.length} componente(s) • Gerado em ${dataGeracao}`;
      ctx.fillText(subTexto, padX + 16, padY + 47);

      // Cabeçalho da tabela
      const yHead = padY + headerBannerH;
      let curX = padX;
      colunas.forEach((col) => {
        if (col.isPrazo) {
          ctx.fillStyle = "#E3F2FD";
        } else if (col.isTotal) {
          ctx.fillStyle = "#FFEBEE";
        } else {
          ctx.fillStyle = "#F5F5F5";
        }
        ctx.fillRect(curX, yHead, col.width, tableHeaderH);

        ctx.strokeStyle = "#D5D5D5";
        ctx.lineWidth = 1;
        ctx.strokeRect(curX, yHead, col.width, tableHeaderH);

        ctx.fillStyle = col.isPrazo ? "#0D47A1" : col.isTotal ? "#C62828" : "#222222";
        ctx.font = "bold 11px Inter, Segoe UI, Arial, sans-serif";
        ctx.textAlign = col.align === "right" ? "right" : col.align === "center" ? "center" : "left";
        const textX =
          col.align === "right"
            ? curX + col.width - 10
            : col.align === "center"
            ? curX + col.width / 2
            : curX + 10;
        ctx.fillText(truncar(col.label, 24), textX, yHead + tableHeaderH / 2);
        curX += col.width;
      });

      // Linhas de dados e cálculo de subtotais
      const subtotaisPrazo = {};
      colsPrazoEfetivas.forEach((colP) => {
        subtotaisPrazo[colP.key] = 0;
      });
      let subtotalFaltaGeral = 0;

      // Pré-cálculo dos subtotais para exibição na linha de topo
      itens.forEach((row) => {
        subtotalFaltaGeral += Number(row.falta_total || 0);
        colsPrazoEfetivas.forEach((colP) => {
          subtotaisPrazo[colP.key] =
            (subtotaisPrazo[colP.key] || 0) + Number(row.falta_por_prazo?.[colP.key] || 0);
        });
      });

      // Linha de SUBTOTAL POR PRAZO DE ENTREGA no topo (logo após o cabeçalho)
      const ySubtotal = yHead + tableHeaderH;
      let xFoot = padX;
      const idxFimAntesPrazos = 2; // Componente + Descrição
      const larguraBlocoLabel = colunas
        .slice(0, idxFimAntesPrazos)
        .reduce((acc, c) => acc + c.width, 0);

      // Célula mesclada do rótulo "SUBTOTAL POR PRAZO DE ENTREGA"
      ctx.fillStyle = "#ECEFF1";
      ctx.fillRect(xFoot, ySubtotal, larguraBlocoLabel, footerH);
      ctx.strokeStyle = "#B0BEC5";
      ctx.lineWidth = 1;
      ctx.strokeRect(xFoot, ySubtotal, larguraBlocoLabel, footerH);

      ctx.fillStyle = "#1A1A1A";
      ctx.font = "bold 11px Inter, Segoe UI, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(
        `SUBTOTAL POR PRAZO DE ENTREGA (${itens.length} itens):`,
        xFoot + larguraBlocoLabel - 12,
        ySubtotal + footerH / 2
      );
      xFoot += larguraBlocoLabel;

      // Células de subtotal para cada prazo e total geral
      colunas.slice(idxFimAntesPrazos).forEach((col) => {
        let cellBg = "#ECEFF1";
        let txtColor = "#1A1A1A";
        let textoSub = "";

        if (col.isPrazo) {
          const somaP = subtotaisPrazo[col.prazoKey] || 0;
          cellBg = "#E3F2FD";
          txtColor = "#0D47A1";
          textoSub = formatarQtd(somaP);
        } else if (col.isTotal) {
          cellBg = "#FFCDD2";
          txtColor = "#B71C1C";
          textoSub = formatarQtd(subtotalFaltaGeral);
        }

        ctx.fillStyle = cellBg;
        ctx.fillRect(xFoot, ySubtotal, col.width, footerH);
        ctx.strokeStyle = "#B0BEC5";
        ctx.lineWidth = 1;
        ctx.strokeRect(xFoot, ySubtotal, col.width, footerH);

        if (textoSub) {
          ctx.fillStyle = txtColor;
          ctx.font = "bold 12px JetBrains Mono, Consolas, monospace";
          ctx.textAlign = "right";
          ctx.fillText(textoSub, xFoot + col.width - 10, ySubtotal + footerH / 2);
        }
        xFoot += col.width;
      });

      // Linhas de dados dos itens (após a linha de subtotal no topo)
      itens.forEach((row, idx) => {
        const yRow = ySubtotal + footerH + idx * rowH;
        const bgBase = idx % 2 === 0 ? "#FFFFFF" : "#FAFAFA";

        let xCell = padX;
        colunas.forEach((col) => {
          let valTexto = "-";
          let txtColor = "#222222";
          let cellBg = bgBase;
          let isBold = Boolean(col.bold);

          if (col.key === "item") {
            valTexto = truncar(row.item, 22);
          } else if (col.key === "descricao") {
            valTexto = truncar(row.descricao, 45);
            txtColor = "#424242";
          } else if (col.isPrazo) {
            const vP = Number(row.falta_por_prazo?.[col.prazoKey] || 0);
            valTexto = vP > 0 ? formatarQtd(vP) : "-";
            if (vP > 0) {
              cellBg = "#F0F7FF";
              txtColor = "#0D47A1";
              isBold = true;
            } else {
              txtColor = "#BDBDBD";
            }
          } else if (col.isTotal) {
            valTexto = formatarQtd(row.falta_total || 0);
            cellBg = "#FFF5F5";
            txtColor = "#C62828";
            isBold = true;
          }

          ctx.fillStyle = cellBg;
          ctx.fillRect(xCell, yRow, col.width, rowH);

          ctx.strokeStyle = "#EAEAEA";
          ctx.lineWidth = 1;
          ctx.strokeRect(xCell, yRow, col.width, rowH);

          ctx.fillStyle = txtColor;
          const fontFam = col.mono
            ? "JetBrains Mono, Consolas, monospace"
            : "Inter, Segoe UI, Arial, sans-serif";
          ctx.font = `${isBold ? "bold " : ""}11px ${fontFam}`;
          ctx.textAlign =
            col.align === "right" ? "right" : col.align === "center" ? "center" : "left";
          const tx =
            col.align === "right"
              ? xCell + col.width - 10
              : col.align === "center"
              ? xCell + col.width / 2
              : xCell + 10;
          ctx.fillText(valTexto, tx, yRow + rowH / 2);

          xCell += col.width;
        });
      });

      // Dispara o download do PNG
      const slug = String(nomeArquivoBase || "tabela")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
      const dataStr = new Date().toISOString().slice(0, 10);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `faltantes_${slug}_${dataStr}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, "image/png");
    } catch (err) {
      alert("Erro ao gerar imagem da tabela: " + err.message);
    }
  };

  // Renderizador compartilhado da Camada Gerencial (Matérias-Primas separadas de Componentes agrupados por Fábrica)
  const renderSecaoGerencial = (
    blocoGerencial,
    isAbaFaltando = true,
    exibirItensAfetados = false
  ) => {
    const materiasPrimas = blocoGerencial?.materias_primas || [];
    const componentesPorFabrica = blocoGerencial?.componentes_por_fabrica || [];
    const resumo = blocoGerencial?.resumo || {};

    if (materiasPrimas.length === 0 && componentesPorFabrica.length === 0) {
      return isAbaFaltando ? (
        <div className="py-12 text-center text-xs text-[#2E7D32] flex flex-col items-center gap-2 bg-[#E8F5E9]/25 rounded-sm border border-[#C8E6C9]">
          <span className="material-symbols-outlined text-4xl">check_circle</span>
          <strong className="text-sm">
            Nenhuma matéria-prima ou componente em falta para resolver este escopo!
          </strong>
          <span className="text-[#424242]">
            Todos os insumos necessários possuem saldo suficiente na fila cumulativa.
          </span>
        </div>
      ) : (
        <div className="py-8 text-center text-xs text-[#757575]">
          Nenhum insumo registrado como disponível para os filtros selecionados.
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* BLOCO 1: MATÉRIAS-PRIMAS (TIPO C) */}
        <section className="bg-white border border-[#E5E5E5] rounded-[3px] shadow-[0_2px_10px_rgba(0,0,0,0.02)] overflow-hidden">
          <div className="px-6 py-4 bg-[#FAFAFA] border-b border-[#E5E5E5] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="material-symbols-outlined text-[18px] text-[#8B5A2B]">
                inventory_2
              </span>
              <h3 className="text-xs font-semibold tracking-wider text-[#1A1A1A] uppercase">
                MATÉRIAS-PRIMAS E INSUMOS COMPRADOS (TIPO C)
              </h3>
              <span className="w-5 h-5 flex items-center justify-center rounded-full bg-[#8B5A2B]/10 text-[#8B5A2B] text-[10px] font-semibold">
                {materiasPrimas.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 bg-white border border-[#E0E0E0] text-[#1A1A1A] rounded-sm">
                Com OC Aberta: <strong className="ml-1 font-semibold text-neutral-800">{resumo.mp_com_oc || 0} / {materiasPrimas.length}</strong>
              </span>
              {(resumo.mp_vinculadas_pedido || 0) > 0 && (
                <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 bg-[#EEF2FF] border border-[#C7D2FE] text-[#312E81] rounded-sm">
                  OC Vinculada ao Pedido: <strong className="ml-1 font-semibold text-[#1A1A1A]">{resumo.mp_vinculadas_pedido}</strong>
                </span>
              )}
            </div>
          </div>

          {materiasPrimas.length === 0 ? (
            <div className="p-5 text-center text-xs text-neutral-500 font-light">
              {isAbaFaltando
                ? "✓ Nenhuma matéria-prima comprada (Tipo C) em falta."
                : "Nenhuma matéria-prima comprada neste filtro."}
            </div>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Tabela de Matérias-Primas e Insumos Comprados"
              className="overflow-auto max-h-[min(520px,65vh)] relative focus:outline-none"
            >
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-white text-neutral-400 uppercase text-[10px] font-medium tracking-wider border-b border-[#E0E0E0] shadow-2xs">
                  <tr>
                    <th scope="col" className="py-3 px-5 font-medium bg-white whitespace-nowrap">Matéria-Prima</th>
                    <th scope="col" className="py-3 px-4 font-medium bg-white">Descrição</th>
                    {exibirItensAfetados && (
                      <th scope="col" className="py-3 px-4 font-medium bg-white">Item(ns) do Pedido</th>
                    )}
                    <th scope="col" className="py-3 px-3 font-medium bg-white text-center">Baixa</th>
                    <th scope="col" className="py-3 px-4 font-medium bg-white text-right">Saldo Total Estoque</th>
                    <th scope="col" className="py-3 px-4 font-medium bg-white text-right">Saldo na Fila</th>
                    <th scope="col" className="py-3 px-4 font-medium bg-white text-right">Consumo</th>
                    {isAbaFaltando && (
                      <th scope="col" className="py-3 px-4 font-medium bg-white text-right text-[#B84A39]">
                        Falta
                      </th>
                    )}
                    <th scope="col" className="py-3 px-5 font-medium bg-white">Ordem de Compra (OC)</th>
                    <th scope="col" className="py-3 px-4 font-medium bg-white text-center">Previsão OC</th>
                    <th
                      scope="col"
                      className="py-3 px-4 font-medium bg-white text-center"
                      title="Soma do saldo em OCs com previsão de entrega até a data de abertura da ordem"
                    >
                      Saldo OC até Abertura
                    </th>
                    <th scope="col" className="py-3 px-5 font-medium bg-white text-center">Vínculo / Observação OC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F0F0]">
                  {materiasPrimas.map((mp, idx) => (
                    <tr
                      key={`${mp.item}_${idx}`}
                      className="hover:bg-[#FBFBFB] transition-colors"
                    >
                      <th scope="row" className="py-3.5 px-5 font-mono font-medium text-[#1A1A1A] whitespace-nowrap text-left font-normal">
                        {mp.item}
                      </th>
                      <td
                        className="py-3.5 px-4 font-normal text-[#1A1A1A] max-w-xs truncate"
                        title={mp.descricao}
                      >
                        {mp.descricao || "-"}
                      </td>
                      {exibirItensAfetados && (
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1 max-w-[210px]">
                            {(mp.itens_finais_afetados || []).map((af, aIdx) => (
                              <span
                                key={aIdx}
                                className="px-1.5 py-0.5 rounded bg-[#F8F8F8] border border-[#E0E0E0] font-mono text-[10px] text-neutral-600"
                                title={`Fila #${af.posicao_fila} • ${af.descricao || ""} • Consumo: ${formatarQtd(af.consumo)} • Falta: ${formatarQtd(af.falta)}`}
                              >
                                {af.item_final}
                              </span>
                            ))}
                          </div>
                        </td>
                      )}
                      <td className="py-3.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded-sm border ${
                            mp.baixa === "S"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200/50"
                              : "bg-neutral-100 text-neutral-600 border-neutral-200"
                          }`}
                        >
                          {mp.baixa || "-"}
                        </span>
                      </td>
                      <td
                        className="py-3.5 px-4 text-right font-medium text-[#1A1A1A]"
                        title="Saldo total físico em estoque (Situação L)"
                      >
                        {formatarQtd(mp.estoque_total ?? mp.estoque_l)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-normal text-neutral-600">
                        {formatarQtd(mp.saldo_fila)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-normal text-neutral-600">
                        {formatarQtd(mp.consumo)}
                      </td>
                      {isAbaFaltando && (
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-[#B84A39] bg-rose-50/40">
                          {formatarQtd(mp.falta)}
                        </td>
                      )}
                      <td className="py-3.5 px-5">
                        {mp.oc_numero ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-[#1A1A1A]">
                                OC #{mp.oc_numero}
                              </span>
                              {mp.oc_sit === "A" ? (
                                <span
                                  className="text-[9px] font-medium px-1.5 py-0.5 bg-[#FFF3E0] text-[#E65100] border border-[#FFE0B2] rounded-sm"
                                  title="OC em aberto (sit_oc=S / situação A)"
                                >
                                  Em Aberto (A)
                                </span>
                              ) : mp.oc_pedido_compra ? (
                                <span
                                  className="text-[9px] font-medium px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-sm"
                                  title={`Pedido de Compra no fornecedor #${mp.oc_pedido_compra}`}
                                >
                                  Ped.Compra #{mp.oc_pedido_compra}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-[10px] text-neutral-400 mt-0.5">
                              Qtd OC: <strong className="text-neutral-600">{formatarQtd(mp.oc_saldo)}</strong>
                              {mp.oc_fornecedor
                                ? ` • ${mp.oc_fornecedor}`
                                : mp.oc_comprador
                                ? ` • Compr.: ${mp.oc_comprador}`
                                : ""}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium text-rose-800 bg-rose-50 border border-rose-200/60 rounded-sm">
                            Sem OC aberta
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {mp.oc_previsao ? (
                          <span className="inline-block px-2 py-0.5 text-[11px] font-mono text-amber-900 bg-amber-50/80 border border-amber-200/60 rounded-sm">
                            {mp.oc_previsao}
                          </span>
                        ) : (
                          <span className="text-neutral-400 font-mono">-</span>
                        )}
                      </td>
                      <td
                        className="py-3.5 px-4 text-center"
                        title={
                          mp.oc_data_abertura_ref
                            ? `Soma das OCs deste item com previsão <= ${mp.oc_data_abertura_ref} (Data de Abertura da Ordem)`
                            : "Data de abertura da ordem não informada"
                        }
                      >
                        <div className="flex flex-col items-center leading-tight gap-0.5">
                          <span
                            className={`inline-block px-2 py-0.5 font-mono text-[11px] font-medium rounded-sm border ${
                              (mp.oc_saldo_ate_abertura || 0) > 0
                                ? (mp.oc_saldo_ate_abertura || 0) >= (mp.falta || 0)
                                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                  : "bg-amber-50 text-amber-900 border-amber-200"
                                : "bg-[#F8F8F8] border-[#E0E0E0] text-neutral-700"
                            }`}
                          >
                            {formatarQtd(mp.oc_saldo_ate_abertura)}
                          </span>
                          <span className="text-[9px] text-neutral-400 mt-0.5">
                            {mp.oc_data_abertura_ref ? (
                              <>até {mp.oc_data_abertura_ref}</>
                            ) : (
                              "Sem dt. abertura"
                            )}
                          </span>
                          {(mp.oc_saldo_total_item || 0) > (mp.oc_saldo_ate_abertura || 0) && (
                            <span
                              className="text-[9px] text-neutral-400 font-mono"
                              title="Saldo total somando todas as OCs abertas deste item"
                            >
                              Total OC: {formatarQtd(mp.oc_saldo_total_item)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-center">
                        {mp.oc_numero ? (
                          mp.oc_vinculada_pedido ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-sm">
                                Vinculada ao Pedido ({mp.oc_vinculo})
                              </span>
                              {mp.oc_texto && (
                                <span
                                  className="text-[10px] font-mono text-neutral-500 max-w-[200px] truncate"
                                  title={mp.oc_texto}
                                >
                                  {mp.oc_texto}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[11px] font-medium text-neutral-700 px-2.5 py-1 bg-white border border-[#E0E0E0] rounded-sm whitespace-nowrap shadow-none">
                                Previsão mais antiga
                              </span>
                              {mp.oc_texto && (
                                <span
                                  className="text-[10px] text-neutral-400 max-w-[200px] truncate"
                                  title={mp.oc_texto}
                                >
                                  {mp.oc_texto}
                                </span>
                              )}
                            </div>
                          )
                        ) : (
                          <span className="text-neutral-400 font-light">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* BLOCO 2: COMPONENTES PRODUZIDOS (TIPO P) AGRUPADOS POR FÁBRICA */}
        <section className="space-y-4 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2.5">
              <span className="text-[#4A6B82]">
                <span className="material-symbols-outlined text-[18px]">precision_manufacturing</span>
              </span>
              <h3 className="text-xs font-semibold tracking-wider text-[#1A1A1A] uppercase">
                COMPONENTES PRODUZIDOS INTERNAMENTE (TIPO P) <span className="font-normal text-neutral-400">•</span> AGRUPADOS POR FÁBRICA
              </h3>
              <span className="w-5 h-5 flex items-center justify-center rounded-full bg-[#4A6B82]/10 text-[#4A6B82] text-[10px] font-semibold">
                {resumo.total_componentes || 0}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 bg-white border border-[#E0E0E0] text-neutral-700 rounded-sm">
                Fábricas Envolvidas: <strong className="ml-1 text-[#1A1A1A]">{componentesPorFabrica.length}</strong>
              </span>
              <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 bg-white border border-[#E0E0E0] text-neutral-700 rounded-sm">
                Com OP Aberta: <strong className="ml-1 text-[#1A1A1A]">{resumo.comp_com_op || 0}/{resumo.total_componentes || 0}</strong>
              </span>
            </div>
          </div>

          {componentesPorFabrica.length === 0 ? (
            <div className="p-5 border border-[#E5E5E5] rounded-[3px] bg-white text-center text-xs text-neutral-500 font-light">
              {isAbaFaltando
                ? "✓ Nenhum componente produzido (Tipo P) em falta."
                : "Nenhum componente produzido neste filtro."}
            </div>
          ) : (
            <div className="space-y-4">
              {componentesPorFabrica.map((grupo) => (
                <div
                  key={grupo.fabrica}
                  className="bg-white border border-[#E5E5E5] rounded-[3px] shadow-[0_2px_10px_rgba(0,0,0,0.02)] overflow-hidden"
                >
                  {/* Cabeçalho da Fábrica */}
                  <div className="px-6 py-3 bg-[#F4F7FA] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-[16px] text-[#4A6B82]">
                        factory
                      </span>
                      <span className="text-xs font-semibold text-[#1A1A1A]">
                        Fábrica: {grupo.fabrica}
                      </span>
                      <span className="text-[10px] font-medium px-2 py-0.5 bg-[#E2E8F0] text-neutral-700 rounded-sm">
                        {grupo.total_itens} item(ns)
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-neutral-600 font-medium">
                      {grupo.total_faltando > 0 && (
                        <span className="text-[#B84A39] font-semibold text-[11px]">
                          {grupo.total_faltando} em falta
                        </span>
                      )}
                      <span>
                        OPs abertas: <strong className="text-[#1A1A1A] font-semibold">{grupo.total_com_op}/{grupo.total_itens}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Tabela de Componentes da Fábrica */}
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label={`Tabela de Componentes da Fábrica ${grupo.fabrica}`}
                    className="overflow-auto max-h-[min(520px,65vh)] relative focus:outline-none"
                  >
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 z-10 bg-white text-neutral-400 uppercase text-[10px] font-medium tracking-wider border-b border-[#E0E0E0] shadow-2xs">
                        <tr>
                          <th scope="col" className="py-3 px-5 font-medium bg-white whitespace-nowrap">Componente</th>
                          <th scope="col" className="py-3 px-4 font-medium bg-white">Descrição do Componente</th>
                          {exibirItensAfetados && (
                            <th scope="col" className="py-3 px-4 font-medium bg-white">Item(ns) do Pedido</th>
                          )}
                          <th scope="col" className="py-3 px-3 font-medium bg-white text-center">Baixa</th>
                          <th scope="col" className="py-3 px-4 font-medium bg-white text-right">Saldo Total Estoque</th>
                          <th scope="col" className="py-3 px-4 font-medium bg-white text-right">Saldo na Fila</th>
                          <th scope="col" className="py-3 px-4 font-medium bg-white text-right">Consumo</th>
                          {isAbaFaltando && (
                            <th scope="col" className="py-3 px-4 font-medium bg-white text-right text-[#B84A39]">
                              Falta
                            </th>
                          )}
                          <th scope="col" className="py-3 px-5 font-medium bg-white">OP Componente</th>
                          <th scope="col" className="py-3 px-4 font-medium bg-white text-center">Abertura OP</th>
                          <th scope="col" className="py-3 px-4 font-medium bg-white text-center">Entrega OP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F0F0F0]">
                        {grupo.itens.map((comp, cIdx) => (
                          <tr
                            key={`${comp.item}_${cIdx}`}
                            className="hover:bg-[#FBFBFB] transition-colors"
                          >
                            <th
                              scope="row"
                              className="py-3.5 px-5 font-mono font-medium text-[#1A1A1A] whitespace-nowrap text-left font-normal"
                            >
                              {comp.item}
                            </th>
                            <td
                              className="py-3.5 px-4 font-normal text-[#1A1A1A] max-w-xs truncate"
                              title={comp.descricao}
                            >
                              {comp.descricao || "-"}
                            </td>
                            {exibirItensAfetados && (
                              <td className="py-3.5 px-4">
                                <div className="flex flex-wrap gap-1 max-w-[210px]">
                                  {(comp.itens_finais_afetados || []).map((af, aIdx) => (
                                    <span
                                      key={aIdx}
                                      className="px-1.5 py-0.5 rounded bg-[#F8F8F8] border border-[#E0E0E0] font-mono text-[10px] text-neutral-600"
                                      title={`Fila #${af.posicao_fila} • ${af.descricao || ""} • Consumo: ${formatarQtd(af.consumo)} • Falta: ${formatarQtd(af.falta)}`}
                                    >
                                      {af.item_final}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            )}
                            <td className="py-3.5 px-3 text-center">
                              <span
                                className={`px-2 py-0.5 text-[10px] font-semibold rounded-sm border ${
                                  comp.baixa === "S"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200/50"
                                    : "bg-neutral-100 text-neutral-600 border-neutral-200"
                                }`}
                              >
                                {comp.baixa || "-"}
                              </span>
                            </td>
                            <td
                              className="py-3.5 px-4 text-right font-medium text-[#1A1A1A]"
                              title="Saldo total físico em estoque (Situação L)"
                            >
                              {formatarQtd(comp.estoque_total ?? comp.estoque_l)}
                            </td>
                            <td className="py-3.5 px-4 text-right font-normal text-neutral-600">
                              {formatarQtd(comp.saldo_fila)}
                            </td>
                            <td className="py-3.5 px-4 text-right font-normal text-neutral-600">
                              {formatarQtd(comp.consumo)}
                            </td>
                            {isAbaFaltando && (
                              <td className="py-3.5 px-4 text-right font-mono font-bold text-[#B84A39] bg-rose-50/40">
                                {formatarQtd(comp.falta)}
                              </td>
                            )}
                            <td className="py-3.5 px-5 whitespace-nowrap">
                              {comp.ordem_prod ? (
                                <div className="flex flex-col leading-tight gap-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-[#1A1A1A]">
                                      OP #{comp.ordem_prod}
                                    </span>
                                    <span
                                      className={`px-1.5 py-0.2 rounded text-[9px] font-medium border ${
                                        comp.op_vinculo === "PEDIDO"
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                          : "bg-neutral-100 text-neutral-600 border-neutral-200"
                                      }`}
                                    >
                                      {comp.op_vinculo === "PEDIDO" ? "Pedido" : "Lote"}
                                    </span>
                                  </div>
                                  {comp.op_saldo > 0 && (
                                    <span className="text-[10px] text-neutral-400">
                                      Saldo OP: <strong className="text-neutral-600">{formatarQtd(comp.op_saldo)}</strong>
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium text-rose-800 bg-rose-50 border border-rose-200/60 rounded-sm">
                                  Sem OP aberta
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-center font-mono text-neutral-600 whitespace-nowrap">
                              {comp.op_data_abertura ? (
                                comp.op_data_abertura
                              ) : (
                                <span className="text-neutral-400">-</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-center font-mono text-neutral-600 whitespace-nowrap">
                              {comp.op_data_entrega ? (
                                comp.op_data_entrega
                              ) : (
                                <span className="text-neutral-400">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
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
    <div className="h-screen max-h-screen w-screen overflow-hidden flex flex-row bg-[#F8F8F8] text-[#1A1A1A] font-sans">
      {/* SIDEBAR FIXA À ESQUERDA (LÍDER DESIGN) */}
      <aside className="w-64 min-w-[256px] max-w-[256px] h-screen bg-[#FAFAFA] border-r border-[#EAEAEA] flex flex-col justify-between shrink-0 select-none z-30">
        <div className="flex flex-col">
          {/* Topo Brand Líder */}
          <div className="p-6 border-b border-[#EAEAEA]">
            <img src={logoLider} alt="Líder Design" className="h-7 w-auto" />
            <p className="text-[9px] tracking-[0.25em] text-[#757575] font-medium uppercase mt-1">
              DESIGN • GESTÃO INDUSTRIAL
            </p>
          </div>

          {/* Seção Navegação do Sistema */}
          <div className="px-5 py-3">
            <span className="text-[10px] uppercase tracking-wider text-[#8C8C8C] font-semibold">
              Navegação do Sistema
            </span>
          </div>

          <nav className="px-3 flex flex-col gap-1 text-xs">
            {/* Disponibilidade de Estoque - Menu Principal Ativo */}
            <button
              type="button"
              className="w-full flex items-center px-3 py-2.5 rounded-sm transition-all bg-[#1A1A1A] text-white font-medium shadow-[0_1px_8px_rgba(0,0,0,0.06)] text-left cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px] mr-3 text-neutral-300">
                inventory_2
              </span>
              <span className="tracking-tight text-xs">Disponibilidade de Estoque</span>
            </button>

            {/* Faltas Produzidos (Matriz) */}
            <button
              type="button"
              onClick={abrirMatrizFaltantes}
              disabled={loading}
              className="w-full flex items-center px-3 py-2.5 rounded-sm text-[#555] hover:bg-[#EAEAEA]/70 hover:text-[#1A1A1A] transition-all text-left cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px] mr-3 text-[#757575]">
                precision_manufacturing
              </span>
              <span className="tracking-tight text-xs">Faltas Produzidos (Matriz)</span>
            </button>

            {/* Resumo do Pedido */}
            <button
              type="button"
              onClick={() => abrirResumoPedido(filtroPedido)}
              disabled={loading}
              className="w-full flex items-center px-3 py-2.5 rounded-sm text-[#555] hover:bg-[#EAEAEA]/70 hover:text-[#1A1A1A] transition-all text-left cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px] mr-3 text-[#757575]">
                receipt_long
              </span>
              <span className="tracking-tight text-xs">Resumo do Pedido</span>
            </button>

            {/* Simulador de Pedidos */}
            <button
              type="button"
              onClick={abrirModalSimulador}
              disabled={loading}
              className="w-full flex items-center px-3 py-2.5 rounded-sm text-[#555] hover:bg-[#EAEAEA]/70 hover:text-[#1A1A1A] transition-all text-left cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px] mr-3 text-[#757575]">
                tune
              </span>
              <span className="tracking-tight text-xs flex-1">Simulador de Pedidos</span>
              {pedidosSimuladosAtivos.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[#8B5A2B] text-white text-[10px] font-bold">
                  {pedidosSimuladosAtivos.length}
                </span>
              )}
            </button>

            {pedidosSimuladosAtivos.length > 0 && (
              <button
                type="button"
                onClick={handleLimparSimulacao}
                disabled={loading}
                className="w-full flex items-center px-3 py-2 rounded-sm text-[#C62828] hover:bg-[#FFEBEE] transition-all text-left text-xs cursor-pointer mt-1"
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

        {/* Rodapé Sidebar Metadados & Ações */}
        <div className="flex flex-col border-t border-[#EAEAEA] bg-white">
          <div className="p-4 border-b border-[#EAEAEA] space-y-2">
            {sessionId && (
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3B6E4C]" />
                  <span className="text-[10px] uppercase tracking-wider text-[#757575] font-semibold">
                    Sessão Isolada
                  </span>
                </div>
                <p className="font-mono text-xs font-semibold text-[#1A1A1A] pl-3 mt-0.5">
                  {sessionId.slice(0, 8)}
                </p>
              </div>
            )}

            {(dataCarga || dataCarregamento) && (
              <div className="pt-1 border-t border-[#F0F0F0]">
                <span className="text-[10px] uppercase tracking-wider text-[#8C8C8C] font-medium block">
                  Snapshot da Base {snapshotNome ? `(${snapshotNome})` : ""}
                </span>
                <span className="font-mono text-xs text-[#1A1A1A] mt-0.5 block">
                  {dataCarga || dataCarregamento}
                </span>
              </div>
            )}
          </div>

          <div className="p-3 flex flex-col gap-2 bg-[#FAFAFA]">
            <button
              onClick={() => carregarDados(true, 0, true)}
              disabled={loading || loadingMore}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white border border-[#D5D5D5] rounded-sm text-[#1A1A1A] hover:bg-[#F5F5F5] text-xs font-medium transition-colors cursor-pointer"
              type="button"
            >
              <span className={`inline-flex items-center justify-center ${loading ? "animate-spin" : ""}`}>
                <span className="material-symbols-outlined text-[16px] -scale-x-100 inline-block">
                  sync
                </span>
              </span>
              <span>Recarregar Dados</span>
            </button>

            <button
              onClick={handleExportarExcel}
              disabled={exportando || totalRegistros === 0}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white border border-[#D5D5D5] rounded-sm text-[#1A1A1A] hover:bg-[#F5F5F5] text-xs font-medium transition-colors cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-[16px] text-[#666666]">
                {exportando ? "hourglass_top" : "download"}
              </span>
              <span>{exportando ? "Exportando..." : "Exportar Excel"}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ÁREA DE CONTEÚDO PRINCIPAL (LAYOUT WIDESCREEN) */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-[#F8F8F8]">
        {/* HEADER TOPBAR FIXO */}
        <header className="h-16 px-8 bg-white/95 backdrop-blur-md border-b border-[#EAEAEA] flex items-center justify-between shrink-0 z-20 shadow-[0_1px_8px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-4">
            {!isStandalone && onVoltar && (
              <button
                onClick={onVoltar}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-[#D5D5D5] bg-white text-[#1A1A1A] text-xs font-medium hover:bg-[#F2F2F2] transition-colors cursor-pointer"
                title="Voltar"
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                <span>Voltar</span>
              </button>
            )}

            <div>
              <h2 className="font-serif text-lg font-medium tracking-tight text-[#1A1A1A] leading-tight">
                Disponibilidade de Estoque por Item Final
              </h2>
              <p className="text-xs text-[#757575] mt-0.5 tracking-wide">
                Abatimento cumulativo na fila por data de abertura da OP • Estoque em Situação L
              </p>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 bg-[#F3F3F3] px-3.5 py-1.5 rounded-sm border border-[#EAEAEA]">
              <span className="w-2 h-2 rounded-full bg-[#3B6E4C]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#666666]">
                Matriz Industrial
              </span>
            </div>

            <div className="h-6 w-px bg-[#EAEAEA]" />

            <div className="flex items-center gap-3">
              <div className="flex flex-col text-right hidden sm:flex">
                <span className="text-xs font-semibold text-[#1A1A1A] leading-snug">
                  Controladoria Fabril
                </span>
                <span className="text-[10px] text-[#757575]">PCP &amp; Engenharia</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-[#1A1A1A] flex items-center justify-center text-white text-xs font-medium">
                CF
              </div>
            </div>
          </div>
        </header>

        {/* CORPO DO WORKSPACE COM SCROLL INTERNO */}
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
              {/* Local de Produção */}
              <div className="md:col-span-3 flex flex-col">
                <label className="text-[11px] uppercase tracking-wider text-[#757575] font-medium mb-1">
                  Local de Produção
                </label>
                <div className="relative">
                  <select
                    value={filtroLocal}
                    onChange={(e) => setFiltroLocal(e.target.value)}
                    className="w-full h-9 bg-white border border-[#E0E0E0] rounded-sm px-3 pr-8 text-xs text-[#1A1A1A] appearance-none focus:outline-none focus:border-[#1A1A1A] transition-colors cursor-pointer"
                  >
                    <option value="">Todos os Locais</option>
                    {locaisProducao.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-2 text-[18px] text-[#757575] pointer-events-none">
                    expand_more
                  </span>
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
                                  onClick={() => abrirResumoPedido(it.pedido, "TODOS")}
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
                                  onClick={() => abrirDetalhes(it)}
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
                                    onClick={() => abrirResumoPedido(it.pedido, "TODOS")}
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

            {/* RODAPÉ INFORMATIVO DE ROLAGEM INFINITA */}
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

      {/* MODAL NATIVO <dialog> DO SIMULADOR DE PEDIDOS (INTRANET) */}
      <dialog
        ref={simDialogRef}
        aria-labelledby={simDialogTitleId}
        className="w-full max-w-[690px] rounded-xs shadow-lider-modal border border-[#E0E0E0] p-0 bg-white text-[#1A1A1A] m-auto backdrop:bg-black/30 backdrop:backdrop-blur-[2px] animate-in fade-in zoom-in-95 duration-200"
      >
        <form onSubmit={handleConfirmarSimulacao} className="flex flex-col max-h-[90vh]">
          {/* Cabeçalho do Modal */}
          <header className="px-8 pt-7 pb-5 flex items-start justify-between border-b border-[#EDEDED] bg-white">
            <div className="flex items-start gap-3.5">
              <div className="mt-0.5 w-8 h-8 rounded-xs bg-[#FAF7F2] border border-[#EBE4DC] flex items-center justify-center text-[#8B5A2B] shrink-0">
                <svg className="w-4 h-4 stroke-[1.4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h2 id={simDialogTitleId} className="font-display font-medium text-[17px] tracking-tight text-[#1A1A1A]">
                  Consultar e Simular Pedidos Específicos
                </h2>
                <p className="text-xs text-[#757575] font-normal leading-relaxed mt-1">
                  Consulta estrutura e saldo na Intranet (<span className="font-mono text-[11px] text-[#1A1A1A]">192.168.0.6</span>), posiciona pela data de abertura e recalcula o estoque cumulativo.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={fecharModalSimulador}
              className="text-[#9E9E9E] hover:text-[#1A1A1A] p-1.5 -mr-1 transition-colors rounded-xs focus:outline-none"
              aria-label="Fechar janela"
            >
              <svg className="w-4 h-4 stroke-[1.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </header>

          {/* Corpo do Modal */}
          <div className="p-8 space-y-6 overflow-y-auto bg-white max-h-[calc(90vh-140px)]">
            {erroSimulador && (
              <div
                role="alert"
                className="p-3.5 rounded-xs bg-[#FFEBEE]/80 border border-[#EF9A9A] text-[#C62828] text-xs flex items-start gap-2.5"
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
                className="p-3.5 rounded-xs bg-[#FAF7F2] border border-[#EBE4DC] text-[#8B5A2B] text-xs flex items-start gap-2.5"
              >
                <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">
                  info
                </span>
                <span>{avisoSimulador}</span>
              </div>
            )}

            {/* Credenciais da Intranet */}
            <fieldset className="lider-fieldset">
              <legend className="lider-legend">Credenciais da Intranet</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor={userFieldId}
                    className="block text-[11px] font-medium text-[#1A1A1A] mb-1.5"
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
                    className="w-full h-10 px-3.5 bg-white border border-[#E0E0E0] text-xs text-[#1A1A1A] placeholder-[#9E9E9E] rounded-xs focus:border-[#1A1A1A] focus:ring-0 transition-colors shadow-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor={passFieldId}
                    className="block text-[11px] font-medium text-[#1A1A1A] mb-1.5"
                  >
                    Senha da Intranet
                  </label>
                  <div className="relative">
                    <input
                      id={passFieldId}
                      name="password"
                      type={mostrarSenha ? "text" : "password"}
                      autoComplete="current-password"
                      value={intranetSenha}
                      onChange={(e) => setIntranetSenha(e.target.value)}
                      placeholder="Sua senha"
                      className="w-full h-10 pl-3.5 pr-16 bg-white border border-[#E0E0E0] text-xs text-[#1A1A1A] placeholder-[#9E9E9E] rounded-xs focus:border-[#1A1A1A] focus:ring-0 transition-colors shadow-none"
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarSenha((prev) => !prev)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[11px] font-medium text-[#757575] hover:text-[#1A1A1A] tracking-wide focus:outline-none transition-colors"
                    >
                      {mostrarSenha ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-[#757575] font-normal mt-3.5 leading-relaxed">
                Pedidos já em carteira mantêm seus números/saldos originais e têm a Data de Abertura atualizada pela Entrega Desejada. Pedidos novos têm saldo e estrutura importados da Intranet.
              </p>
            </fieldset>

            {/* Lista de Pedidos e Datas de Entrega */}
            <fieldset className="lider-fieldset">
              <legend className="lider-legend">Pedidos para Consultar / Simular</legend>

              <div className="space-y-3.5">
                {linhasSimulador.map((linha, index) => (
                  <div
                    key={linha.id}
                    className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 group"
                  >
                    <div className="flex-1">
                      <label
                        htmlFor={`ped_${linha.id}`}
                        className="block text-[11px] font-medium text-[#1A1A1A] mb-1.5"
                      >
                        Número do Pedido {linhasSimulador.length > 1 ? `#${index + 1}` : ""}{" "}
                        <span className="text-[#8B5A2B]">*</span>
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
                        className="w-full h-10 px-3.5 bg-white border border-[#E0E0E0] text-xs font-mono text-[#1A1A1A] placeholder-[#9E9E9E] rounded-xs focus:border-[#1A1A1A] focus:ring-0 transition-colors"
                      />
                    </div>

                    <div className="w-full sm:w-56">
                      <label
                        htmlFor={`dt_${linha.id}`}
                        className="block text-[11px] font-medium text-[#1A1A1A] mb-1.5"
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
                        className="w-full h-10 px-3.5 bg-white border border-[#E0E0E0] text-xs text-[#1A1A1A] rounded-xs focus:border-[#1A1A1A] focus:ring-0 transition-colors uppercase font-mono"
                      />
                    </div>

                    <div className="sm:self-end">
                      <button
                        type="button"
                        onClick={() => removerLinhaPedido(linha.id)}
                        className="w-10 h-10 flex items-center justify-center border border-[#E0E0E0] text-[#9E9E9E] hover:text-red-700 hover:border-red-200 transition-colors rounded-xs bg-white focus:outline-none"
                        title="Remover linha"
                        aria-label={`Remover linha ${index + 1}`}
                      >
                        <svg className="w-4 h-4 stroke-[1.4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={adicionarLinhaPedido}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 border border-[#E0E0E0] hover:border-[#1A1A1A] text-[#1A1A1A] bg-white text-xs font-medium rounded-xs transition-colors focus:outline-none w-fit cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5 stroke-[1.7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Adicionar outro pedido</span>
                </button>

                <span className="text-[11px] text-[#757575] font-normal text-right">
                  Em branco = posiciona o pedido no <strong className="text-[#1A1A1A] font-medium">final da lista</strong>.
                </span>
              </div>
            </fieldset>

            {/* Resumo de pedidos já ativos no simulador */}
            {pedidosSimuladosAtivos.length > 0 && (
              <div className="p-3.5 rounded-xs bg-[#FAF7F2] border border-[#EBE4DC] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B5A2B]">
                    Pedidos já ativos nesta simulação ({pedidosSimuladosAtivos.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleLimparSimulacao}
                    className="text-[11px] font-medium text-red-700 hover:underline"
                  >
                    Limpar todos
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pedidosSimuladosAtivos.map((ps) => (
                    <span
                      key={ps.pedido}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xs bg-white border border-[#E0E0E0] text-[11px] text-[#1A1A1A]"
                    >
                      <strong className="font-mono">#{ps.pedido}</strong>
                      <span className="text-[10px] text-[#757575]">
                        {ps.origem === "carteira" ? "Ordem criada • " : ""}
                        {ps.data_entrega || "Fim da fila"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoverPedidoSimulado(ps.pedido)}
                        className="hover:text-red-700 font-bold ml-1 text-sm leading-none"
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
          <footer className="px-8 py-5 bg-[#FAF7F2]/40 border-t border-[#EDEDED] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={fecharModalSimulador}
              disabled={simulando}
              className="px-5 py-2.5 bg-transparent border border-[#E0E0E0] text-[#1A1A1A] text-xs font-medium rounded-xs hover:bg-white hover:border-[#1A1A1A] transition-all focus:outline-none cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={simulando}
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-[#222222] hover:bg-black text-white text-xs font-medium tracking-wide rounded-xs transition-all shadow-none hover:shadow-sm focus:outline-none disabled:opacity-60 cursor-pointer"
            >
              <span
                className={`material-symbols-outlined text-[15px] ${
                  simulando ? "animate-spin" : ""
                }`}
              >
                {simulando ? "progress_activity" : "play_arrow"}
              </span>
              <span>
                {simulando ? "Consultando e Recalculando..." : "Confirmar e Recalcular Fila"}
              </span>
            </button>
          </footer>
        </form>
      </dialog>

      {/* MODAL DE DETALHES DO ITEM FINAL (ORGANIZADO EM MATÉRIA-PRIMA E COMPONENTES POR FÁBRICA) */}
      {itemSelecionado && (
        <div className="fixed inset-0 z-50 bg-[#000000]/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[90%] xl:max-w-7xl rounded-xs shadow-lider-modal flex flex-col max-h-[92vh] border border-[#E8E8E8] animate-in fade-in duration-200 overflow-hidden">
            {/* Header do Modal Líder Design */}
            <header className="h-[68px] px-8 bg-white border-b border-[#EAEAEA] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
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
                    {(detalhesItem
                      ? detalhesItem.total_faltando === 0
                      : itemSelecionado.status === "Disponível") ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[11px] font-medium bg-[#EBF4EC] text-[#245D31] border border-[#D5E8D7]">
                        ● 100% Disponível na Fila
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[11px] font-semibold bg-[#FFEBEE] text-[#C62828] border border-[#FFCDD2]">
                        ● {detalhesItem
                          ? detalhesItem.total_faltando
                          : itemSelecionado.componentes_faltando}{" "}
                        insumo(s) em falta
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
                <button
                  type="button"
                  onClick={fecharDetalhes}
                  className="p-1.5 text-[#666] hover:text-[#1A1A1A] hover:bg-[#F2F2F2] rounded-xs transition-colors ml-1 cursor-pointer"
                  title="Fechar detalhamento"
                  aria-label="Fechar detalhamento"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </header>

            {/* Item Card Meta Section */}
            <div className="px-8 pt-6 pb-2 bg-[#F8F8F8]">
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

                  {itemSelecionado.pedido && (
                    <div className="shrink-0 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const ped = itemSelecionado.pedido;
                          fecharDetalhes();
                          abrirResumoPedido(ped, "TODOS");
                        }}
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

            {/* BARRA DE CONTROLES E FILTROS INTERNOS DO MODAL */}
            <div className="px-8 py-3 bg-[#F8F8F8] flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 border-b border-[#E5E5E5]">
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

              {/* FILTROS INTERNOS DO MODAL (BAIXA E TIPO) */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-[#666]">
                {/* Filtro Baixa no Modal */}
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

                {/* Filtro Tipo no Modal */}
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

            {/* Conteúdo Gerencial do Modal (Separado em Matéria-Prima e Componentes por Fábrica) */}
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
              ) : abaDetalhe === "faltando" ? (
                renderSecaoGerencial(detalhesItem.gerencial_faltando, true, false)
              ) : (
                renderSecaoGerencial(detalhesItem.gerencial_disponiveis, false, false)
              )}
            </div>

            {/* Rodapé do Modal */}
            <footer className="px-8 py-4 border-t border-[#EAEAEA] flex justify-between items-center bg-white">
              <span className="text-[11px] text-[#757575]">
                {detalhesItem
                  ? `Total de ${detalhesItem.total_componentes} insumos cadastrados na estrutura`
                  : ""}
              </span>
              <button
                type="button"
                onClick={fecharDetalhes}
                className="px-5 py-2 rounded-xs bg-[#1A1A1A] text-white text-xs font-medium hover:bg-black transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* MODAL NATIVO <dialog> DE RESUMO GERENCIAL DO PEDIDO ("O QUE FALTA PARA RESOLVER O PEDIDO OU O ITEM") */}
      <dialog
        ref={resumoDialogRef}
        aria-labelledby={resumoDialogTitleId}
        className="w-full max-w-[90%] xl:max-w-7xl rounded-xs shadow-lider-modal border border-[#E0E0E0] p-0 bg-white text-[#1A1A1A] m-auto backdrop:bg-black/30 backdrop:backdrop-blur-[2px] overflow-hidden"
      >
        <div className="flex flex-col max-h-[90%]">
          {/* Cabeçalho do Resumo Gerencial com Busca de Pedido */}
          <header className="px-8 py-5 border-b border-[#EAEAEA] bg-white flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xs bg-[#FAF7F2] border border-[#EBE4DC] flex items-center justify-center text-[#8B5A2B] shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h2 id={resumoDialogTitleId} className="font-serif text-lg font-medium tracking-tight text-[#1A1A1A]">
                  Resumo Gerencial do Pedido <span className="font-sans font-light text-neutral-400 mx-1">—</span> <span className="font-normal text-sm text-neutral-600">O que falta para resolver o pedido ou o item</span>
                </h2>
                <p className="text-xs text-[#757575] font-light tracking-wide mt-0.5">
                  Visão consolidada separada por Matéria-Prima (previsão de OC) e Componentes agrupados por fábrica (abertura e entrega de OP).
                </p>
              </div>
            </div>

            {/* Busca rápida de Pedido dentro da tela de resumo */}
            <div className="flex items-center gap-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  carregarResumoPedido(resumoPedidoInput, "TODOS", resumoBaixa, resumoTipo);
                }}
                className="flex items-center bg-[#F8F8F8] border border-[#E0E0E0] rounded-xs p-1 pl-3 text-xs shadow-none"
              >
                <label htmlFor="order-search" className="text-neutral-500 font-medium mr-2">Pedido:</label>
                <input
                  id="order-search"
                  type="text"
                  value={resumoPedidoInput}
                  onChange={(e) => setResumoPedidoInput(e.target.value)}
                  placeholder="Ex: 176091"
                  className="bg-transparent border-none text-xs font-semibold text-[#1A1A1A] focus:ring-0 p-0 w-24 font-mono"
                />
                <button
                  type="submit"
                  disabled={carregandoResumo}
                  className="bg-[#1A1A1A] text-white hover:bg-neutral-800 transition-colors text-xs font-medium px-3.5 py-1.5 rounded-xs flex items-center gap-1.5 ml-2 cursor-pointer disabled:opacity-50"
                >
                  <svg className="w-3.5 h-3.5 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Consultar</span>
                </button>
              </form>

              <button
                type="button"
                onClick={fecharResumoPedido}
                className="text-neutral-400 hover:text-[#1A1A1A] transition-colors p-1.5 rounded-xs hover:bg-[#F2F2F2] cursor-pointer"
                title="Fechar visão"
                aria-label="Fechar resumo do pedido"
              >
                <svg className="w-5 h-5 stroke-[1.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </header>

          {/* Corpo do Resumo do Pedido */}
          <div className="p-8 overflow-y-auto flex-1 space-y-6 bg-[#F8F8F8]">
            {erroResumo && (
              <div
                role="alert"
                className="p-3.5 rounded-xs bg-[#FFEBEE]/80 border border-[#EF9A9A] text-[#C62828] text-xs flex items-center gap-2.5"
              >
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{erroResumo}</span>
              </div>
            )}

            {carregandoResumo ? (
              <div className="py-16 flex flex-col items-center justify-center gap-2 text-[#757575] bg-white border border-[#E8E8E8] rounded-xs">
                <span className="material-symbols-outlined text-3xl animate-spin text-[#8B5A2B]">
                  progress_activity
                </span>
                <span className="text-xs">
                  Consolidando itens do pedido, estoque total, OPs por fábrica e previsões de OC...
                </span>
              </div>
            ) : !resumoDados ? (
              <div className="py-12 text-center text-xs text-[#757575] bg-white border border-[#E8E8E8] rounded-xs">
                Informe o número de um pedido acima e clique em <strong>Consultar</strong> para visualizar o resumo gerencial.
              </div>
            ) : (
              <>
                {/* FAIXA DE DADOS DO PEDIDO E KPIS EXECUTIVOS */}
                <div className="grid grid-cols-12 gap-5">
                  {/* Card 1: Dados do Pedido */}
                  <article className="col-span-12 lg:col-span-5 bg-white border border-[#E5E5E5] rounded-xs p-5 shadow-xs flex flex-col justify-between">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] tracking-wider uppercase font-semibold text-neutral-400">
                          PEDIDO #{resumoDados.pedido || "-"}
                        </span>
                        <h3 className="text-sm font-semibold text-[#1A1A1A] mt-1 tracking-tight truncate max-w-sm" title={resumoDados.cliente}>
                          Cliente: {resumoDados.cliente || "Não informado"}
                        </h3>
                      </div>
                      {resumoDados.status_pedido === "Disponível" ? (
                        <span className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50/80 border border-emerald-200/60 rounded-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
                          Pedido 100% Disponível
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium text-[#C62828] bg-[#FFEBEE] border border-[#FFCDD2] rounded-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#C62828] mr-1.5"></span>
                          {resumoDados.itens_pedido_com_falta} de {resumoDados.total_itens_pedido} com falta
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#F0F0F0] text-xs">
                      <div>
                        <span className="text-neutral-400 block text-[10px] uppercase font-medium">Abertura</span>
                        <span className="font-medium text-[#1A1A1A] font-mono">{resumoDados.data_abertura || "-"}</span>
                      </div>
                      <div>
                        <span className="text-neutral-400 block text-[10px] uppercase font-medium">Entrega</span>
                        <span className="font-medium text-[#1A1A1A] font-mono">{resumoDados.entrega || "-"}</span>
                      </div>
                      <div>
                        <span className="text-neutral-400 block text-[10px] uppercase font-medium">Itens Finais</span>
                        <span className="font-medium text-[#1A1A1A] font-mono">{resumoDados.total_itens_pedido}</span>
                      </div>
                    </div>
                  </article>

                  {/* Card 2: Pendências de Matéria-Prima (Compras) */}
                  <article className="col-span-12 lg:col-span-3.5 bg-white border border-[#E5E5E5] rounded-xs p-5 shadow-xs flex flex-col justify-between">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-[#8B5A2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                        <h3 className="text-[11px] font-semibold tracking-wider text-[#1A1A1A] uppercase">
                          MATÉRIAS-PRIMAS FALTANTES (TIPO C)
                        </h3>
                      </div>
                      <span className="font-serif text-2xl font-light text-[#1A1A1A]">
                        {resumoDados.gerencial_faltando?.resumo?.materias_primas_faltando || 0}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-[#F0F0F0]">
                      <span className="inline-flex items-center text-[11px] font-normal px-2 py-1 bg-[#F8F8F8] border border-[#E0E0E0] text-neutral-600 rounded-xs">
                        Com OC aberta: <strong className="ml-1 font-semibold text-[#1A1A1A]">{resumoDados.gerencial_faltando?.resumo?.mp_com_oc || 0}</strong>
                      </span>
                      <span className="inline-flex items-center text-[11px] font-normal px-2 py-1 bg-[#F8F8F8] border border-[#E0E0E0] text-neutral-600 rounded-xs">
                        OC vinculada: <strong className="ml-1 font-semibold text-[#1A1A1A]">{resumoDados.gerencial_faltando?.resumo?.mp_vinculadas_pedido || 0}</strong>
                      </span>
                    </div>
                  </article>

                  {/* Card 3: Pendências de Componentes por Fábrica (Produção) */}
                  <article className="col-span-12 lg:col-span-3.5 bg-white border border-[#E5E5E5] rounded-xs p-5 shadow-xs flex flex-col justify-between">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-[#4A6B82]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.07a4.5 4.5 0 004.486-6.32l-3.27 3.27-2.335-.778-.778-2.335 3.27-3.27a4.5 4.5 0 00-6.32 4.486c.118.58.094 1.193-.07 1.743" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                        <h3 className="text-[11px] font-semibold tracking-wider text-[#1A1A1A] uppercase">
                          COMPONENTES FALTANTES (TIPO P)
                        </h3>
                      </div>
                      <span className="font-serif text-2xl font-light text-[#1A1A1A]">
                        {resumoDados.gerencial_faltando?.resumo?.componentes_faltando || 0}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-[#F0F0F0]">
                      <span className="inline-flex items-center text-[11px] font-normal px-2 py-1 bg-[#F8F8F8] border border-[#E0E0E0] text-neutral-600 rounded-xs">
                        Fábricas com pendência: <strong className="ml-1 font-semibold text-[#1A1A1A]">{resumoDados.gerencial_faltando?.resumo?.total_fabricas || 0}</strong>
                      </span>
                      <span className="inline-flex items-center text-[11px] font-normal px-2 py-1 bg-[#F8F8F8] border border-[#E0E0E0] text-neutral-600 rounded-xs">
                        Com OP aberta: <strong className="ml-1 font-semibold text-[#1A1A1A]">{resumoDados.gerencial_faltando?.resumo?.comp_com_op || 0}</strong>
                      </span>
                    </div>
                  </article>
                </div>

                {/* SELETOR DE ESCOPO: RESOLVER O PEDIDO INTEIRO OU UM ITEM ESPECÍFICO DO PEDIDO */}
                <section className="bg-white border border-[#E5E5E5] rounded-xs p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs uppercase tracking-wider font-semibold text-[#757575]">
                      ESCOPO DA ANÁLISE <span className="font-normal text-neutral-400">—</span> SELECIONE O PEDIDO COMPLETO OU UM ITEM:
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        carregarResumoPedido(resumoDados.pedido, "TODOS", resumoBaixa, resumoTipo)
                      }
                      className={`text-xs px-3.5 py-1.5 rounded-xs font-medium flex items-center gap-2 shadow-xs transition-colors cursor-pointer ${
                        resumoItemEscopo === "TODOS"
                          ? "bg-[#1A1A1A] text-white"
                          : "border border-[#E0E0E0] hover:border-neutral-400 bg-white text-neutral-700"
                      }`}
                    >
                      <svg className="w-3.5 h-3.5 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>Pedido Completo ({resumoDados.total_itens_pedido} itens)</span>
                    </button>
                  </div>

                  <div className="text-xs text-[#757575] font-light tracking-wide">
                    {resumoItemEscopo === "TODOS"
                      ? `Exibindo consolidado de todos os ${resumoDados.total_itens_pedido} itens do pedido`
                      : `Filtrado para o item ${resumoItemEscopo}`}
                  </div>

                  <div className="w-full flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-2 border-t border-[#F0F0F0]">
                    {(resumoDados.itens_do_pedido || []).map((itPed, idx) => {
                      const selecionado = resumoItemEscopo === itPed.item_final;
                      const disp = itPed.status === "Disponível";
                      return (
                        <button
                          key={`${itPed.item_final}_${idx}`}
                          type="button"
                          onClick={() =>
                            carregarResumoPedido(
                              resumoDados.pedido,
                              itPed.item_final,
                              resumoBaixa,
                              resumoTipo,
                              itPed.fabrica
                            )
                          }
                          title={`${itPed.descricao || ""} • Fábrica: ${itPed.fabrica} • Fila #${itPed.posicao_fila}`}
                          className={`text-xs px-3 py-1.5 rounded-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                            selecionado
                              ? "bg-[#8B5A2B] text-white font-medium shadow-xs"
                              : "border border-[#E0E0E0] hover:border-neutral-400 bg-white text-neutral-700"
                          }`}
                        >
                          <span className={selecionado ? "text-white/80" : "text-neutral-400"}>
                            #{itPed.posicao_fila}
                          </span>
                          <span className="font-mono font-medium">{itPed.item_final}</span>
                          <span
                            className={`px-1 py-0.2 rounded-xs text-[9px] font-semibold ml-1 ${
                              selecionado
                                ? "bg-white/20 text-white"
                                : disp
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-[#FFEBEE] text-[#C62828]"
                            }`}
                          >
                            {disp ? "OK" : `Falta ${itPed.componentes_faltando}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* BARRA DE ABAS (O QUE FALTA RESOLVER vs DISPONÍVEIS) E FILTROS (BAIXA / ORIGEM) */}
                <section className="flex flex-wrap items-center justify-between border-b border-[#E0E0E0] pb-2 gap-4">
                  <div className="flex items-center gap-6" role="tablist">
                    <button
                      type="button"
                      onClick={() => setAbaResumo("faltando")}
                      className={`text-xs pb-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                        abaResumo === "faltando"
                          ? "font-semibold text-[#1A1A1A] border-b-2 border-[#1A1A1A]"
                          : "font-medium text-neutral-400 hover:text-neutral-700"
                      }`}
                    >
                      <svg className="w-3.5 h-3.5 stroke-[1.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>
                        O que falta para resolver{" "}
                        {resumoItemEscopo === "TODOS" ? "o Pedido" : `o Item ${resumoItemEscopo}`}{" "}
                        ({resumoDados.total_faltando || 0})
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAbaResumo("disponiveis")}
                      className={`text-xs pb-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                        abaResumo === "disponiveis"
                          ? "font-semibold text-[#1A1A1A] border-b-2 border-[#1A1A1A]"
                          : "font-medium text-neutral-400 hover:text-neutral-700"
                      }`}
                    >
                      <svg className="w-3.5 h-3.5 text-emerald-600 stroke-[2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M4.5 12.75l6 6 9-13.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>Insumos já Disponíveis ({resumoDados.total_disponiveis || 0})</span>
                    </button>
                  </div>

                  {/* Filtros Baixa e Tipo do Resumo */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-neutral-400 font-medium">Baixa:</span>
                      <div className="inline-flex border border-[#E0E0E0] rounded-xs overflow-hidden bg-white">
                        {["todos", "S", "N"].map((bOpt) => (
                          <button
                            key={bOpt}
                            type="button"
                            onClick={() => {
                              setResumoBaixa(bOpt);
                              carregarResumoPedido(
                                resumoDados.pedido,
                                resumoItemEscopo,
                                bOpt,
                                resumoTipo
                              );
                            }}
                            className={`px-2.5 py-1 text-[11px] font-semibold border-l first:border-l-0 border-[#E0E0E0] cursor-pointer ${
                              resumoBaixa === bOpt
                                ? "bg-[#1A1A1A] text-white"
                                : "text-neutral-600 hover:bg-[#F8F8F8]"
                            }`}
                          >
                            {bOpt === "todos" ? "Todas" : bOpt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-neutral-400 font-medium">Tipo:</span>
                      <div className="inline-flex border border-[#E0E0E0] rounded-xs overflow-hidden bg-white">
                        {[
                          { k: "todos", l: "Todos" },
                          { k: "C", l: "Matéria-Prima (C)" },
                          { k: "P", l: "Componente (P)" },
                        ].map((tOpt) => (
                          <button
                            key={tOpt.k}
                            type="button"
                            onClick={() => {
                              setResumoTipo(tOpt.k);
                              carregarResumoPedido(
                                resumoDados.pedido,
                                resumoItemEscopo,
                                resumoBaixa,
                                tOpt.k
                              );
                            }}
                            className={`px-2.5 py-1 text-[11px] font-semibold border-l first:border-l-0 border-[#E0E0E0] cursor-pointer ${
                              resumoTipo === tOpt.k
                                ? "bg-[#1A1A1A] text-white"
                                : "text-neutral-600 hover:bg-[#F8F8F8]"
                            }`}
                          >
                            {tOpt.l}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {/* SEÇÕES GERENCIAIS: MATÉRIAS-PRIMAS (C) E COMPONENTES AGRUPADOS POR FÁBRICA (P) */}
                {abaResumo === "faltando"
                  ? renderSecaoGerencial(
                      resumoDados.gerencial_faltando,
                      true,
                      resumoItemEscopo === "TODOS" && resumoDados.total_itens_pedido > 1
                    )
                  : renderSecaoGerencial(
                      resumoDados.gerencial_disponiveis,
                      false,
                      resumoItemEscopo === "TODOS" && resumoDados.total_itens_pedido > 1
                    )}
              </>
            )}
          </div>

          {/* Rodapé do Modal de Resumo */}
          <footer className="px-8 py-4 border-t border-[#EAEAEA] bg-white flex items-center justify-between">
            <span className="text-[11px] text-[#757575]">
              {resumoDados
                ? `Pedido #${resumoDados.pedido || "-"} • ${resumoDados.total_insumos} insumo(s) avaliado(s) no escopo`
                : ""}
            </span>
            <button
              type="button"
              onClick={fecharResumoPedido}
              className="px-5 py-2 rounded-xs bg-[#1A1A1A] text-white text-xs font-medium hover:bg-black transition-colors cursor-pointer"
            >
              Fechar Resumo
            </button>
          </footer>
        </div>
      </dialog>

      {/* MODAL NATIVO <dialog> DE MATRIZ PIVOT DE COMPONENTES PRODUZIDOS FALTANTES */}
      <dialog
        ref={matrizDialogRef}
        aria-labelledby={matrizDialogTitleId}
        className="w-full max-w-[97vw] rounded-xs shadow-lider-modal border border-[#E8E8E8] p-0 bg-white text-[#1A1A1A] m-auto backdrop:bg-black/30 backdrop:backdrop-blur-[2px] overflow-hidden"
      >
        <div className="flex flex-col max-h-[94vh]">
          {/* Cabeçalho da Matriz Pivot Líder Design */}
          <header className="bg-white border-b border-[#E8E8E8] px-8 py-5 flex-shrink-0 z-20">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#8B5A2B]"></span>
                  <h2 id={matrizDialogTitleId} className="text-lg lg:text-xl font-medium tracking-tight text-[#1A1A1A] font-heading">
                    Matriz Pivot — Componentes Produzidos Faltantes por Local do Item Pai × Local do Componente × Prazo de Expedição
                  </h2>
                </div>
                <p className="text-xs text-[#757575] max-w-4xl leading-relaxed font-normal">
                  Agrupamento por fábrica do item final e fábrica do componente produzido (Tipo P), exibindo os saldos faltantes em colunas por prazo de expedição (calculado com base no Representante).
                </p>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setMatrizMenuAberto((prev) => !prev)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#1A1A1A] bg-transparent border border-[#D4D4D4] rounded-xs hover:bg-[#F8F8F8] transition cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5 text-[#666666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"></path>
                  </svg>
                  <span>{matrizMenuAberto ? "Ocultar Menu de Filtros" : "Abrir Menu de Filtros"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportarMatrizExcel}
                  disabled={exportandoMatriz || carregandoMatriz || !matrizDados?.linhas_planas?.length}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#1A1A1A] hover:bg-[#2E2E2E] rounded-xs transition shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"></path>
                  </svg>
                  <span>{exportandoMatriz ? "Exportando..." : "Exportar Matriz Excel"}</span>
                </button>

                <button
                  type="button"
                  onClick={fecharMatrizFaltantes}
                  className="text-[#757575] hover:text-[#1A1A1A] p-1.5 rounded-xs hover:bg-[#EEEEEE] transition-colors cursor-pointer"
                  aria-label="Fechar matriz de componentes faltantes"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>
          </header>

          {/* Corpo da Tela da Matriz Pivot */}
          <div className="p-8 overflow-y-auto flex-1 space-y-6 bg-[#F8F8F8]">
            {erroMatriz && (
              <div
                role="alert"
                className="p-3.5 rounded-xs bg-[#FFEBEE]/80 border border-[#EF9A9A] text-[#C62828] text-xs flex items-center gap-2.5"
              >
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{erroMatriz}</span>
              </div>
            )}

            {/* MENU DE OPÇÕES DE FILTROS PARA CÁLCULO */}
            {matrizMenuAberto && (
              <section className="bg-white border border-[#E8E8E8] rounded-xs p-6 shadow-lider transition-all duration-300">
                <div className="flex items-center justify-between pb-4 mb-5 border-b border-[#E8E8E8]">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#1A1A1A] tracking-wider uppercase">
                    <svg className="w-4 h-4 text-[#8B5A2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"></path>
                    </svg>
                    <span>Menu de Opções de Filtros para Cálculo</span>
                  </div>
                  <span className="text-[11px] text-[#757575]">
                    Marque os locais desejados para compor o cálculo • Prazos de expedição trazem todos os disponíveis automaticamente
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* COLUNA 1: LOCAL DE PRODUÇÃO DO ITEM FINAL (PAI) */}
                  <div className="border border-[#E8E8E8] p-4 rounded-xs flex flex-col bg-white">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium text-[#1A1A1A]">1. Local Produção do Item Pai (Pai)</span>
                      <span className="text-[10px] font-semibold bg-[#F8F8F8] border border-[#E8E8E8] px-2 py-0.5 rounded-xs text-[#1A1A1A]">
                        {matrizLocaisPaiSel.length}/{opcoesMatriz.locais_item_final.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={matrizBuscaLocalPai}
                          onChange={(e) => setMatrizBuscaLocalPai(e.target.value)}
                          placeholder="Filtrar local do item final..."
                          className="w-full text-xs py-1.5 px-3 bg-[#F8F8F8] border border-[#E8E8E8] rounded-xs focus:border-[#1A1A1A] focus:ring-0"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setMatrizLocaisPaiSel(opcoesMatriz.locais_item_final || [])}
                        className="px-2.5 py-1.5 text-[11px] font-medium border border-[#E8E8E8] rounded-xs hover:bg-[#F8F8F8] text-[#1A1A1A] cursor-pointer"
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        onClick={() => setMatrizLocaisPaiSel([])}
                        className="px-2.5 py-1.5 text-[11px] font-medium border border-[#E8E8E8] rounded-xs hover:bg-[#F8F8F8] text-[#757575] cursor-pointer"
                      >
                        Limpar
                      </button>
                    </div>

                    <div className="max-h-48 overflow-y-auto pr-1 grid grid-cols-2 gap-2 text-xs">
                      {(opcoesMatriz.locais_item_final || [])
                        .filter((loc) =>
                          loc.toUpperCase().includes(matrizBuscaLocalPai.trim().toUpperCase())
                        )
                        .map((loc) => {
                          const checked = matrizLocaisPaiSel.includes(loc);
                          return (
                            <label
                              key={loc}
                              className={`flex items-center gap-2 p-1.5 border rounded-xs cursor-pointer select-none transition-colors ${
                                checked
                                  ? "bg-[#F8F8F8] border-[#1A1A1A] text-[#1A1A1A] font-medium"
                                  : "border-[#E8E8E8] hover:bg-[#F8F8F8] text-[#555]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLocalPaiMatriz(loc)}
                                className="rounded-xs border-[#D4D4D4] text-[#1A1A1A] focus:ring-0 w-3.5 h-3.5"
                              />
                              <span className="truncate text-[11px]" title={loc}>
                                {loc}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                  </div>

                  {/* COLUNA 2: LOCAL DE PRODUÇÃO DO COMPONENTE PRODUZIDO */}
                  <div className="border border-[#E8E8E8] p-4 rounded-xs flex flex-col bg-white">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium text-[#1A1A1A]">2. Local do Componente Produzido (P)</span>
                      <span className="text-[10px] font-semibold bg-[#F8F8F8] border border-[#E8E8E8] px-2 py-0.5 rounded-xs text-[#1A1A1A]">
                        {matrizLocaisCompSel.length}/{opcoesMatriz.locais_componente.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={matrizBuscaLocalComp}
                          onChange={(e) => setMatrizBuscaLocalComp(e.target.value)}
                          placeholder="Filtrar local do componente..."
                          className="w-full text-xs py-1.5 px-3 bg-[#F8F8F8] border border-[#E8E8E8] rounded-xs focus:border-[#1A1A1A] focus:ring-0"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setMatrizLocaisCompSel(opcoesMatriz.locais_componente || [])}
                        className="px-2.5 py-1.5 text-[11px] font-medium border border-[#E8E8E8] rounded-xs hover:bg-[#F8F8F8] text-[#1A1A1A] cursor-pointer"
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        onClick={() => setMatrizLocaisCompSel([])}
                        className="px-2.5 py-1.5 text-[11px] font-medium border border-[#E8E8E8] rounded-xs hover:bg-[#F8F8F8] text-[#757575] cursor-pointer"
                      >
                        Limpar
                      </button>
                    </div>

                    <div className="max-h-48 overflow-y-auto pr-1 grid grid-cols-2 gap-2 text-xs">
                      {(opcoesMatriz.locais_componente || [])
                        .filter((loc) =>
                          loc.toUpperCase().includes(matrizBuscaLocalComp.trim().toUpperCase())
                        )
                        .map((loc) => {
                          const checked = matrizLocaisCompSel.includes(loc);
                          return (
                            <label
                              key={loc}
                              className={`flex items-center gap-2 p-1.5 border rounded-xs cursor-pointer select-none transition-colors ${
                                checked
                                  ? "bg-[#FBF7F4] border-[#8B5A2B]/40 text-[#8B5A2B] font-semibold"
                                  : "border-[#E8E8E8] hover:bg-[#F8F8F8] text-[#555]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLocalCompMatriz(loc)}
                                className="rounded-xs border-[#8B5A2B] text-[#8B5A2B] focus:ring-0 w-3.5 h-3.5"
                              />
                              <span className="truncate text-[11px]" title={loc}>
                                {loc}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                  </div>

                  {/* COLUNA 3: PRAZOS DE EXPEDIÇÃO E PARÂMETROS DE CÁLCULO */}
                  <div className="border border-[#E8E8E8] p-4 rounded-xs flex flex-col justify-between bg-white">
                    <div>
                      <span className="text-xs font-medium text-[#1A1A1A] block mb-2">3. Prazos de Expedição (Base Representante)</span>
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {[
                          { key: "10", label: "R. Multimarcas e Nordeste" },
                          { key: "8", label: "Fora de MG" },
                          { key: "3", label: "MG e franquia" },
                        ].map((pCol) => (
                          <span
                            key={pCol.key}
                            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-xs bg-[#F8F8F8] text-[#1A1A1A] border border-[#E8E8E8]"
                          >
                            <span className="text-[#8B5A2B]">✓</span> {pCol.label}
                          </span>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="text-[10px] text-[#757575] uppercase block mb-1">Escopo de Abatimento</label>
                          <select
                            value={matrizEscopoAbatimento}
                            onChange={(e) => setMatrizEscopoAbatimento(e.target.value)}
                            className="w-full text-xs py-1 px-2 border border-[#E8E8E8] bg-white rounded-xs focus:border-[#1A1A1A] focus:ring-0"
                            title="Fila Global: abate o estoque na fila completa e filtra os faltantes. Apenas Selecionados: abate o estoque exclusivamente entre os locais marcados."
                          >
                            <option value="global">Fila Global Completa</option>
                            <option value="filtrado">Apenas Locais Marcados</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] text-[#757575] uppercase block mb-1">Baixa Componente</label>
                          <select
                            value={matrizBaixa}
                            onChange={(e) => setMatrizBaixa(e.target.value)}
                            className="w-full text-xs py-1 px-2 border border-[#E8E8E8] bg-white rounded-xs focus:border-[#1A1A1A] focus:ring-0"
                          >
                            <option value="todos">Todas (S e N)</option>
                            <option value="S">Apenas Baixadas (S)</option>
                            <option value="N">Apenas Pendentes (N)</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] text-[#757575] uppercase block mb-1">Entrega do Pedido (Opcional)</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={matrizDataInicio}
                            onChange={(e) => setMatrizDataInicio(e.target.value)}
                            className="w-1/2 text-xs py-1 px-2 border border-[#E8E8E8] rounded-xs bg-white focus:border-[#1A1A1A] focus:ring-0 font-mono"
                            title="Data inicial de Entrega do Pedido"
                          />
                          <span className="text-[10px] text-[#757575]">até</span>
                          <input
                            type="date"
                            value={matrizDataFim}
                            onChange={(e) => setMatrizDataFim(e.target.value)}
                            className="w-1/2 text-xs py-1 px-2 border border-[#E8E8E8] rounded-xs bg-white focus:border-[#1A1A1A] focus:ring-0 font-mono"
                            title="Data final de Entrega do Pedido"
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => carregarMatrizFaltantes()}
                      disabled={carregandoMatriz}
                      className="w-full mt-4 py-2 px-4 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-xs font-medium rounded-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-60"
                    >
                      <svg className="w-3.5 h-3.5 text-[#8B5A2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                      </svg>
                      <span>{carregandoMatriz ? "Calculando Matriz Pivot..." : "Calcular / Atualizar Matriz Pivot"}</span>
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* CONTEÚDO DOS RESULTADOS DA MATRIZ PIVOT */}
            {carregandoMatriz ? (
              <div className="py-16 flex flex-col items-center justify-center gap-2 text-[#757575] bg-white border border-[#E8E8E8] rounded-xs">
                <span className="material-symbols-outlined text-3xl animate-spin text-[#1A1A1A]">
                  progress_activity
                </span>
                <span className="text-xs font-medium">
                  Calculando itens produzidos faltantes por Local do Item Pai × Local do Componente × Prazo de Expedição...
                </span>
              </div>
            ) : !matrizDados ? (
              <div className="py-12 text-center text-xs text-[#757575] bg-white border border-[#E8E8E8] rounded-xs">
                Marque os filtros desejados acima e clique em <strong>Calcular / Atualizar Matriz Pivot</strong>.
              </div>
            ) : (
              <>
                {(() => {
                  const prazosCols = [
                    { prazo: 10, key: "10", label: "R. Multimarcas e Nordeste" },
                    { prazo: 8, key: "8", label: "Fora de MG" },
                    { prazo: 3, key: "3", label: "MG e franquia" },
                  ];
                  const termoFiltroLocal = matrizBuscaItem.trim().toUpperCase();

                  const filtrarLinha = (itemObj) => {
                    if (!termoFiltroLocal) return true;
                    if (itemObj.item?.toUpperCase().includes(termoFiltroLocal)) return true;
                    if (itemObj.descricao?.toUpperCase().includes(termoFiltroLocal)) return true;
                    if (itemObj.fabrica_componente?.toUpperCase().includes(termoFiltroLocal))
                      return true;
                    return false;
                  };

                  // Consolida as linhas APENAS por Local de Produção do Componente (fabrica_componente)
                  // mantendo cada Componente único dentro da sua respectiva Fábrica de Produção
                  const mapaFabricaItens = {};
                  (matrizDados.linhas_planas || []).forEach((row) => {
                    const fc = row.fabrica_componente || "NÃO INFORMADO";
                    const codItem = row.item || "";
                    if (!mapaFabricaItens[fc]) {
                      mapaFabricaItens[fc] = {};
                    }
                    if (!mapaFabricaItens[fc][codItem]) {
                      const f3 = Number(row.falta_por_prazo?.["3"] || 0);
                      const f8 = Number(row.falta_por_prazo?.["8"] || 0);
                      const f10 = Number(row.falta_por_prazo?.["10"] || 0);
                      mapaFabricaItens[fc][codItem] = {
                        fabrica_componente: fc,
                        item: codItem,
                        descricao: row.descricao || "-",
                        falta_por_prazo: {
                          "3": Math.round(f3 * 100) / 100,
                          "8": Math.round(f8 * 100) / 100,
                          "10": Math.round(f10 * 100) / 100,
                        },
                        falta_total: Math.round(Number(row.falta_total || 0) * 100) / 100,
                      };
                    } else {
                      const acc = mapaFabricaItens[fc][codItem];
                      acc.falta_por_prazo["3"] =
                        Math.round(
                          (acc.falta_por_prazo["3"] + Number(row.falta_por_prazo?.["3"] || 0)) * 100
                        ) / 100;
                      acc.falta_por_prazo["8"] =
                        Math.round(
                          (acc.falta_por_prazo["8"] + Number(row.falta_por_prazo?.["8"] || 0)) * 100
                        ) / 100;
                      acc.falta_por_prazo["10"] =
                        Math.round(
                          (acc.falta_por_prazo["10"] + Number(row.falta_por_prazo?.["10"] || 0)) *
                            100
                        ) / 100;
                      acc.falta_total =
                        Math.round((acc.falta_total + Number(row.falta_total || 0)) * 100) / 100;
                    }
                  });

                  const gruposPorFabricaComp = Object.keys(mapaFabricaItens)
                    .map((fc) => {
                      const itensLista = Object.values(mapaFabricaItens[fc])
                        .filter(filtrarLinha)
                        .sort((a, b) => b.falta_total - a.falta_total || a.item.localeCompare(b.item));
                      const somasPrazo = {
                        "3": itensLista.reduce((acc, r) => acc + (r.falta_por_prazo["3"] || 0), 0),
                        "8": itensLista.reduce((acc, r) => acc + (r.falta_por_prazo["8"] || 0), 0),
                        "10": itensLista.reduce((acc, r) => acc + (r.falta_por_prazo["10"] || 0), 0),
                      };
                      const faltaTotalFab = itensLista.reduce((acc, r) => acc + r.falta_total, 0);
                      return {
                        fabrica_componente: fc,
                        itens: itensLista,
                        somas_por_prazo: somasPrazo,
                        falta_total_grupo: faltaTotalFab,
                      };
                    })
                    .filter((g) => g.itens.length > 0)
                    .sort(
                      (a, b) =>
                        b.falta_total_grupo - a.falta_total_grupo ||
                        a.fabrica_componente.localeCompare(b.fabrica_componente)
                    );

                  return (
                    <>
                      {/* CARDS DE TOTAIS GERAIS E SOMAS POR PRAZO DE EXPEDIÇÃO */}
                      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                        <div className="bg-white border border-[#E8E8E8] p-5 rounded-xs shadow-lider flex flex-col justify-between">
                          <span className="text-[10px] uppercase font-semibold text-[#757575] tracking-wider mb-2">
                            Fábricas de Componente
                          </span>
                          <div className="flex items-baseline justify-between mt-1">
                            <span className="text-2xl font-light tracking-tight text-[#1A1A1A] font-mono">
                              {gruposPorFabricaComp.length.toLocaleString("pt-BR")}
                            </span>
                            <span className="text-[11px] text-[#8C8C8C]">
                              {(
                                matrizDados.totais_gerais?.total_componentes_distintos || 0
                              ).toLocaleString("pt-BR")}{" "}
                              comp. únicos
                            </span>
                          </div>
                        </div>

                        {prazosCols.map((colP) => {
                          const valorPrazo =
                            matrizDados.totais_gerais?.somas_por_prazo?.[colP.key] || 0;
                          return (
                            <div
                              key={colP.key}
                              className="bg-white border border-[#E8E8E8] p-5 rounded-xs shadow-lider flex flex-col justify-between"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#1A1A1A]"></span>
                                <span className="text-[10px] uppercase font-semibold text-[#757575] tracking-wider">
                                  {colP.label}
                                </span>
                              </div>
                              <div className="flex items-baseline justify-between mt-2">
                                <span className="text-2xl font-light tracking-tight text-[#1A1A1A] font-mono">
                                  {formatarQtd(valorPrazo)}
                                </span>
                                <span className="text-[11px] text-[#757575]">peças</span>
                              </div>
                            </div>
                          );
                        })}

                        {/* Metric 5: Alerta Sóbrio Líder */}
                        <div className="bg-white border-l-4 border-l-[#8B5A2B] border-y border-r border-[#E8E8E8] p-5 rounded-xs shadow-lider flex flex-col justify-between">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-semibold text-[#8B5A2B] tracking-wider">
                              Total Faltante Geral
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-xs bg-[#FBF7F4] text-[#8B5A2B] font-medium border border-[#8B5A2B]/20">
                              Crítico
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between mt-2">
                            <span className="text-2xl font-normal tracking-tight text-[#1A1A1A] font-mono">
                              {formatarQtd(matrizDados.totais_gerais?.soma_falta_geral || 0)}
                            </span>
                            <span className="text-[11px] text-[#757575]">
                              {(
                                matrizDados.totais_gerais?.total_pedidos_afetados || 0
                              ).toLocaleString("pt-BR")}{" "}
                              pedidos
                            </span>
                          </div>
                        </div>
                      </section>

                      {/* BARRA DE BUSCA RÁPIDA E RIBBON */}
                      <div className="bg-white border border-[#E8E8E8] rounded-xs p-4 space-y-3 shadow-lider">
                        <div className="relative">
                          <svg className="w-4 h-4 text-[#8C8C8C] absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"></path>
                          </svg>
                          <input
                            type="text"
                            value={matrizBuscaItem}
                            onChange={(e) => setMatrizBuscaItem(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                carregarMatrizFaltantes({ busca: e.target.value });
                              }
                            }}
                            placeholder="Buscar código ou descrição do componente..."
                            className="w-full text-xs pl-10 pr-4 py-2 bg-[#F8F8F8] border border-[#E8E8E8] rounded-xs focus:border-[#1A1A1A] focus:bg-white focus:ring-0 transition"
                          />
                          {matrizBuscaItem && (
                            <button
                              type="button"
                              onClick={() => {
                                setMatrizBuscaItem("");
                                carregarMatrizFaltantes({ busca: "" });
                              }}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8B5A2B] hover:underline"
                            >
                              Limpar
                            </button>
                          )}
                        </div>
                      </div>

                      {/* TABELAS AGRUPADAS APENAS POR LOCAL DE PRODUÇÃO DO COMPONENTE */}
                      {gruposPorFabricaComp.length === 0 ? (
                        <div className="py-12 text-center text-xs text-[#3B6E4C] bg-[#EBF4EC] border border-[#D5E8D7] rounded-xs flex flex-col items-center gap-2">
                          <span className="material-symbols-outlined text-4xl">check_circle</span>
                          <strong className="text-sm">
                            Nenhum componente produzido (Tipo P) faltante para os locais marcados!
                          </strong>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {gruposPorFabricaComp.map((grp) => {
                            const fabComp = grp.fabrica_componente;
                            const itensFab = grp.itens;
                            const chaveFab = `__FAB_COMP__${fabComp}`;
                            const expandido = Boolean(gruposExpandidos[chaveFab]);
                            const limiteFab = expandido ? itensFab.length : 50;
                            const itensVisiveisFab = itensFab.slice(0, limiteFab);

                            return (
                              <div
                                key={chaveFab}
                                className="border border-[#E8E8E8] rounded-xs bg-white overflow-hidden shadow-lider"
                              >
                                {/* Ribbon do Grupo */}
                                <div className="px-5 py-3 bg-white border-b border-[#F0F0F0] flex flex-wrap items-center justify-between gap-3">
                                  <div className="flex flex-wrap items-center gap-2.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        exportarTabelaMatrizComoImagem({
                                          tituloPrincipal: `FALTANTES PRODUZIDOS — FÁBRICA: ${fabComp}`,
                                          subtitulo: `Local de Produção do Componente: ${fabComp}`,
                                          itens: itensFab,
                                          prazosCols,
                                          nomeArquivoBase: `fabrica_${fabComp}`,
                                        })
                                      }
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#D4D4D4] rounded-xs text-[#1A1A1A] hover:bg-[#F8F8F8] transition cursor-pointer"
                                      title={`Gerar imagem (.png) da tabela da fábrica ${fabComp}`}
                                    >
                                      <svg className="w-3.5 h-3.5 text-[#757575]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"></path>
                                      </svg>
                                      <span>Gerar Imagem (.png)</span>
                                    </button>

                                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#FBF7F4] border border-[#8B5A2B]/30 rounded-xs">
                                      <span className="text-xs text-[#8B5A2B] font-medium flex items-center gap-1">
                                        <span>🏭</span> Local de Produção do Componente: <strong>{fabComp}</strong>
                                      </span>
                                      <span className="text-[10px] bg-white text-[#8B5A2B] px-1.5 py-0.5 rounded-xs border border-[#8B5A2B]/20 font-mono">
                                        {itensFab.length} componente(s)
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                                    {prazosCols.map((colP) => {
                                      const subP = grp.somas_por_prazo?.[colP.key] || 0;
                                      return (
                                        <span
                                          key={colP.key}
                                          className="px-2 py-1 bg-[#F8F8F8] text-[#555] rounded-xs border border-[#E8E8E8]"
                                        >
                                          {colP.label}: <strong className="text-[#1A1A1A]">{formatarQtd(subP)}</strong>
                                        </span>
                                      );
                                    })}
                                    <span className="px-2 py-1 bg-[#FBF7F4] text-[#8B5A2B] rounded-xs border border-[#8B5A2B]/30 font-medium">
                                      Total: <strong>{formatarQtd(grp.falta_total_grupo)}</strong>
                                    </span>
                                  </div>
                                </div>

                                {/* Pivot table */}
                                <div
                                  tabIndex={0}
                                  role="region"
                                  aria-label={`Tabela de componentes produzidos faltantes da fábrica ${fabComp}`}
                                  className="overflow-auto max-h-[min(480px,62vh)] relative focus:outline-none"
                                >
                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead className="sticky top-0 z-10 bg-[#F8F8F8] text-[#757575] font-medium tracking-wide">
                                      <tr className="border-b border-[#E8E8E8]">
                                        <th
                                          scope="col"
                                          className="py-3 px-4 w-44 font-normal bg-[#F8F8F8] sticky left-0 z-20"
                                        >
                                          Componente
                                        </th>
                                        <th scope="col" className="py-3 px-4 font-normal bg-[#F8F8F8]">
                                          Descrição
                                        </th>
                                        {prazosCols.map((colP) => (
                                          <th
                                            key={colP.key}
                                            scope="col"
                                            className="py-3 px-4 text-right font-normal w-40 whitespace-nowrap border-l border-[#E8E8E8]"
                                          >
                                            {colP.label}
                                          </th>
                                        ))}
                                        <th
                                          scope="col"
                                          className="py-3 px-4 text-right font-normal w-40 text-[#8B5A2B] bg-[#FBF7F4]/60 whitespace-nowrap border-l border-[#E8DFD5]"
                                        >
                                          Total Faltante
                                        </th>
                                      </tr>

                                      {/* Subtotal Row */}
                                      <tr className="bg-[#F4F4F4] border-b-2 border-[#E0E0E0] font-medium text-[#1A1A1A] font-mono text-xs">
                                        <th
                                          scope="row"
                                          className="py-2.5 px-4 font-semibold text-[11px] tracking-wider uppercase bg-[#F4F4F4] sticky left-0 z-20"
                                        >
                                          SUBTOTAL
                                        </th>
                                        <td className="py-2.5 px-4 text-[11px] text-[#666]">
                                          SUBTOTAL POR PRAZO DE ENTREGA ({itensFab.length} ITENS)
                                        </td>
                                        {prazosCols.map((colP) => (
                                          <td
                                            key={colP.key}
                                            className="py-2.5 px-4 text-right border-l border-[#E0E0E0]"
                                          >
                                            {formatarQtd(grp.somas_por_prazo?.[colP.key] || 0)}
                                          </td>
                                        ))}
                                        <td className="py-2.5 px-4 text-right font-semibold text-[#8B5A2B] bg-[#FBF7F4] border-l border-[#E8DFD5]">
                                          {formatarQtd(grp.falta_total_grupo)}
                                        </td>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#EFEFEF] font-mono text-[11px]">
                                      {itensVisiveisFab.map((comp, cIdx) => (
                                        <tr
                                          key={`${comp.item}_${cIdx}`}
                                          className="hover:bg-[#FAFAFA] transition"
                                        >
                                          <th
                                            scope="row"
                                            className="py-3 px-4 font-medium text-[#1A1A1A] bg-white sticky left-0 z-10 whitespace-nowrap text-left"
                                          >
                                            {comp.item}
                                          </th>
                                          <td
                                            className="py-3 px-4 font-sans text-xs text-[#555] max-w-[360px] truncate"
                                            title={comp.descricao}
                                          >
                                            {comp.descricao || "-"}
                                          </td>
                                          {prazosCols.map((colP) => {
                                            const valPrazo = comp.falta_por_prazo?.[colP.key] || 0;
                                            return (
                                              <td
                                                key={colP.key}
                                                className={`py-3 px-4 text-right border-l border-[#EFEFEF] ${
                                                  valPrazo > 0
                                                    ? "text-[#1A1A1A] font-medium"
                                                    : "text-[#A0A0A0]"
                                                }`}
                                              >
                                                {valPrazo > 0 ? formatarQtd(valPrazo) : "-"}
                                              </td>
                                            );
                                          })}
                                          <td className="py-3 px-4 text-right font-medium text-[#8B5A2B] bg-[#FBF7F4]/40 border-l border-[#E8DFD5]">
                                            {formatarQtd(comp.falta_total)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>

                                {itensFab.length > limiteFab && (
                                  <div className="p-2.5 bg-[#FAFAFA] border-t border-[#E8E8E8] text-center">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setGruposExpandidos((prev) => ({
                                          ...prev,
                                          [chaveFab]: true,
                                        }))
                                      }
                                      className="text-xs font-semibold text-[#8B5A2B] hover:underline cursor-pointer"
                                    >
                                      Ver todos os {itensFab.length} componentes desta fábrica
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </div>

          {/* Rodapé da Matriz Pivot */}
          <footer className="px-8 py-4 border-t border-[#E8E8E8] bg-white flex items-center justify-between">
            <span className="text-[11px] text-[#757575]">
              {matrizDados
                ? `${(matrizDados.totais_gerais?.total_componentes_distintos || 0).toLocaleString("pt-BR")} componente(s) único(s) • Agrupado por Local de Produção do Componente`
                : ""}
            </span>
            <button
              type="button"
              onClick={fecharMatrizFaltantes}
              className="px-5 py-2 rounded-xs bg-[#1A1A1A] text-white text-xs font-medium hover:bg-black transition-colors cursor-pointer"
            >
              Fechar Matriz
            </button>
          </footer>
        </div>
      </dialog>
    </div>
  );
}
