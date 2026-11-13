import React, { useState, useEffect, useCallback, useRef, useId } from "react";
import { apiCall } from "./api";
import Sidebar from "./components/Sidebar";
import SimuladorModal from "./components/SimuladorModal";
import ModalFiltroFabricaLocal from "./components/ModalFiltroFabricaLocal";
import ModalFiltroFamiliaComponente from "./components/ModalFiltroFamiliaComponente";
import DisponibilidadeEstoque from "./screens/DisponibilidadeEstoque";
import MatrizFaltasProduzidos from "./screens/MatrizFaltasProduzidos";
import ResumoPedido from "./screens/ResumoPedido";
import ResumoFaltantes from "./screens/ResumoFaltantes";
import DetalhamentoInsumos from "./screens/DetalhamentoInsumos";
import {
  SESSION_USER_KEY,
  SESSION_PASS_KEY,
  criarLinhaPedidoVazia,
} from "./utils/formatters";

/**
 * Orquestrador Principal do Sistema Ver Estoque (Líder Design)
 * Gerencia o estado central da aplicação, comunicação com o backend (RPC),
 * e a navegação entre telas na área principal através da Sidebar persistente.
 */
export default function VerEstoque() {
  const tableId = useId();
  const simDialogTitleId = useId();
  const userFieldId = useId();
  const passFieldId = useId();

  const sentinelRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const simDialogRef = useRef(null);

  // Navegação da Área Principal
  // 'disponibilidade' | 'matriz' | 'resumo' | 'detalhes' | 'faltantes'
  const [telaAtiva, setTelaAtiva] = useState("disponibilidade");

  // Estados de dados da Disponibilidade de Estoque
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
  const [divisaoFabricas, setDivisaoFabricas] = useState(null);
  const [modalFiltroLocalAberto, setModalFiltroLocalAberto] = useState(false);
  const [modalFiltroFamiliaAberto, setModalFiltroFamiliaAberto] = useState(false);
  const [familiasComponentes3, setFamiliasComponentes3] = useState([]);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [dataCarga, setDataCarga] = useState("");
  const [snapshotNome, setSnapshotNome] = useState("");
  const [sessionId, setSessionId] = useState("");

  // Paginação contínua (Infinite Scroll)
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [exportando, setExportando] = useState(false);

  // Filtros Globais da Disponibilidade
  const [filtroLocal, setFiltroLocal] = useState([]);
  const [filtroPedido, setFiltroPedido] = useState("");
  const [filtroCodigo, setFiltroCodigo] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos"); // 'todos' | 'disponivel' | 'falta'
  const [filtroBaixa, setFiltroBaixa] = useState("todos"); // 'todos' | 'S' | 'N'
  const [filtroTipo, setFiltroTipo] = useState("todos"); // 'todos' | 'C' | 'P'
  const [filtroFamilias, setFiltroFamilias] = useState([]);
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");
  const [filtroTipoData, setFiltroTipoData] = useState("abertura_op"); // 'abertura_op' | 'entrega_pedido'
  const [filtroApenasSimulados, setFiltroApenasSimulados] = useState(false);

  // Filtros em Títulos de Colunas (Backend)
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

  // Tela de Detalhes de Insumos
  const [itemSelecionado, setItemSelecionado] = useState(null);
  const [detalhesItem, setDetalhesItem] = useState(null);
  const [carregandoDetalhes, setCarregandoDetalhes] = useState(false);
  const [abaDetalhe, setAbaDetalhe] = useState("faltando"); // 'faltando' | 'disponiveis'
  const [modalBaixa, setModalBaixa] = useState("todos"); // 'todos' | 'S' | 'N'
  const [modalTipo, setModalTipo] = useState("todos"); // 'todos' | 'C' | 'P'

  // Tela de Resumo do Pedido ("O que falta para resolver o pedido ou o item")
  const [resumoPedidoInput, setResumoPedidoInput] = useState("");
  const [resumoDados, setResumoDados] = useState(null);
  const [carregandoResumo, setCarregandoResumo] = useState(false);
  const [erroResumo, setErroResumo] = useState("");
  const [abaResumo, setAbaResumo] = useState("faltando"); // 'faltando' | 'disponiveis'
  const [resumoBaixa, setResumoBaixa] = useState("todos"); // 'todos' | 'S' | 'N'
  const [resumoTipo, setResumoTipo] = useState("todos"); // 'todos' | 'C' | 'P'
  const [resumoItemEscopo, setResumoItemEscopo] = useState("TODOS");

  // Tela de Itens Faltantes (resumo por local de produção e tipo) — filtros espelhados com a tela principal
  const [faltantesDados, setFaltantesDados] = useState(null);
  const [carregandoFaltantes, setCarregandoFaltantes] = useState(false);
  const [erroFaltantes, setErroFaltantes] = useState("");
  const [abaFaltantes, setAbaFaltantes] = useState("todos"); // 'todos' | 'P' | 'C'
  const [exportandoFaltantes, setExportandoFaltantes] = useState(false);
  const faltantesReqRef = useRef(0);

  // Tela de Matriz Pivot de Componentes Produzidos Faltantes
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
            familias: filtroFamilias,
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
        if (res.divisao_fabricas) setDivisaoFabricas(res.divisao_fabricas);
        if (Array.isArray(res.familias_componentes_3)) setFamiliasComponentes3(res.familias_componentes_3);
        if (res.data_carga) setDataCarga(res.data_carga);
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
      filtroFamilias,
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
    filtroFamilias,
    filtroApenasSimulados,
    filtroDataInicio,
    filtroDataFim,
    filtroTipoData,
    colFiltros,
  ]);

  // Infinite Scroll via IntersectionObserver (30 linhas antes do fim)
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

  // Listener de Scroll no container interno da tabela
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
        // Ignora caso sessionStorage esteja indisponível
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
          familias: filtroFamilias,
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

  // --- Ações da Tela de Detalhes de Insumos ---
  const carregarDetalhes = async (it, bFiltro = modalBaixa, tFiltro = modalTipo) => {
    setCarregandoDetalhes(true);
    try {
      const res = await apiCall("obter_detalhes_item_final", {
        item_final: it.item_final,
        pedido: it.pedido,
        fabrica: it.fabrica,
        baixa: bFiltro,
        tipo: tFiltro,
        familias: filtroFamilias,
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
    setTelaAtiva("detalhes");
    carregarDetalhes(it, baixaInicial, tipoInicial);
  };

  // --- Ações da Tela de Resumo do Pedido ---
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
        familias: filtroFamilias,
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
    setTelaAtiva("resumo");

    if (pedEfetivo || (itemEscopoInicial && itemEscopoInicial !== "TODOS")) {
      carregarResumoPedido(pedEfetivo, itemEscopoInicial || "TODOS", bIni, tIni, fabricaAlvo);
    } else {
      setResumoDados(null);
    }
  };

  // --- Ações da Tela de Itens Faltantes ---
  const montarFiltrosFaltantes = () => ({
    local_producao: filtroLocal,
    pedido: filtroPedido,
    codigo: filtroCodigo,
    baixa: filtroBaixa,
    tipo: filtroTipo,
    familias: filtroFamilias,
    apenas_simulados: filtroApenasSimulados,
    col_filtros: colFiltros,
    data_inicio: filtroDataInicio,
    data_fim: filtroDataFim,
    tipo_data: filtroTipoData,
  });

  const carregarFaltantes = async () => {
    const req = ++faltantesReqRef.current;
    setCarregandoFaltantes(true);
    setErroFaltantes("");
    try {
      const res = await apiCall("obter_resumo_faltantes", { filtros: montarFiltrosFaltantes() });
      if (req !== faltantesReqRef.current) return;
      if (res && res.erro) throw new Error(res.erro);
      setFaltantesDados(res);
    } catch (e) {
      if (req !== faltantesReqRef.current) return;
      setErroFaltantes(e.message || "Não foi possível carregar os itens faltantes.");
    } finally {
      if (req === faltantesReqRef.current) setCarregandoFaltantes(false);
    }
  };

  // Recarrega o resumo ao entrar na tela ou quando qualquer filtro compartilhado mudar
  useEffect(() => {
    if (telaAtiva === "faltantes") carregarFaltantes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    telaAtiva,
    filtroLocal,
    filtroPedido,
    filtroCodigo,
    filtroBaixa,
    filtroTipo,
    filtroFamilias,
    filtroApenasSimulados,
    filtroDataInicio,
    filtroDataFim,
    filtroTipoData,
    colFiltros,
  ]);

  const handleExportarFaltantes = async () => {
    try {
      setExportandoFaltantes(true);
      const res = await apiCall("exportar_resumo_faltantes_excel", { filtros: montarFiltrosFaltantes() });
      if (res && res.erro) throw new Error(res.erro);
      if (res.url) {
        const a = document.createElement("a");
        a.href = res.url;
        a.download = res.nome || "resumo_faltantes.xlsx";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {
      alert("Erro ao exportar itens faltantes: " + e.message);
    } finally {
      setExportandoFaltantes(false);
    }
  };

  // --- Ações da Tela de Matriz Pivot de Componentes Produzidos Faltantes ---
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
    setTelaAtiva("matriz");

    try {
      const opRes = await apiCall("obter_opcoes_filtros_faltantes", {});
      if (opRes && !opRes.erro) {
        setOpcoesMatriz(opRes);
        const paiInicial =
          matrizLocaisPaiSel.length > 0
            ? matrizLocaisPaiSel
            : Array.isArray(filtroLocal) && filtroLocal.length > 0
            ? filtroLocal
            : filtroLocal && typeof filtroLocal === "string" && filtroLocal.trim()
            ? [filtroLocal.trim()]
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

  // Limpeza de Filtros
  const limparFiltros = () => {
    setFiltroLocal([]);
    setFiltroFamilias([]);
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
    Boolean(Array.isArray(filtroLocal) ? filtroLocal.length > 0 : filtroLocal) ||
    Boolean(Array.isArray(filtroFamilias) ? filtroFamilias.length > 0 : filtroFamilias) ||
    Boolean(filtroPedido) ||
    Boolean(filtroCodigo) ||
    filtroStatus !== "todos" ||
    filtroBaixa !== "todos" ||
    filtroTipo !== "todos" ||
    filtroApenasSimulados ||
    Boolean(filtroDataInicio) ||
    Boolean(filtroDataFim) ||
    Object.values(colFiltros).some((v) => Boolean(v && v.trim()));

  const handleAbrirModalFiltroFamilia = async () => {
    if (!familiasComponentes3 || familiasComponentes3.length === 0) {
      try {
        const res = await apiCall("obter_familias_componentes_3", {});
        if (res && res.familias) {
          setFamiliasComponentes3(res.familias);
        }
      } catch (err) {
        console.warn("Erro ao buscar famílias de componentes:", err);
      }
    }
    setModalFiltroFamiliaAberto(true);
  };

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

  // Roteamento da Sidebar
  const handleNavegar = (tela) => {
    if (tela === "matriz") {
      abrirMatrizFaltantes();
    } else if (tela === "resumo") {
      abrirResumoPedido(filtroPedido);
    } else {
      setTelaAtiva(tela);
    }
  };

  return (
    <div className="h-screen max-h-screen w-screen overflow-hidden flex flex-row bg-[#F8F8F8] text-[#1A1A1A] font-sans">
      {/* SIDEBAR FIXA E PERSISTENTE (COMUM A TODAS AS TELAS) */}
      <Sidebar
        telaAtiva={telaAtiva}
        onNavegar={handleNavegar}
        pedidosSimuladosAtivos={pedidosSimuladosAtivos}
        onAbrirSimulador={abrirModalSimulador}
        onLimparSimulacao={handleLimparSimulacao}
        onRecarregar={() => carregarDados(true, 0, true)}
        onExportarExcel={handleExportarExcel}
        loading={loading}
        exportando={exportando}
        sessionId={sessionId}
        dataCarregamento={dataCarga}
        snapshotNome={snapshotNome}
      />

      {/* ÁREA PRINCIPAL DA APLICAÇÃO */}
      {telaAtiva === "disponibilidade" && (
        <DisponibilidadeEstoque
          metricas={metricas}
          filtroLocal={filtroLocal}
          setFiltroLocal={setFiltroLocal}
          locaisProducao={locaisProducao}
          filtroPedido={filtroPedido}
          setFiltroPedido={setFiltroPedido}
          filtroCodigo={filtroCodigo}
          setFiltroCodigo={setFiltroCodigo}
          filtroTipoData={filtroTipoData}
          setFiltroTipoData={setFiltroTipoData}
          filtroDataInicio={filtroDataInicio}
          setFiltroDataInicio={setFiltroDataInicio}
          filtroDataFim={filtroDataFim}
          setFiltroDataFim={setFiltroDataFim}
          filtroBaixa={filtroBaixa}
          setFiltroBaixa={setFiltroBaixa}
          filtroTipo={filtroTipo}
          setFiltroTipo={setFiltroTipo}
          filtroStatus={filtroStatus}
          setFiltroStatus={setFiltroStatus}
          filtroApenasSimulados={filtroApenasSimulados}
          setFiltroApenasSimulados={setFiltroApenasSimulados}
          temFiltrosAtivos={temFiltrosAtivos}
          limparFiltros={limparFiltros}
          pedidosSimuladosAtivos={pedidosSimuladosAtivos}
          handleRemoverPedidoSimulado={handleRemoverPedidoSimulado}
          colFiltros={colFiltros}
          limparFiltroColuna={limparFiltroColuna}
          aplicarFiltroColuna={aplicarFiltroColuna}
          activeColMenu={activeColMenu}
          setActiveColMenu={setActiveColMenu}
          localColInput={localColInput}
          setLocalColInput={setLocalColInput}
          scrollContainerRef={scrollContainerRef}
          handleScrollContainer={handleScrollContainer}
          tableId={tableId}
          itens={itens}
          loading={loading}
          loadingMsg={loadingMsg}
          loadingMore={loadingMore}
          hasMore={hasMore}
          sentinelRef={sentinelRef}
          totalRegistros={totalRegistros}
          onAbrirDetalhes={abrirDetalhes}
          onAbrirResumoPedido={abrirResumoPedido}
          onAbrirSimulador={abrirModalSimulador}
          onAbrirModalFiltroLocal={() => setModalFiltroLocalAberto(true)}
          filtroFamilias={filtroFamilias}
          setFiltroFamilias={setFiltroFamilias}
          familiasDisponiveis={familiasComponentes3}
          onAbrirModalFiltroFamilia={handleAbrirModalFiltroFamilia}
          onAbrirFaltantes={() => setTelaAtiva("faltantes")}
        />
      )}

      {telaAtiva === "faltantes" && (
        <ResumoFaltantes
          dados={faltantesDados}
          carregando={carregandoFaltantes}
          erro={erroFaltantes}
          exportando={exportandoFaltantes}
          aba={abaFaltantes}
          setAba={setAbaFaltantes}
          onRecarregar={carregarFaltantes}
          onExportar={handleExportarFaltantes}
          onVoltar={() => setTelaAtiva("disponibilidade")}
          filtroLocal={filtroLocal}
          setFiltroLocal={setFiltroLocal}
          filtroFamilias={filtroFamilias}
          setFiltroFamilias={setFiltroFamilias}
          filtroPedido={filtroPedido}
          setFiltroPedido={setFiltroPedido}
          filtroCodigo={filtroCodigo}
          setFiltroCodigo={setFiltroCodigo}
          filtroBaixa={filtroBaixa}
          setFiltroBaixa={setFiltroBaixa}
          filtroTipoData={filtroTipoData}
          setFiltroTipoData={setFiltroTipoData}
          filtroDataInicio={filtroDataInicio}
          setFiltroDataInicio={setFiltroDataInicio}
          filtroDataFim={filtroDataFim}
          setFiltroDataFim={setFiltroDataFim}
          onAbrirModalFiltroLocal={() => setModalFiltroLocalAberto(true)}
          onAbrirModalFiltroFamilia={handleAbrirModalFiltroFamilia}
          limparFiltros={limparFiltros}
          temFiltrosAtivos={temFiltrosAtivos}
        />
      )}

      {telaAtiva === "matriz" && (
        <MatrizFaltasProduzidos
          matrizDados={matrizDados}
          carregandoMatriz={carregandoMatriz}
          erroMatriz={erroMatriz}
          opcoesMatriz={opcoesMatriz}
          matrizMenuAberto={matrizMenuAberto}
          setMatrizMenuAberto={setMatrizMenuAberto}
          matrizLocaisPaiSel={matrizLocaisPaiSel}
          setMatrizLocaisPaiSel={setMatrizLocaisPaiSel}
          toggleLocalPaiMatriz={toggleLocalPaiMatriz}
          matrizLocaisCompSel={matrizLocaisCompSel}
          setMatrizLocaisCompSel={setMatrizLocaisCompSel}
          toggleLocalCompMatriz={toggleLocalCompMatriz}
          matrizBuscaLocalPai={matrizBuscaLocalPai}
          setMatrizBuscaLocalPai={setMatrizBuscaLocalPai}
          matrizBuscaLocalComp={matrizBuscaLocalComp}
          setMatrizBuscaLocalComp={setMatrizBuscaLocalComp}
          matrizEscopoAbatimento={matrizEscopoAbatimento}
          setMatrizEscopoAbatimento={setMatrizEscopoAbatimento}
          matrizBaixa={matrizBaixa}
          setMatrizBaixa={setMatrizBaixa}
          matrizDataInicio={matrizDataInicio}
          setMatrizDataInicio={setMatrizDataInicio}
          matrizDataFim={matrizDataFim}
          setMatrizDataFim={setMatrizDataFim}
          matrizBuscaItem={matrizBuscaItem}
          setMatrizBuscaItem={setMatrizBuscaItem}
          gruposExpandidos={gruposExpandidos}
          setGruposExpandidos={setGruposExpandidos}
          exportandoMatriz={exportandoMatriz}
          carregarMatrizFaltantes={carregarMatrizFaltantes}
          handleExportarMatrizExcel={handleExportarMatrizExcel}
          onVoltar={() => setTelaAtiva("disponibilidade")}
        />
      )}

      {telaAtiva === "resumo" && (
        <ResumoPedido
          resumoDados={resumoDados}
          carregandoResumo={carregandoResumo}
          erroResumo={erroResumo}
          resumoPedidoInput={resumoPedidoInput}
          setResumoPedidoInput={setResumoPedidoInput}
          resumoItemEscopo={resumoItemEscopo}
          resumoBaixa={resumoBaixa}
          setResumoBaixa={setResumoBaixa}
          resumoTipo={resumoTipo}
          setResumoTipo={setResumoTipo}
          abaResumo={abaResumo}
          setAbaResumo={setAbaResumo}
          carregarResumoPedido={carregarResumoPedido}
          onVoltar={() => setTelaAtiva("disponibilidade")}
        />
      )}

      {telaAtiva === "detalhes" && (
        <DetalhamentoInsumos
          itemSelecionado={itemSelecionado}
          detalhesItem={detalhesItem}
          carregandoDetalhes={carregandoDetalhes}
          abaDetalhe={abaDetalhe}
          setAbaDetalhe={setAbaDetalhe}
          modalBaixa={modalBaixa}
          setModalBaixa={setModalBaixa}
          modalTipo={modalTipo}
          setModalTipo={setModalTipo}
          carregarDetalhes={carregarDetalhes}
          onAbrirResumoPedido={abrirResumoPedido}
          onVoltar={() => setTelaAtiva("disponibilidade")}
        />
      )}

      {/* MODAL NATIVO <dialog> DO SIMULADOR DE PEDIDOS (INTRANET) */}
      <SimuladorModal
        dialogRef={simDialogRef}
        dialogTitleId={simDialogTitleId}
        titleId={simDialogTitleId}
        userFieldId={userFieldId}
        passFieldId={passFieldId}
        intranetUsuario={intranetUsuario}
        setIntranetUsuario={setIntranetUsuario}
        intranetSenha={intranetSenha}
        setIntranetSenha={setIntranetSenha}
        mostrarSenha={mostrarSenha}
        setMostrarSenha={setMostrarSenha}
        linhasSimulador={linhasSimulador}
        onAdicionarLinha={adicionarLinhaPedido}
        adicionarLinhaPedido={adicionarLinhaPedido}
        onRemoverLinha={removerLinhaPedido}
        removerLinhaPedido={removerLinhaPedido}
        onAtualizarLinha={atualizarLinhaPedido}
        atualizarLinhaPedido={atualizarLinhaPedido}
        onConfirmarSimulacao={handleConfirmarSimulacao}
        handleConfirmarSimulacao={handleConfirmarSimulacao}
        onFecharModal={fecharModalSimulador}
        fecharModalSimulador={fecharModalSimulador}
        simulando={simulando}
        erroSimulador={erroSimulador}
        avisoSimulador={avisoSimulador}
        pedidosSimuladosAtivos={pedidosSimuladosAtivos}
        onRemoverPedidoSimulado={handleRemoverPedidoSimulado}
        handleRemoverPedidoSimulado={handleRemoverPedidoSimulado}
        onLimparSimulacao={handleLimparSimulacao}
        handleLimparSimulacao={handleLimparSimulacao}
      />

      {/* MODAL DE FILTRO DE FÁBRICAS E LOCAIS DE PRODUÇÃO (LÍDER DESIGN) */}
      <ModalFiltroFabricaLocal
        aberto={modalFiltroLocalAberto}
        onFechar={() => setModalFiltroLocalAberto(false)}
        locaisDisponiveis={locaisProducao}
        divisaoFabricas={divisaoFabricas}
        locaisSelecionados={filtroLocal}
        onAplicar={(novosLocais) => setFiltroLocal(novosLocais)}
      />

      {/* MODAL DE FILTRO DE FAMÍLIAS DE COMPONENTES (ITENS INICIADOS EM 3) */}
      <ModalFiltroFamiliaComponente
        aberto={modalFiltroFamiliaAberto}
        onFechar={() => setModalFiltroFamiliaAberto(false)}
        familiasDisponiveis={familiasComponentes3}
        familiasSelecionadas={filtroFamilias}
        onAplicar={(novasFamilias) => setFiltroFamilias(novasFamilias)}
      />
    </div>
  );
}
