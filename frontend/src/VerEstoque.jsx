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
      { prazo: 3, key: "3", label: "MG e franquia" },
      { prazo: 8, key: "8", label: "Fora de MG" },
      { prazo: 10, key: "10", label: "Revenda e Nordeste" },
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
              { prazo: 3, key: "3", label: "MG e franquia" },
              { prazo: 8, key: "8", label: "Fora de MG" },
              { prazo: 10, key: "10", label: "Revenda e Nordeste" },
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

      itens.forEach((row, idx) => {
        const yRow = yHead + tableHeaderH + idx * rowH;
        const bgBase = idx % 2 === 0 ? "#FFFFFF" : "#FAFAFA";

        subtotalFaltaGeral += Number(row.falta_total || 0);
        colsPrazoEfetivas.forEach((colP) => {
          subtotaisPrazo[colP.key] =
            (subtotaisPrazo[colP.key] || 0) + Number(row.falta_por_prazo?.[colP.key] || 0);
        });

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

      // Linha final de SUBTOTAL POR PRAZO DE ENTREGA (tfoot)
      const yFoot = yHead + tableHeaderH + itens.length * rowH;
      let xFoot = padX;
      const idxFimAntesPrazos = 2; // Componente + Descrição
      const larguraBlocoLabel = colunas
        .slice(0, idxFimAntesPrazos)
        .reduce((acc, c) => acc + c.width, 0);

      // Célula mesclada do rótulo "SUBTOTAL POR PRAZO DE ENTREGA"
      ctx.fillStyle = "#ECEFF1";
      ctx.fillRect(xFoot, yFoot, larguraBlocoLabel, footerH);
      ctx.strokeStyle = "#B0BEC5";
      ctx.lineWidth = 1;
      ctx.strokeRect(xFoot, yFoot, larguraBlocoLabel, footerH);

      ctx.fillStyle = "#1A1A1A";
      ctx.font = "bold 11px Inter, Segoe UI, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(
        `SUBTOTAL POR PRAZO DE ENTREGA (${itens.length} itens):`,
        xFoot + larguraBlocoLabel - 12,
        yFoot + footerH / 2
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
        ctx.fillRect(xFoot, yFoot, col.width, footerH);
        ctx.strokeStyle = "#B0BEC5";
        ctx.lineWidth = 1;
        ctx.strokeRect(xFoot, yFoot, col.width, footerH);

        if (textoSub) {
          ctx.fillStyle = txtColor;
          ctx.font = "bold 12px JetBrains Mono, Consolas, monospace";
          ctx.textAlign = "right";
          ctx.fillText(textoSub, xFoot + col.width - 10, yFoot + footerH / 2);
        }
        xFoot += col.width;
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
      <div className="space-y-5">
        {/* BLOCO 1: MATÉRIAS-PRIMAS (TIPO C) */}
        <section className="border border-[#E0E0E0] rounded-sm bg-white overflow-hidden shadow-2xs">
          <div className="px-4 py-2.5 bg-[#FFF8E1] border-b border-[#FFE082] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-[#8B5A2B]">
                inventory_2
              </span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#5D4037]">
                Matérias-Primas e Insumos Comprados (Tipo C)
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#8B5A2B] text-white">
                {materiasPrimas.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-white border border-[#FFE082] text-[#5D4037] font-medium">
                Com OC Aberta: <strong>{resumo.mp_com_oc || 0}</strong>/{materiasPrimas.length}
              </span>
              {(resumo.mp_vinculadas_pedido || 0) > 0 && (
                <span className="px-2 py-0.5 rounded bg-[#EEF2FF] border border-[#C7D2FE] text-[#312E81] font-semibold">
                  OC Vinculada ao Pedido: <strong>{resumo.mp_vinculadas_pedido}</strong>
                </span>
              )}
            </div>
          </div>

          {materiasPrimas.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#757575]">
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
                <thead className="sticky top-0 z-10 bg-[#FAFAFA] text-[#424242] font-semibold border-b border-[#E0E0E0] text-[11px] shadow-2xs">
                  <tr>
                    <th scope="col" className="p-2.5 bg-[#FAFAFA]">Matéria-Prima</th>
                    <th scope="col" className="p-2.5 bg-[#FAFAFA]">Descrição</th>
                    {exibirItensAfetados && (
                      <th scope="col" className="p-2.5 bg-[#FAFAFA]">Item(ns) do Pedido</th>
                    )}
                    <th scope="col" className="p-2.5 bg-[#FAFAFA] text-center">Baixa</th>
                    <th scope="col" className="p-2.5 bg-[#FAFAFA] text-right">Saldo Total Estoque</th>
                    <th scope="col" className="p-2.5 bg-[#FAFAFA] text-right">Saldo na Fila</th>
                    <th scope="col" className="p-2.5 bg-[#FAFAFA] text-right">Consumo</th>
                    {isAbaFaltando && (
                      <th scope="col" className="p-2.5 bg-[#FAFAFA] text-right font-bold text-[#C62828]">
                        Falta
                      </th>
                    )}
                    <th scope="col" className="p-2.5 bg-[#FAFAFA]">Ordem de Compra (OC)</th>
                    <th scope="col" className="p-2.5 bg-[#FAFAFA] text-center">Previsão OC</th>
                    <th
                      scope="col"
                      className="p-2.5 bg-[#FAFAFA] text-right"
                      title="Soma do saldo em OCs com previsão de entrega até a data de abertura da ordem"
                    >
                      Saldo OC até Abertura
                    </th>
                    <th scope="col" className="p-2.5 bg-[#FAFAFA]">Vínculo / Observação OC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEEEEE] tabular-nums">
                  {materiasPrimas.map((mp, idx) => (
                    <tr
                      key={`${mp.item}_${idx}`}
                      className={isAbaFaltando ? "hover:bg-[#FFFDF7]" : "hover:bg-[#F9FBF9]"}
                    >
                      <th scope="row" className="p-2.5 font-mono font-bold text-[#1A1A1A] whitespace-nowrap">
                        {mp.item}
                      </th>
                      <td
                        className="p-2.5 text-[#424242] max-w-[230px] truncate"
                        title={mp.descricao}
                      >
                        {mp.descricao || "-"}
                      </td>
                      {exibirItensAfetados && (
                        <td className="p-2.5">
                          <div className="flex flex-wrap gap-1 max-w-[210px]">
                            {(mp.itens_finais_afetados || []).map((af, aIdx) => (
                              <span
                                key={aIdx}
                                className="px-1.5 py-0.5 rounded bg-[#F5F5F5] border border-[#E0E0E0] font-mono text-[10px] text-[#333333]"
                                title={`Fila #${af.posicao_fila} • ${af.descricao || ""} • Consumo: ${formatarQtd(af.consumo)} • Falta: ${formatarQtd(af.falta)}`}
                              >
                                {af.item_final}
                              </span>
                            ))}
                          </div>
                        </td>
                      )}
                      <td className="p-2.5 text-center">
                        <span
                          className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                            mp.baixa === "S"
                              ? "bg-[#E8F5E9] text-[#2E7D32]"
                              : "bg-[#F2F2F2] text-[#757575]"
                          }`}
                        >
                          {mp.baixa || "-"}
                        </span>
                      </td>
                      <td
                        className="p-2.5 text-right font-mono font-semibold text-[#1A1A1A] bg-[#FAFAFA]"
                        title="Saldo total físico em estoque (Situação L)"
                      >
                        {formatarQtd(mp.estoque_total ?? mp.estoque_l)}
                      </td>
                      <td className="p-2.5 text-right font-mono text-[#424242]">
                        {formatarQtd(mp.saldo_fila)}
                      </td>
                      <td className="p-2.5 text-right font-mono font-medium">
                        {formatarQtd(mp.consumo)}
                      </td>
                      {isAbaFaltando && (
                        <td className="p-2.5 text-right font-mono font-bold text-[#C62828] bg-[#FFEBEE]/30">
                          {formatarQtd(mp.falta)}
                        </td>
                      )}
                      <td className="p-2.5 whitespace-nowrap">
                        {mp.oc_numero ? (
                          <div className="flex flex-col leading-tight gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-[#1A1A1A]">
                                OC #{mp.oc_numero}
                              </span>
                              {mp.oc_sit === "A" ? (
                                <span
                                  className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-[#FFF3E0] text-[#E65100] border border-[#FFE0B2]"
                                  title="OC em aberto (sit_oc=S / situação A)"
                                >
                                  Em Aberto (A)
                                </span>
                              ) : mp.oc_pedido_compra ? (
                                <span
                                  className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]"
                                  title={`Pedido de Compra no fornecedor #${mp.oc_pedido_compra}`}
                                >
                                  Ped.Compra #{mp.oc_pedido_compra}
                                </span>
                              ) : null}
                            </div>
                            <span className="text-[10px] text-[#666666]">
                              Qtd OC: <strong>{formatarQtd(mp.oc_saldo)}</strong>
                              {mp.oc_fornecedor
                                ? ` • ${mp.oc_fornecedor}`
                                : mp.oc_comprador
                                ? ` • Compr.: ${mp.oc_comprador}`
                                : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#FFEBEE] text-[#C62828]">
                            Sem OC aberta
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-center font-mono font-semibold whitespace-nowrap">
                        {mp.oc_previsao ? (
                          <span className="px-2 py-0.5 rounded bg-[#FFF8E1] border border-[#FFE082] text-[#5D4037]">
                            {mp.oc_previsao}
                          </span>
                        ) : (
                          <span className="text-[#9E9E9E]">-</span>
                        )}
                      </td>
                      <td
                        className="p-2.5 text-right whitespace-nowrap"
                        title={
                          mp.oc_data_abertura_ref
                            ? `Soma das OCs deste item com previsão <= ${mp.oc_data_abertura_ref} (Data de Abertura da Ordem)`
                            : "Data de abertura da ordem não informada"
                        }
                      >
                        <div className="flex flex-col items-end leading-tight gap-0.5">
                          <span
                            className={`px-2 py-0.5 rounded font-mono font-bold text-xs ${
                              (mp.oc_saldo_ate_abertura || 0) > 0
                                ? (mp.oc_saldo_ate_abertura || 0) >= (mp.falta || 0)
                                  ? "bg-[#E8F5E9] text-[#2E7D32] border border-[#A5D6A7]"
                                  : "bg-[#FFF8E1] text-[#E65100] border border-[#FFE082]"
                                : "bg-[#F5F5F5] text-[#757575] border border-[#E0E0E0]"
                            }`}
                          >
                            {formatarQtd(mp.oc_saldo_ate_abertura)}
                          </span>
                          <span className="text-[10px] text-[#666666]">
                            {mp.oc_data_abertura_ref ? (
                              <>
                                até <strong>{mp.oc_data_abertura_ref}</strong>
                              </>
                            ) : (
                              "Sem dt. abertura"
                            )}
                          </span>
                          {(mp.oc_saldo_total_item || 0) > (mp.oc_saldo_ate_abertura || 0) && (
                            <span
                              className="text-[9px] text-[#1565C0]"
                              title="Saldo total somando todas as OCs abertas deste item (incluindo previsões após a abertura da ordem)"
                            >
                              Total OC: {formatarQtd(mp.oc_saldo_total_item)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-2.5">
                        {mp.oc_numero ? (
                          mp.oc_vinculada_pedido ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded text-[10px] font-bold bg-[#EEF2FF] text-[#312E81] border border-[#C7D2FE]">
                                <span className="material-symbols-outlined text-[12px]">link</span>
                                Vinculada ao Pedido ({mp.oc_vinculo})
                              </span>
                              {mp.oc_texto && (
                                <span
                                  className="text-[10px] font-mono text-[#4338CA] max-w-[230px] truncate"
                                  title={mp.oc_texto}
                                >
                                  {mp.oc_texto}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded text-[10px] font-medium bg-[#F5F5F5] text-[#424242] border border-[#E0E0E0]">
                                Previsão mais antiga
                              </span>
                              {mp.oc_texto && (
                                <span
                                  className="text-[10px] text-[#757575] max-w-[230px] truncate"
                                  title={mp.oc_texto}
                                >
                                  {mp.oc_texto}
                                </span>
                              )}
                            </div>
                          )
                        ) : (
                          <span className="text-[10px] text-[#9E9E9E]">-</span>
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
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-[#1565C0]">
                precision_manufacturing
              </span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1565C0]">
                Componentes Produzidos Internamente (Tipo P) • Agrupados por Fábrica
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1565C0] text-white">
                {resumo.total_componentes || 0}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-[#E3F2FD] border border-[#90CAF9] text-[#0D47A1] font-medium">
                Fábricas Envolvidas: <strong>{componentesPorFabrica.length}</strong>
              </span>
              <span className="px-2 py-0.5 rounded bg-white border border-[#D5D5D5] text-[#424242] font-medium">
                Com OP Aberta: <strong>{resumo.comp_com_op || 0}</strong>/{resumo.total_componentes || 0}
              </span>
            </div>
          </div>

          {componentesPorFabrica.length === 0 ? (
            <div className="p-4 border border-[#E0E0E0] rounded-sm bg-white text-center text-xs text-[#757575]">
              {isAbaFaltando
                ? "✓ Nenhum componente produzido (Tipo P) em falta."
                : "Nenhum componente produzido neste filtro."}
            </div>
          ) : (
            <div className="space-y-3">
              {componentesPorFabrica.map((grupo) => (
                <div
                  key={grupo.fabrica}
                  className="border border-[#E0E0E0] rounded-sm bg-white overflow-hidden shadow-2xs"
                >
                  {/* Cabeçalho da Fábrica */}
                  <div className="px-4 py-2 bg-[#E3F2FD]/65 border-b border-[#BBDEFB] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-[#0D47A1]">
                        factory
                      </span>
                      <span className="text-xs font-bold text-[#0D47A1]">
                        Fábrica: {grupo.fabrica}
                      </span>
                      <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-[#0D47A1] text-white">
                        {grupo.total_itens} item(ns)
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px]">
                      {grupo.total_faltando > 0 && (
                        <span className="px-2 py-0.5 rounded bg-[#FFEBEE] text-[#C62828] font-semibold">
                          {grupo.total_faltando} em falta
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded bg-white border border-[#BBDEFB] text-[#0D47A1] font-medium">
                        OPs abertas: <strong>{grupo.total_com_op}</strong>/{grupo.total_itens}
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
                      <thead className="sticky top-0 z-10 bg-[#FAFAFA] text-[#424242] font-semibold border-b border-[#E0E0E0] text-[11px] shadow-2xs">
                        <tr>
                          <th scope="col" className="p-2.5 bg-[#FAFAFA]">Componente</th>
                          <th scope="col" className="p-2.5 bg-[#FAFAFA]">Descrição</th>
                          {exibirItensAfetados && (
                            <th scope="col" className="p-2.5 bg-[#FAFAFA]">Item(ns) do Pedido</th>
                          )}
                          <th scope="col" className="p-2.5 bg-[#FAFAFA] text-center">Baixa</th>
                          <th scope="col" className="p-2.5 bg-[#FAFAFA] text-right">Saldo Total Estoque</th>
                          <th scope="col" className="p-2.5 bg-[#FAFAFA] text-right">Saldo na Fila</th>
                          <th scope="col" className="p-2.5 bg-[#FAFAFA] text-right">Consumo</th>
                          {isAbaFaltando && (
                            <th scope="col" className="p-2.5 bg-[#FAFAFA] text-right font-bold text-[#C62828]">
                              Falta
                            </th>
                          )}
                          <th scope="col" className="p-2.5 bg-[#FAFAFA]">OP Componente</th>
                          <th scope="col" className="p-2.5 bg-[#FAFAFA] text-center">Abertura OP</th>
                          <th scope="col" className="p-2.5 bg-[#FAFAFA] text-center">Entrega OP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EEEEEE] tabular-nums">
                        {grupo.itens.map((comp, cIdx) => (
                          <tr
                            key={`${comp.item}_${cIdx}`}
                            className={isAbaFaltando ? "hover:bg-[#F5F9FF]" : "hover:bg-[#F9FBF9]"}
                          >
                            <th
                              scope="row"
                              className="p-2.5 font-mono font-bold text-[#1A1A1A] whitespace-nowrap"
                            >
                              {comp.item}
                            </th>
                            <td
                              className="p-2.5 text-[#424242] max-w-[230px] truncate"
                              title={comp.descricao}
                            >
                              {comp.descricao || "-"}
                            </td>
                            {exibirItensAfetados && (
                              <td className="p-2.5">
                                <div className="flex flex-wrap gap-1 max-w-[210px]">
                                  {(comp.itens_finais_afetados || []).map((af, aIdx) => (
                                    <span
                                      key={aIdx}
                                      className="px-1.5 py-0.5 rounded bg-[#F5F5F5] border border-[#E0E0E0] font-mono text-[10px] text-[#333333]"
                                      title={`Fila #${af.posicao_fila} • ${af.descricao || ""} • Consumo: ${formatarQtd(af.consumo)} • Falta: ${formatarQtd(af.falta)}`}
                                    >
                                      {af.item_final}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            )}
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
                            <td
                              className="p-2.5 text-right font-mono font-semibold text-[#1A1A1A] bg-[#FAFAFA]"
                              title="Saldo total físico em estoque (Situação L)"
                            >
                              {formatarQtd(comp.estoque_total ?? comp.estoque_l)}
                            </td>
                            <td className="p-2.5 text-right font-mono text-[#424242]">
                              {formatarQtd(comp.saldo_fila)}
                            </td>
                            <td className="p-2.5 text-right font-mono font-medium">
                              {formatarQtd(comp.consumo)}
                            </td>
                            {isAbaFaltando && (
                              <td className="p-2.5 text-right font-mono font-bold text-[#C62828] bg-[#FFEBEE]/30">
                                {formatarQtd(comp.falta)}
                              </td>
                            )}
                            <td className="p-2.5 whitespace-nowrap">
                              {comp.ordem_prod ? (
                                <div className="flex flex-col leading-tight">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-[#0D47A1]">
                                      OP #{comp.ordem_prod}
                                    </span>
                                    <span
                                      className={`px-1.5 py-0.2 rounded text-[9px] font-semibold ${
                                        comp.op_vinculo === "PEDIDO"
                                          ? "bg-[#EEF2FF] text-[#312E81] border border-[#C7D2FE]"
                                          : "bg-[#F5F5F5] text-[#666666] border border-[#E0E0E0]"
                                      }`}
                                    >
                                      {comp.op_vinculo === "PEDIDO" ? "Pedido" : "Lote"}
                                    </span>
                                  </div>
                                  {comp.op_saldo > 0 && (
                                    <span className="text-[10px] text-[#666666]">
                                      Saldo OP: <strong>{formatarQtd(comp.op_saldo)}</strong>
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#FFEBEE] text-[#C62828]">
                                  Sem OP aberta
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 text-center font-mono whitespace-nowrap">
                              {comp.op_data_abertura ? (
                                <span className="px-2 py-0.5 rounded bg-[#F5F5F5] border border-[#E0E0E0] text-[#1A1A1A] font-medium">
                                  {comp.op_data_abertura}
                                </span>
                              ) : (
                                <span className="text-[#9E9E9E]">-</span>
                              )}
                            </td>
                            <td className="p-2.5 text-center font-mono whitespace-nowrap">
                              {comp.op_data_entrega ? (
                                <span className="px-2 py-0.5 rounded bg-[#E3F2FD] border border-[#90CAF9] text-[#0D47A1] font-semibold">
                                  {comp.op_data_entrega}
                                </span>
                              ) : (
                                <span className="text-[#9E9E9E]">-</span>
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
          {sessionId && (
            <div
              className="hidden lg:flex items-center gap-2 px-2.5 py-1 bg-[#EEF2FF] border border-[#C7D2FE] rounded-sm text-left shadow-2xs"
              title={`Sessão isolada via cookie no navegador\nID: ${sessionId}\nExecuções e simulações são mantidas exclusivamente neste navegador.`}
            >
              <span className="material-symbols-outlined text-[16px] text-[#4F46E5]">
                shield
              </span>
              <div className="flex flex-col leading-none">
                <span className="text-[9px] font-semibold text-[#4338CA] uppercase tracking-wider">
                  Sessão Isolada
                </span>
                <span className="text-[11px] font-semibold text-[#312E81] font-mono mt-0.5">
                  {sessionId.slice(0, 8)}
                </span>
              </div>
            </div>
          )}

          {(dataCarga || dataCarregamento) && (
            <div
              className="hidden xl:flex items-center gap-2 px-2.5 py-1 bg-[#F9F9F9] border border-[#E0E0E0] rounded-sm text-left shadow-2xs"
              title={`Snapshot: ${snapshotNome || "ERP"}\nBase de dados ERP: ${dataCarga}\nProcessado em memória: ${dataCarregamento || dataCarga}\nServidor: 366n:8001`}
            >
              <span className="material-symbols-outlined text-[16px] text-[#757575]">
                schedule
              </span>
              <div className="flex flex-col leading-none">
                <span className="text-[9px] font-semibold text-[#888888] uppercase tracking-wider">
                  Dados Carregados {snapshotNome ? `(${snapshotNome})` : ""}
                </span>
                <span className="text-[11px] font-semibold text-[#1A1A1A] font-mono mt-0.5">
                  {dataCarga || dataCarregamento}
                </span>
              </div>
            </div>
          )}

          {/* BOTÃO MATRIZ PIVOT DE COMPONENTES PRODUZIDOS FALTANTES */}
          <button
            onClick={abrirMatrizFaltantes}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-sm bg-[#0D47A1] text-white text-xs font-medium hover:bg-[#093170] transition-colors flex items-center gap-1.5 shadow-sm"
            title="Abrir Matriz Pivot de itens produzidos faltantes por Local do Item Pai × Local do Componente × Prazo de Expedição"
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">pivot_table_chart</span>
            <span>Faltas Produzidos (Matriz)</span>
          </button>

          {/* BOTÃO RESUMO GERENCIAL DO PEDIDO */}
          <button
            onClick={() => abrirResumoPedido(filtroPedido)}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-sm bg-[#8B5A2B] text-white text-xs font-medium hover:bg-[#6F4722] transition-colors flex items-center gap-1.5 shadow-sm"
            title="Abrir tela de resumo gerencial de um pedido: o que falta para resolver o pedido ou o item"
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">assignment_late</span>
            <span>Resumo do Pedido</span>
          </button>

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
      <main className="flex-1 flex flex-col px-6 py-3 w-full max-w-[95%] mx-auto min-h-0 overflow-hidden space-y-2.5">
        {/* CARDS DE RESUMO (COMPACTOS E FIXOS) */}
        <section className="shrink-0 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-white p-2.5 rounded-sm border border-[#E0E0E0] shadow-xs">
            <span className="text-[10px] font-semibold text-[#757575] uppercase tracking-wider block">
              Total de Ordens
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
            <span className="text-[10px] font-semibold text-[#1565C0] uppercase tracking-wider block items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">inventory_2</span>
              Saldo das ordens avalaidas
            </span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="text-xl font-bold text-[#1565C0]">
                {formatarQtd(metricas.total_itens_avaliados ?? 0)}
              </span>
              <span className="text-[11px] text-[#757575]">saldo pedido</span>
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-sm border border-[#E0E0E0] shadow-xs">
            <span className="text-[10px] font-semibold text-[#2E7D32] uppercase tracking-wider block items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">check_circle</span>
              100% Disponíveis na Fila
            </span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="text-xl font-bold text-[#2E7D32]">
                {metricas.total_disponiveis.toLocaleString("pt-BR")}
              </span>
              <span className="text-[11px] text-[#2E7D32] font-medium">
                {metricas.total_itens_finais > 0
                  ? formatarPerc((metricas.total_disponiveis / metricas.total_itens_finais) * 100)
                  : "0%"}
              </span>
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-sm border border-[#E0E0E0] shadow-xs">
            <span className="text-[10px] font-semibold text-[#C62828] uppercase tracking-wider block items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">warning</span>
              Com Componentes Faltando
            </span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="text-xl font-bold text-[#C62828]">
                {metricas.total_com_falta.toLocaleString("pt-BR")}
              </span>
              <span className="text-[11px] text-[#C62828] font-medium">
                {metricas.total_itens_finais > 0
                  ? formatarPerc((metricas.total_com_falta / metricas.total_itens_finais) * 100)
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
                  {renderColumnHeader("entrega", "Entrega Pedido", "min-w-[95px]", "center")}
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
                            {it.pedido ? (
                              <button
                                type="button"
                                onClick={() => abrirResumoPedido(it.pedido, "TODOS")}
                                className="px-1.5 py-0.5 rounded hover:bg-[#FFF8E1] hover:text-[#8B5A2B] border border-transparent hover:border-[#FFE082] transition-colors inline-flex items-center gap-1"
                                title={`Abrir Resumo Gerencial do Pedido #${it.pedido}`}
                              >
                                <span>{it.pedido}</span>
                                <span className="material-symbols-outlined text-[12px] opacity-65">
                                  open_in_new
                                </span>
                              </button>
                            ) : (
                              "-"
                            )}
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
                            {formatarQtd(it.saldo)}
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
                                <span className="font-semibold">{formatarPerc(it.perc_disponivel)}</span>
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
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => abrirDetalhes(it)}
                                className="px-2 py-1 text-xs font-medium rounded-sm border border-[#D5D5D5] bg-white text-[#1A1A1A] hover:bg-[#F2F2F2] transition-colors inline-flex items-center gap-1 shadow-xs"
                                title="Ver insumos deste item final (separados em Matéria-Prima e Componentes por Fábrica)"
                              >
                                <span className="material-symbols-outlined text-[14px]">visibility</span>
                                <span>Ver Insumos</span>
                              </button>
                              {it.pedido && (
                                <button
                                  type="button"
                                  onClick={() => abrirResumoPedido(it.pedido, "TODOS")}
                                  className="px-2 py-1 text-xs font-medium rounded-sm border border-[#D7CCC8] bg-[#FFF8E1]/70 text-[#5D4037] hover:bg-[#FFE082]/60 transition-colors inline-flex items-center gap-1 shadow-xs"
                                  title={`Resumo Gerencial do Pedido #${it.pedido}: o que falta para resolver o pedido ou o item`}
                                >
                                  <span className="material-symbols-outlined text-[14px]">
                                    assignment
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

      {/* MODAL DE DETALHES DO ITEM FINAL (ORGANIZADO EM MATÉRIA-PRIMA E COMPONENTES POR FÁBRICA) */}
      {itemSelecionado && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-90% rounded-sm shadow-2xl flex flex-col max-h-[92vh] border border-[#E0E0E0] animate-fade-in">
            {/* Header do Modal */}
            <div className="p-5 border-b border-[#E0E0E0] flex items-start justify-between bg-[#FAFAFA] gap-4">
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
                    Saldo: <strong className="text-[#1A1A1A]">{formatarQtd(itemSelecionado.saldo)}</strong>
                  </span>
                  <span>
                    Entrega:{" "}
                    <strong className="text-[#1A1A1A] font-mono">
                      {itemSelecionado.entrega || "-"}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {itemSelecionado.pedido && (
                  <button
                    type="button"
                    onClick={() => {
                      const ped = itemSelecionado.pedido;
                      fecharDetalhes();
                      abrirResumoPedido(ped, "TODOS");
                    }}
                    className="px-3 py-1.5 rounded-sm bg-[#8B5A2B] text-white text-xs font-semibold hover:bg-[#6F4722] transition-colors flex items-center gap-1.5 shadow-xs"
                    title="Abrir tela de resumo gerencial para o pedido completo"
                  >
                    <span className="material-symbols-outlined text-[15px]">assignment</span>
                    <span>Resumo do Pedido #{itemSelecionado.pedido}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={fecharDetalhes}
                  className="text-[#757575] hover:text-[#1A1A1A] p-1.5 rounded-sm hover:bg-[#F2F2F2] transition-colors"
                  title="Fechar"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
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
                  <span>O que falta para o item ({detalhesItem?.total_faltando || 0})</span>
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
                      Matéria-Prima (C)
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
                      Componente (P)
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Conteúdo Gerencial do Modal (Separado em Matéria-Prima e Componentes por Fábrica) */}
            <div className="p-5 overflow-y-auto flex-1 bg-[#F9F9F9]">
              {carregandoDetalhes ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-[#757575]">
                  <span className="material-symbols-outlined text-3xl animate-spin text-[#1A1A1A]">
                    progress_activity
                  </span>
                  <span className="text-xs">
                    Carregando insumos, saldos de estoque, OPs de componentes e OCs...
                  </span>
                </div>
              ) : !detalhesItem ? (
                <div className="py-8 text-center text-xs text-[#757575]">
                  Dados não disponíveis.
                </div>
              ) : abaDetalhe === "faltando" ? (
                renderSecaoGerencial(detalhesItem.gerencial_faltando, true, false)
              ) : (
                renderSecaoGerencial(detalhesItem.gerencial_disponiveis, false, false)
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

      {/* MODAL NATIVO <dialog> DE RESUMO GERENCIAL DO PEDIDO ("O QUE FALTA PARA RESOLVER O PEDIDO OU O ITEM") */}
      <dialog
        ref={resumoDialogRef}
        aria-labelledby={resumoDialogTitleId}
        className="w-full max-w-80% rounded-sm shadow-2xl border border-[#E0E0E0] p-0 bg-white text-[#1A1A1A] m-auto"
      >
        <div className="flex flex-col max-h-[92vh]">
          {/* Cabeçalho do Resumo Gerencial com Busca de Pedido */}
          <div className="px-5 py-4 border-b border-[#E0E0E0] bg-[#FAFAFA] flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-[#8B5A2B]">
                  assignment_late
                </span>
                <h2 id={resumoDialogTitleId} className="text-sm font-bold text-[#1A1A1A]">
                  Resumo Gerencial do Pedido — O que falta para resolver o pedido ou o item
                </h2>
              </div>
              <p className="text-[11px] text-[#666666]">
                Visão consolidada separada por Matéria-Prima (previsão de OC) e Componentes agrupados por Fábrica (abertura e entrega de OP).
              </p>
            </div>

            {/* Busca rápida de Pedido dentro da tela de resumo */}
            <div className="flex items-center gap-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  carregarResumoPedido(resumoPedidoInput, "TODOS", resumoBaixa, resumoTipo);
                }}
                className="flex items-center gap-1.5"
              >
                <label className="text-xs font-semibold text-[#424242]">Pedido:</label>
                <input
                  type="text"
                  value={resumoPedidoInput}
                  onChange={(e) => setResumoPedidoInput(e.target.value)}
                  placeholder="Ex: 205408"
                  className="w-32 px-2.5 py-1 text-xs font-mono font-bold bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#8B5A2B]"
                />
                <button
                  type="submit"
                  disabled={carregandoResumo}
                  className="px-3 py-1 text-xs font-semibold bg-[#8B5A2B] text-white rounded-sm hover:bg-[#6F4722] transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[15px]">search</span>
                  <span>Consultar</span>
                </button>
              </form>

              <button
                type="button"
                onClick={fecharResumoPedido}
                className="text-[#757575] hover:text-[#1A1A1A] p-1.5 rounded-sm hover:bg-[#EEEEEE] transition-colors"
                aria-label="Fechar resumo do pedido"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </div>

          {/* Corpo do Resumo do Pedido */}
          <div className="p-5 overflow-y-auto flex-1 space-y-4 bg-[#F9F9F9]">
            {erroResumo && (
              <div
                role="alert"
                className="p-3 rounded-sm bg-[#FFEBEE] border border-[#EF9A9A] text-[#C62828] text-xs flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{erroResumo}</span>
              </div>
            )}

            {carregandoResumo ? (
              <div className="py-16 flex flex-col items-center justify-center gap-2 text-[#757575]">
                <span className="material-symbols-outlined text-3xl animate-spin text-[#8B5A2B]">
                  progress_activity
                </span>
                <span className="text-xs">
                  Consolidando itens do pedido, estoque total, OPs por fábrica e previsões de OC...
                </span>
              </div>
            ) : !resumoDados ? (
              <div className="py-12 text-center text-xs text-[#757575]">
                Informe o número de um pedido acima e clique em <strong>Consultar</strong> para visualizar o resumo gerencial.
              </div>
            ) : (
              <>
                {/* FAIXA DE DADOS DO PEDIDO E KPIS EXECUTIVOS */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {/* Card 1: Dados do Pedido */}
                  <div className="bg-white p-3.5 rounded-sm border border-[#E0E0E0] shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#757575]">
                        Pedido #{resumoDados.pedido || "-"}
                      </span>
                      {resumoDados.status_pedido === "Disponível" ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E8F5E9] text-[#2E7D32]">
                          Pedido 100% Disponível
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFEBEE] text-[#C62828]">
                          {resumoDados.itens_pedido_com_falta} de {resumoDados.total_itens_pedido} item(ns) com falta
                        </span>
                      )}
                    </div>
                    <p
                      className="text-xs font-bold text-[#1A1A1A] truncate"
                      title={resumoDados.cliente}
                    >
                      Cliente: {resumoDados.cliente || "Não informado"}
                    </p>
                    <div className="flex flex-wrap gap-3 text-[11px] text-[#666666]">
                      <span>
                        Abertura:{" "}
                        <strong className="font-mono text-[#1A1A1A]">
                          {resumoDados.data_abertura || "-"}
                        </strong>
                      </span>
                      <span>
                        Entrega:{" "}
                        <strong className="font-mono text-[#1A1A1A]">
                          {resumoDados.entrega || "-"}
                        </strong>
                      </span>
                      <span>
                        Itens Finais:{" "}
                        <strong className="text-[#1A1A1A]">{resumoDados.total_itens_pedido}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Card 2: Pendências de Matéria-Prima (Compras) */}
                  <div className="bg-white p-3.5 rounded-sm border border-[#FFE082] shadow-2xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B5A2B] flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">inventory_2</span>
                        Matérias-Primas Faltantes (Tipo C)
                      </span>
                      <span className="text-lg font-bold text-[#8B5A2B] font-mono">
                        {resumoDados.gerencial_faltando?.resumo?.materias_primas_faltando || 0}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-[#5D4037] pt-1">
                      <span className="px-2 py-0.5 rounded bg-[#FFF8E1] border border-[#FFE082]">
                        Com OC aberta:{" "}
                        <strong>{resumoDados.gerencial_faltando?.resumo?.mp_com_oc || 0}</strong>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#EEF2FF] border border-[#C7D2FE] text-[#312E81]">
                        OC vinculada ao pedido:{" "}
                        <strong>
                          {resumoDados.gerencial_faltando?.resumo?.mp_vinculadas_pedido || 0}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Card 3: Pendências de Componentes por Fábrica (Produção) */}
                  <div className="bg-white p-3.5 rounded-sm border border-[#90CAF9] shadow-2xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#1565C0] flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">
                          precision_manufacturing
                        </span>
                        Componentes Faltantes (Tipo P)
                      </span>
                      <span className="text-lg font-bold text-[#1565C0] font-mono">
                        {resumoDados.gerencial_faltando?.resumo?.componentes_faltando || 0}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-[#0D47A1] pt-1">
                      <span className="px-2 py-0.5 rounded bg-[#E3F2FD] border border-[#90CAF9]">
                        Fábricas com pendência:{" "}
                        <strong>
                          {resumoDados.gerencial_faltando?.resumo?.total_fabricas || 0}
                        </strong>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white border border-[#BBDEFB]">
                        Com OP aberta:{" "}
                        <strong>{resumoDados.gerencial_faltando?.resumo?.comp_com_op || 0}</strong>
                      </span>
                    </div>
                  </div>
                </div>

                {/* SELETOR DE ESCOPO: RESOLVER O PEDIDO INTEIRO OU UM ITEM ESPECÍFICO DO PEDIDO */}
                <div className="bg-white p-3 rounded-sm border border-[#E0E0E0] shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#424242]">
                      Escopo da Análise — Selecione o Pedido Completo ou um Item do Pedido:
                    </span>
                    <span className="text-[11px] text-[#757575]">
                      {resumoItemEscopo === "TODOS"
                        ? `Exibindo consolidado de todos os ${resumoDados.total_itens_pedido} itens do pedido`
                        : `Filtrado para o item ${resumoItemEscopo}`}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        carregarResumoPedido(resumoDados.pedido, "TODOS", resumoBaixa, resumoTipo)
                      }
                      className={`px-3 py-1.5 rounded-sm text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                        resumoItemEscopo === "TODOS"
                          ? "bg-[#222222] text-white border-[#222222]"
                          : "bg-[#FAFAFA] text-[#424242] border-[#D5D5D5] hover:bg-[#F0F0F0]"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">layers</span>
                      <span>Pedido Completo ({resumoDados.total_itens_pedido} itens)</span>
                    </button>

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
                          className={`px-2.5 py-1.5 rounded-sm text-xs border transition-colors flex items-center gap-1.5 ${
                            selecionado
                              ? "bg-[#8B5A2B] text-white border-[#8B5A2B] font-bold"
                              : disp
                              ? "bg-white text-[#2E7D32] border-[#C8E6C9] hover:bg-[#E8F5E9]/40"
                              : "bg-white text-[#C62828] border-[#FFCDD2] hover:bg-[#FFEBEE]/40"
                          }`}
                        >
                          <span className="font-mono text-[10px] opacity-80">
                            #{itPed.posicao_fila}
                          </span>
                          <span className="font-mono">{itPed.item_final}</span>
                          <span
                            className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                              selecionado
                                ? "bg-white/20 text-white"
                                : disp
                                ? "bg-[#E8F5E9] text-[#2E7D32]"
                                : "bg-[#FFEBEE] text-[#C62828]"
                            }`}
                          >
                            {disp ? "OK" : `Falta ${itPed.componentes_faltando}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* BARRA DE ABAS (O QUE FALTA RESOLVER vs DISPONÍVEIS) E FILTROS (BAIXA / ORIGEM) */}
                <div className="px-4 py-2 bg-white border border-[#E0E0E0] rounded-sm flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setAbaResumo("faltando")}
                      className={`py-1.5 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-colors ${
                        abaResumo === "faltando"
                          ? "border-[#C62828] text-[#C62828]"
                          : "border-transparent text-[#757575] hover:text-[#1A1A1A]"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">warning</span>
                      <span>
                        O que falta para resolver{" "}
                        {resumoItemEscopo === "TODOS" ? "o Pedido" : `o Item ${resumoItemEscopo}`}{" "}
                        ({resumoDados.total_faltando || 0})
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAbaResumo("disponiveis")}
                      className={`py-1.5 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-colors ${
                        abaResumo === "disponiveis"
                          ? "border-[#2E7D32] text-[#2E7D32]"
                          : "border-transparent text-[#757575] hover:text-[#1A1A1A]"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      <span>Insumos já Disponíveis ({resumoDados.total_disponiveis || 0})</span>
                    </button>
                  </div>

                  {/* Filtros Baixa e Tipo do Resumo */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-[#666666]">Baixa:</span>
                      <div className="flex rounded-sm border border-[#D5D5D5] overflow-hidden text-[10px]">
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
                            className={`px-2 py-0.5 font-medium border-l first:border-l-0 border-[#D5D5D5] ${
                              resumoBaixa === bOpt
                                ? "bg-[#222222] text-white"
                                : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                            }`}
                          >
                            {bOpt === "todos" ? "Todas" : bOpt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-[#666666]">Tipo:</span>
                      <div className="flex rounded-sm border border-[#D5D5D5] overflow-hidden text-[10px]">
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
                            className={`px-2 py-0.5 font-medium border-l first:border-l-0 border-[#D5D5D5] ${
                              resumoTipo === tOpt.k
                                ? "bg-[#222222] text-white"
                                : "bg-white text-[#666666] hover:bg-[#F2F2F2]"
                            }`}
                          >
                            {tOpt.l}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

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
          <div className="px-5 py-3.5 border-t border-[#E0E0E0] bg-[#FAFAFA] flex items-center justify-between">
            <span className="text-[11px] text-[#757575]">
              {resumoDados
                ? `Pedido #${resumoDados.pedido || "-"} • ${resumoDados.total_insumos} insumo(s) avaliado(s) no escopo`
                : ""}
            </span>
            <button
              type="button"
              onClick={fecharResumoPedido}
              className="px-4 py-1.5 rounded-sm bg-[#222222] text-white text-xs font-medium hover:bg-black transition-colors"
            >
              Fechar Resumo
            </button>
          </div>
        </div>
      </dialog>

      {/* MODAL NATIVO <dialog> DE MATRIZ PIVOT DE COMPONENTES PRODUZIDOS FALTANTES */}
      <dialog
        ref={matrizDialogRef}
        aria-labelledby={matrizDialogTitleId}
        className="w-full max-w-[95%] rounded-sm shadow-2xl border border-[#E0E0E0] p-0 bg-white text-[#1A1A1A] m-auto"
      >
        <div className="flex flex-col max-h-[94vh]">
          {/* Cabeçalho da Matriz Pivot */}
          <div className="px-5 py-3.5 border-b border-[#E0E0E0] bg-[#FAFAFA] flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-[#0D47A1]">
                  pivot_table_chart
                </span>
                <h2 id={matrizDialogTitleId} className="text-sm font-bold text-[#1A1A1A]">
                  Matriz Pivot — Componentes Produzidos Faltantes por Local do Item Pai × Local do Componente × Prazo de Expedição
                </h2>
              </div>
              <p className="text-[11px] text-[#666666]">
                Agrupamento por fábrica do item final e fábrica do componente produzido (Tipo P), exibindo os saldos faltantes em colunas por prazo de expedição (calculado com base no Representante).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMatrizMenuAberto((prev) => !prev)}
                className={`px-3 py-1.5 rounded-sm text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                  matrizMenuAberto
                    ? "bg-[#E3F2FD] text-[#0D47A1] border-[#90CAF9]"
                    : "bg-white text-[#424242] border-[#D5D5D5] hover:bg-[#F2F2F2]"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">tune</span>
                <span>{matrizMenuAberto ? "Ocultar Menu de Filtros" : "Abrir Menu de Filtros"}</span>
              </button>

              <button
                type="button"
                onClick={handleExportarMatrizExcel}
                disabled={exportandoMatriz || carregandoMatriz || !matrizDados?.linhas_planas?.length}
                className="px-3.5 py-1.5 rounded-sm bg-[#222222] text-white text-xs font-medium hover:bg-black transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {exportandoMatriz ? "hourglass_top" : "download"}
                </span>
                <span>{exportandoMatriz ? "Exportando..." : "Exportar Matriz Excel"}</span>
              </button>

              <button
                type="button"
                onClick={fecharMatrizFaltantes}
                className="text-[#757575] hover:text-[#1A1A1A] p-1.5 rounded-sm hover:bg-[#EEEEEE] transition-colors"
                aria-label="Fechar matriz de componentes faltantes"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </div>

          {/* Corpo da Tela da Matriz Pivot */}
          <div className="p-5 overflow-y-auto flex-1 space-y-4 bg-[#F9F9F9]">
            {erroMatriz && (
              <div
                role="alert"
                className="p-3 rounded-sm bg-[#FFEBEE] border border-[#EF9A9A] text-[#C62828] text-xs flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{erroMatriz}</span>
              </div>
            )}

            {/* MENU DE OPÇÕES DE FILTROS PARA CÁLCULO */}
            {matrizMenuAberto && (
              <section className="bg-white border border-[#D5D5D5] rounded-sm p-4 shadow-2xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#EEEEEE]">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-[#0D47A1]">
                      checklist
                    </span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#1A1A1A]">
                      Menu de Opções de Filtros para Cálculo
                    </h3>
                  </div>
                  <span className="text-[11px] text-[#666666]">
                    Marque os locais desejados para compor o cálculo • Prazos de expedição trazem todos os disponíveis automaticamente
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* COLUNA 1: LOCAL DE PRODUÇÃO DO ITEM FINAL (PAI) */}
                  <div className="border border-[#E0E0E0] rounded-sm p-3 bg-[#FAFAFA] flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-[#1A1A1A] flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-[#0D47A1]">
                          domain
                        </span>
                        1. Local Produção do Item Final (Pai)
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-[#E3F2FD] text-[#0D47A1] text-[10px] font-bold">
                        {matrizLocaisPaiSel.length}/{opcoesMatriz.locais_item_final.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={matrizBuscaLocalPai}
                        onChange={(e) => setMatrizBuscaLocalPai(e.target.value)}
                        placeholder="Filtrar local do item final..."
                        className="flex-1 px-2 py-1 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#0D47A1]"
                      />
                      <button
                        type="button"
                        onClick={() => setMatrizLocaisPaiSel(opcoesMatriz.locais_item_final || [])}
                        className="px-2 py-1 text-[10px] font-semibold bg-white border border-[#D5D5D5] rounded-sm hover:bg-[#F0F0F0]"
                        title="Marcar todos os locais de produção do item final"
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        onClick={() => setMatrizLocaisPaiSel([])}
                        className="px-2 py-1 text-[10px] font-semibold bg-white border border-[#D5D5D5] rounded-sm hover:bg-[#FFEBEE] text-[#C62828]"
                        title="Desmarcar todos"
                      >
                        Limpar
                      </button>
                    </div>

                    <div className="max-h-36 overflow-y-auto bg-white border border-[#E0E0E0] rounded-sm p-2 grid grid-cols-2 gap-1.5">
                      {(opcoesMatriz.locais_item_final || [])
                        .filter((loc) =>
                          loc.toUpperCase().includes(matrizBuscaLocalPai.trim().toUpperCase())
                        )
                        .map((loc) => {
                          const checked = matrizLocaisPaiSel.includes(loc);
                          return (
                            <label
                              key={loc}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] cursor-pointer select-none border transition-colors ${
                                checked
                                  ? "bg-[#E3F2FD]/70 border-[#90CAF9] text-[#0D47A1] font-semibold"
                                  : "bg-white border-transparent hover:bg-[#F5F5F5] text-[#424242]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLocalPaiMatriz(loc)}
                                className="accent-[#0D47A1] rounded-xs"
                              />
                              <span className="truncate" title={loc}>
                                {loc}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                  </div>

                  {/* COLUNA 2: LOCAL DE PRODUÇÃO DO COMPONENTE PRODUZIDO */}
                  <div className="border border-[#E0E0E0] rounded-sm p-3 bg-[#FAFAFA] flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-[#1A1A1A] flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-[#8B5A2B]">
                          precision_manufacturing
                        </span>
                        2. Local do Componente Produzido (P)
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-[#FFF8E1] text-[#8B5A2B] border border-[#FFE082] text-[10px] font-bold">
                        {matrizLocaisCompSel.length}/{opcoesMatriz.locais_componente.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={matrizBuscaLocalComp}
                        onChange={(e) => setMatrizBuscaLocalComp(e.target.value)}
                        placeholder="Filtrar local do componente..."
                        className="flex-1 px-2 py-1 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#8B5A2B]"
                      />
                      <button
                        type="button"
                        onClick={() => setMatrizLocaisCompSel(opcoesMatriz.locais_componente || [])}
                        className="px-2 py-1 text-[10px] font-semibold bg-white border border-[#D5D5D5] rounded-sm hover:bg-[#F0F0F0]"
                        title="Marcar todos os locais de produção de componentes"
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        onClick={() => setMatrizLocaisCompSel([])}
                        className="px-2 py-1 text-[10px] font-semibold bg-white border border-[#D5D5D5] rounded-sm hover:bg-[#FFEBEE] text-[#C62828]"
                        title="Desmarcar todos"
                      >
                        Limpar
                      </button>
                    </div>

                    <div className="max-h-36 overflow-y-auto bg-white border border-[#E0E0E0] rounded-sm p-2 grid grid-cols-2 gap-1.5">
                      {(opcoesMatriz.locais_componente || [])
                        .filter((loc) =>
                          loc.toUpperCase().includes(matrizBuscaLocalComp.trim().toUpperCase())
                        )
                        .map((loc) => {
                          const checked = matrizLocaisCompSel.includes(loc);
                          return (
                            <label
                              key={loc}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] cursor-pointer select-none border transition-colors ${
                                checked
                                  ? "bg-[#FFF8E1] border-[#FFE082] text-[#5D4037] font-semibold"
                                  : "bg-white border-transparent hover:bg-[#F5F5F5] text-[#424242]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLocalCompMatriz(loc)}
                                className="accent-[#8B5A2B] rounded-xs"
                              />
                              <span className="truncate" title={loc}>
                                {loc}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                  </div>

                  {/* COLUNA 3: PRAZOS DE EXPEDIÇÃO E PARÂMETROS DE CÁLCULO */}
                  <div className="border border-[#E0E0E0] rounded-sm p-3 bg-[#FAFAFA] flex flex-col justify-between gap-2.5">
                    <div className="space-y-2.5">
                      <div>
                        <span className="text-[11px] font-bold text-[#1A1A1A] flex items-center gap-1 mb-1">
                          <span className="material-symbols-outlined text-[14px] text-[#2E7D32]">
                            local_shipping
                          </span>
                          3. Prazos de Expedição (Base Representante)
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5 p-2 bg-white border border-[#E0E0E0] rounded-sm">
                          {[
                            { key: "3", label: "MG e franquia" },
                            { key: "8", label: "Fora de MG" },
                            { key: "10", label: "Revenda e Nordeste" },
                          ].map((pCol) => (
                            <span
                              key={pCol.key}
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]"
                            >
                              ✓ {pCol.label}
                            </span>
                          ))}
                          <span className="text-[10px] text-[#666666] ml-1">
                            (Todos disponíveis incluídos nas colunas)
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {/* Modo de Abatimento do Estoque */}
                        <div className="flex flex-col">
                          <label className="text-[10px] font-semibold text-[#555555] mb-0.5">
                            Escopo de Abatimento
                          </label>
                          <select
                            value={matrizEscopoAbatimento}
                            onChange={(e) => setMatrizEscopoAbatimento(e.target.value)}
                            className="px-2 py-1 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#0D47A1]"
                            title="Fila Global: abate o estoque na fila completa e filtra os faltantes. Apenas Selecionados: abate o estoque exclusivamente entre os locais marcados."
                          >
                            <option value="global">Fila Global Completa</option>
                            <option value="filtrado">Apenas Locais Marcados</option>
                          </select>
                        </div>

                        {/* Baixa do Componente */}
                        <div className="flex flex-col">
                          <label className="text-[10px] font-semibold text-[#555555] mb-0.5">
                            Baixa Componente
                          </label>
                          <select
                            value={matrizBaixa}
                            onChange={(e) => setMatrizBaixa(e.target.value)}
                            className="px-2 py-1 text-xs bg-white border border-[#D5D5D5] rounded-sm focus:outline-none focus:border-[#0D47A1]"
                          >
                            <option value="todos">Todas (S e N)</option>
                            <option value="S">Apenas Baixa Sim (S)</option>
                            <option value="N">Apenas Baixa Não (N)</option>
                          </select>
                        </div>
                      </div>

                      {/* Janela de Entrega do Pedido */}
                      <div className="flex flex-col">
                        <label
                          className="text-[10px] font-semibold text-[#555555] mb-0.5"
                          title="Filtra os itens pais pela data de Entrega do Pedido"
                        >
                          Entrega do Pedido (Opcional)
                        </label>
                        <div className="flex items-center gap-1 bg-white border border-[#D5D5D5] rounded-sm px-2 py-0.5">
                          <input
                            type="date"
                            value={matrizDataInicio}
                            onChange={(e) => setMatrizDataInicio(e.target.value)}
                            className="text-xs bg-transparent focus:outline-none flex-1"
                            title="Data inicial de Entrega do Pedido"
                          />
                          <span className="text-[10px] text-[#757575]">até</span>
                          <input
                            type="date"
                            value={matrizDataFim}
                            onChange={(e) => setMatrizDataFim(e.target.value)}
                            className="text-xs bg-transparent focus:outline-none flex-1"
                            title="Data final de Entrega do Pedido"
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => carregarMatrizFaltantes()}
                      disabled={carregandoMatriz}
                      className="w-full py-2 px-4 rounded-sm bg-[#0D47A1] text-white text-xs font-bold hover:bg-[#093170] transition-colors flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-60"
                    >
                      <span
                        className={`material-symbols-outlined text-[16px] ${
                          carregandoMatriz ? "animate-spin" : ""
                        }`}
                      >
                        {carregandoMatriz ? "progress_activity" : "calculate"}
                      </span>
                      <span>
                        {carregandoMatriz
                          ? "Calculando Matriz Pivot..."
                          : "Calcular / Atualizar Matriz Pivot"}
                      </span>
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* CONTEÚDO DOS RESULTADOS DA MATRIZ PIVOT */}
            {carregandoMatriz ? (
              <div className="py-16 flex flex-col items-center justify-center gap-2 text-[#757575] bg-white border border-[#E0E0E0] rounded-sm">
                <span className="material-symbols-outlined text-3xl animate-spin text-[#0D47A1]">
                  progress_activity
                </span>
                <span className="text-xs font-medium">
                  Calculando itens produzidos faltantes por Local do Item Pai × Local do Componente × Prazo de Expedição...
                </span>
              </div>
            ) : !matrizDados ? (
              <div className="py-12 text-center text-xs text-[#757575] bg-white border border-[#E0E0E0] rounded-sm">
                Marque os filtros desejados acima e clique em <strong>Calcular / Atualizar Matriz Pivot</strong>.
              </div>
            ) : (
              <>
                {(() => {
                  const prazosCols = [
                    { prazo: 3, key: "3", label: "MG e franquia" },
                    { prazo: 8, key: "8", label: "Fora de MG" },
                    { prazo: 10, key: "10", label: "Revenda e Nordeste" },
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
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                        <div className="bg-white p-3 rounded-sm border border-[#E0E0E0] shadow-2xs">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#666666] block">
                            Fábricas de Componente
                          </span>
                          <div className="flex items-baseline justify-between mt-1">
                            <span className="text-lg font-bold text-[#1A1A1A] font-mono">
                              {gruposPorFabricaComp.length.toLocaleString("pt-BR")}
                            </span>
                            <span className="text-[10px] text-[#757575]">
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
                              className="bg-white p-3 rounded-sm border border-[#90CAF9] shadow-2xs"
                            >
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[#0D47A1] flex items-center gap-1">
                                <span className="material-symbols-outlined text-[13px]">
                                  local_shipping
                                </span>
                                {colP.label}
                              </span>
                              <div className="flex items-baseline justify-between mt-1">
                                <span className="text-lg font-bold text-[#0D47A1] font-mono">
                                  {formatarQtd(valorPrazo)}
                                </span>
                                <span className="text-[10px] text-[#666666]">peças</span>
                              </div>
                            </div>
                          );
                        })}

                        <div className="bg-[#FFEBEE]/50 p-3 rounded-sm border border-[#EF9A9A] shadow-2xs">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#C62828] block">
                            Total Faltante Geral
                          </span>
                          <div className="flex items-baseline justify-between mt-1">
                            <span className="text-lg font-bold text-[#C62828] font-mono">
                              {formatarQtd(matrizDados.totais_gerais?.soma_falta_geral || 0)}
                            </span>
                            <span className="text-[10px] text-[#C62828] font-semibold">
                              {(
                                matrizDados.totais_gerais?.total_pedidos_afetados || 0
                              ).toLocaleString("pt-BR")}{" "}
                              pedidos
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* BARRA DE BUSCA RÁPIDA */}
                      <div className="bg-white px-4 py-2.5 rounded-sm border border-[#E0E0E0] flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                          <span className="material-symbols-outlined text-[18px] text-[#757575]">
                            search
                          </span>
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
                            className="flex-1 px-2.5 py-1 text-xs bg-[#FAFAFA] border border-[#D5D5D5] rounded-sm focus:outline-none focus:bg-white focus:border-[#0D47A1]"
                          />
                          {matrizBuscaItem && (
                            <button
                              type="button"
                              onClick={() => {
                                setMatrizBuscaItem("");
                                carregarMatrizFaltantes({ busca: "" });
                              }}
                              className="text-xs text-[#C62828] hover:underline px-1.5"
                            >
                              Limpar
                            </button>
                          )}
                        </div>
                      </div>

                      {/* TABELAS AGRUPADAS APENAS POR LOCAL DE PRODUÇÃO DO COMPONENTE */}
                      {gruposPorFabricaComp.length === 0 ? (
                        <div className="py-12 text-center text-xs text-[#2E7D32] bg-[#E8F5E9]/30 border border-[#C8E6C9] rounded-sm flex flex-col items-center gap-2">
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
                                className="border border-[#D5D5D5] rounded-sm bg-white overflow-hidden shadow-2xs"
                              >
                                {/* Cabeçalho da Tabela por Local de Produção do Componente + Botão de Imagem na frente */}
                                <div className="px-4 py-2.5 bg-[#E3F2FD]/70 border-b border-[#BBDEFB] flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
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
                                      className="px-2.5 py-1 rounded-sm bg-[#0D47A1] text-white text-xs font-bold hover:bg-[#093170] transition-colors inline-flex items-center gap-1 shadow-2xs cursor-pointer"
                                      title={`Gerar imagem (.png) da tabela da fábrica ${fabComp}`}
                                    >
                                      <span className="material-symbols-outlined text-[15px]">
                                        photo_camera
                                      </span>
                                      <span>Gerar Imagem (.png)</span>
                                    </button>

                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-[#FFF8E1] text-[#5D4037] border border-[#FFE082] text-xs font-bold">
                                      <span className="material-symbols-outlined text-[14px]">
                                        precision_manufacturing
                                      </span>
                                      Local de Produção do Componente: {fabComp}
                                    </span>

                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white border border-[#90CAF9] text-[#0D47A1]">
                                      {itensFab.length} componente(s)
                                    </span>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    {prazosCols.map((colP) => {
                                      const subP = grp.somas_por_prazo?.[colP.key] || 0;
                                      return (
                                        <span
                                          key={colP.key}
                                          className="px-2 py-0.5 rounded bg-white border border-[#90CAF9] text-[#0D47A1] font-mono"
                                        >
                                          {colP.label}: <strong>{formatarQtd(subP)}</strong>
                                        </span>
                                      );
                                    })}
                                    <span className="px-2.5 py-0.5 rounded bg-[#FFEBEE] border border-[#EF9A9A] text-[#C62828] font-mono font-bold">
                                      Total: {formatarQtd(grp.falta_total_grupo)}
                                    </span>
                                  </div>
                                </div>

                                <div
                                  tabIndex={0}
                                  role="region"
                                  aria-label={`Tabela de componentes produzidos faltantes da fábrica ${fabComp}`}
                                  className="overflow-auto max-h-[min(480px,62vh)] relative focus:outline-none"
                                >
                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead className="sticky top-0 z-10 bg-[#FAFAFA] text-[#424242] font-semibold border-b border-[#E0E0E0] text-[11px] shadow-2xs">
                                      <tr>
                                        <th
                                          scope="col"
                                          className="p-2.5 bg-[#FAFAFA] sticky left-0 z-20 min-w-[150px]"
                                        >
                                          Componente
                                        </th>
                                        <th scope="col" className="p-2.5 bg-[#FAFAFA] min-w-[260px]">
                                          Descrição
                                        </th>
                                        {prazosCols.map((colP) => (
                                          <th
                                            key={colP.key}
                                            scope="col"
                                            className="p-2.5 bg-[#E3F2FD]/65 text-[#0D47A1] text-right font-bold whitespace-nowrap border-l border-[#BBDEFB] min-w-[130px]"
                                          >
                                            {colP.label}
                                          </th>
                                        ))}
                                        <th
                                          scope="col"
                                          className="p-2.5 bg-[#FFEBEE]/65 text-[#C62828] text-right font-bold whitespace-nowrap border-l border-[#FFCDD2] min-w-[130px]"
                                        >
                                          Total Faltante
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#EEEEEE] tabular-nums">
                                      {itensVisiveisFab.map((comp, cIdx) => (
                                        <tr
                                          key={`${comp.item}_${cIdx}`}
                                          className="hover:bg-[#F5F9FF]"
                                        >
                                          <th
                                            scope="row"
                                            className="p-2.5 font-mono font-bold text-[#1A1A1A] bg-white sticky left-0 z-10 whitespace-nowrap"
                                          >
                                            {comp.item}
                                          </th>
                                          <td
                                            className="p-2.5 text-[#424242] max-w-[360px] truncate"
                                            title={comp.descricao}
                                          >
                                            {comp.descricao || "-"}
                                          </td>
                                          {prazosCols.map((colP) => {
                                            const valPrazo = comp.falta_por_prazo?.[colP.key] || 0;
                                            return (
                                              <td
                                                key={colP.key}
                                                className={`p-2.5 text-right font-mono border-l border-[#EEEEEE] ${
                                                  valPrazo > 0
                                                    ? "font-bold text-[#0D47A1] bg-[#E3F2FD]/25"
                                                    : "text-[#BDBDBD]"
                                                }`}
                                              >
                                                {valPrazo > 0 ? formatarQtd(valPrazo) : "-"}
                                              </td>
                                            );
                                          })}
                                          <td className="p-2.5 text-right font-mono font-bold text-[#C62828] bg-[#FFEBEE]/35 border-l border-[#FFCDD2]">
                                            {formatarQtd(comp.falta_total)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot className="sticky bottom-0 z-10 bg-[#ECEFF1] border-t-2 border-[#B0BEC5] font-bold text-xs tabular-nums shadow-2xs">
                                      <tr>
                                        <td
                                          colSpan={2}
                                          className="p-2.5 text-right text-[#1A1A1A] uppercase tracking-wider text-[11px]"
                                        >
                                          Subtotal por Prazo de Entrega ({itensFab.length} itens):
                                        </td>
                                        {prazosCols.map((colP) => (
                                          <td
                                            key={colP.key}
                                            className="p-2.5 text-right font-mono font-bold text-[#0D47A1] bg-[#E3F2FD] border-l border-[#90CAF9]"
                                          >
                                            {formatarQtd(grp.somas_por_prazo?.[colP.key] || 0)}
                                          </td>
                                        ))}
                                        <td className="p-2.5 text-right font-mono font-bold text-[#B71C1C] bg-[#FFCDD2]/80 border-l border-[#EF9A9A]">
                                          {formatarQtd(grp.falta_total_grupo)}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>

                                {itensFab.length > limiteFab && (
                                  <div className="p-2 bg-[#FAFAFA] border-t border-[#EEEEEE] text-center">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setGruposExpandidos((prev) => ({
                                          ...prev,
                                          [chaveFab]: true,
                                        }))
                                      }
                                      className="text-xs font-semibold text-[#0D47A1] hover:underline"
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
          <div className="px-5 py-3 border-t border-[#E0E0E0] bg-[#FAFAFA] flex items-center justify-between">
            <span className="text-[11px] text-[#757575]">
              {matrizDados
                ? `${matrizDados.totais_gerais?.total_componentes_distintos || 0} componente(s) único(s) • Agrupado por Local de Produção do Componente`
                : ""}
            </span>
            <button
              type="button"
              onClick={fecharMatrizFaltantes}
              className="px-4 py-1.5 rounded-sm bg-[#222222] text-white text-xs font-medium hover:bg-black transition-colors"
            >
              Fechar Matriz
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
