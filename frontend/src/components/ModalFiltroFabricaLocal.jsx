import React, { useState, useEffect, useMemo, useRef, useId } from "react";
import Icon from "./Icon";

/**
 * Modal de Seleção de Fábricas e Locais de Produção (Líder Design)
 *
 * Suporta:
 * 1. Visão 1: Grade de Fábricas Industriais com checkbox tristate ("Todos") e drill-down.
 * 2. Visão 2: Drill-down nos locais individuais da fábrica ativa com ações rápidas e retorno.
 * 3. Visão 3: Busca global dinâmica unificada de locais com seleção com 1 clique.
 * 4. Amarração 100% dinâmica via DIVISAO_FABRICAS.json e ícones SVG inline.
 * 5. Ocultação de locais/fábricas não disponíveis na carga da tabela principal.
 */
export default function ModalFiltroFabricaLocal({
  aberto = false,
  onFechar = () => {},
  locaisDisponiveis = [],
  divisaoFabricas = null,
  locaisSelecionados = [],
  onAplicar = () => {},
}) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closingProgrammaticallyRef = useRef(false);
  const pointerDownOutsideRef = useRef(false);

  // Sincroniza o <dialog> nativo sempre que abre/fecha
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (aberto && !dialog.open) {
      closingProgrammaticallyRef.current = false;
      dialog.showModal();
    } else if (!aberto && dialog.open) {
      closingProgrammaticallyRef.current = true;
      dialog.close();
    }
  }, [aberto]);

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
    const dialog = dialogRef.current;
    if (!dialog || e.target !== dialog) {
      pointerDownOutsideRef.current = false;
      return;
    }
    pointerDownOutsideRef.current = isClickOutsideDialog(e, dialog);
  };

  const handlePointerUp = (e) => {
    const dialog = dialogRef.current;
    if (
      pointerDownOutsideRef.current &&
      dialog &&
      e.target === dialog &&
      isClickOutsideDialog(e, dialog)
    ) {
      onFechar();
    }
    pointerDownOutsideRef.current = false;
  };

  const handleDialogClose = () => {
    if (closingProgrammaticallyRef.current) {
      closingProgrammaticallyRef.current = false;
      return;
    }
    onFechar();
  };

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby={titleId}
      onClose={handleDialogClose}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className="w-[calc(100%-1.5rem)] max-w-5xl bg-white rounded border border-[#E5E5E5] shadow-2xl p-0 overflow-hidden m-auto max-h-[90vh] text-[#1A1A1A] backdrop:bg-black/55 backdrop:backdrop-blur-sm"
    >
      {aberto && (
        <ModalFiltroFabricaConteudo
          titleId={titleId}
          onFechar={onFechar}
          locaisDisponiveis={locaisDisponiveis}
          divisaoFabricas={divisaoFabricas}
          locaisSelecionados={locaisSelecionados}
          onAplicar={onAplicar}
        />
      )}
    </dialog>
  );
}

function ModalFiltroFabricaConteudo({
  titleId,
  onFechar,
  locaisDisponiveis,
  divisaoFabricas,
  locaisSelecionados,
  onAplicar,
}) {
  // Estado rascunho de seleção inicializado na abertura
  const [tempSelecao, setTempSelecao] = useState(() => {
    if (Array.isArray(locaisSelecionados) && locaisSelecionados.length > 0) {
      return new Set(locaisSelecionados.map((l) => String(l).trim().toUpperCase()));
    }
    return new Set();
  });
  // Navegação: null = Visão Geral (Fábricas); "NOME_FABRICA" = Visão Detalhe (Locais)
  const [fabricaAtiva, setFabricaAtiva] = useState(null);
  // Barra de pesquisa superior
  const [termoBusca, setTermoBusca] = useState("");

  // Estruturação e cruzamento dinâmico entre JSON e locais disponíveis na tabela
  const estrutura = useMemo(() => {
    const dados = divisaoFabricas?.dados || [];
    const metaFabricas = divisaoFabricas?.metadados_fabricas || {};

    // Mapa de Local -> Fábrica
    const mapLocalFabrica = {};
    dados.forEach((d) => {
      if (d.Local && d.Fabrica) {
        mapLocalFabrica[String(d.Local).trim().toUpperCase()] = String(d.Fabrica).trim().toUpperCase();
      }
    });

    // Filtra estritamente os locais disponíveis na tabela principal
    const locaisValidosSet = new Set(
      (locaisDisponiveis || []).map((l) => String(l).trim().toUpperCase()).filter(Boolean)
    );

    // Agrupamento por fábrica
    const agrupamento = {};

    locaisValidosSet.forEach((localKey) => {
      // Regra alinhada: se o local estiver na tabela mas não no JSON, vai para "OUTROS"
      const fabKey = mapLocalFabrica[localKey] || "OUTROS";
      if (!agrupamento[fabKey]) {
        agrupamento[fabKey] = [];
      }
      agrupamento[fabKey].push(localKey);
    });

    // Monta a lista estruturada das fábricas que possuem locais disponíveis
    const listaFabricas = Object.keys(agrupamento).map((fabKey) => {
      const locaisDaFabrica = agrupamento[fabKey].sort((a, b) => a.localeCompare(b));
      const meta = metaFabricas[fabKey] || {
        nome: fabKey,
        codigo: fabKey.length > 8 ? fabKey.slice(0, 7) : fabKey,
        icone: fabKey === "OUTROS" ? "category" : "factory",
        ordem: fabKey === "OUTROS" ? 99 : 50,
      };

      return {
        key: fabKey,
        nome: meta.nome || fabKey,
        codigo: meta.codigo || fabKey.slice(0, 7),
        icone: meta.icone || "factory",
        ordem: meta.ordem || 50,
        locais: locaisDaFabrica,
        totalLocais: locaisDaFabrica.length,
      };
    });

    // Ordena as fábricas pela ordem configurada no JSON
    listaFabricas.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));

    // Todos os locais disponíveis consolidados (em ordem alfabética)
    const todosLocaisDisponiveis = Array.from(locaisValidosSet).sort((a, b) => a.localeCompare(b));

    return {
      fabricas: listaFabricas,
      mapLocalFabrica,
      todosLocaisDisponiveis,
    };
  }, [divisaoFabricas, locaisDisponiveis]);

  // Lista plana de locais para a Visão 3 (Busca Direta Global)
  const locaisBuscaFiltrados = useMemo(() => {
    const q = termoBusca.trim().toUpperCase();
    if (!q) return [];

    return estrutura.todosLocaisDisponiveis
      .filter((loc) => {
        const fab = estrutura.mapLocalFabrica[loc] || "OUTROS";
        return loc.includes(q) || fab.includes(q);
      })
      .map((loc) => {
        const fabKey = estrutura.mapLocalFabrica[loc] || "OUTROS";
        const meta = divisaoFabricas?.metadados_fabricas?.[fabKey] || {
          nome: fabKey,
          codigo: fabKey.slice(0, 7),
          icone: "factory",
        };
        return {
          local: loc,
          fabricaKey: fabKey,
          fabricaNome: meta.nome || fabKey,
          fabricaCodigo: meta.codigo || fabKey.slice(0, 7),
          icone: meta.icone || "factory",
        };
      });
  }, [termoBusca, estrutura, divisaoFabricas]);

  // Total de locais atualmente marcados no rascunho
  const totalSelecionados = tempSelecao.size;
  const totalDisponiveisGeral = estrutura.todosLocaisDisponiveis.length;

  // Conta quantas fábricas possuem ao menos um local marcado
  const totalFabricasComSelecao = useMemo(() => {
    let count = 0;
    estrutura.fabricas.forEach((fab) => {
      const marcados = fab.locais.filter((loc) => tempSelecao.has(loc)).length;
      if (marcados > 0) count++;
    });
    return count;
  }, [estrutura.fabricas, tempSelecao]);

  // Ações de Seleção
  const toggleLocal = (local) => {
    const locNorm = String(local).trim().toUpperCase();
    setTempSelecao((prev) => {
      const next = new Set(prev);
      if (next.has(locNorm)) {
        next.delete(locNorm);
      } else {
        next.add(locNorm);
      }
      return next;
    });
  };

  const marcarTodosDaFabrica = (fabKey) => {
    const fab = estrutura.fabricas.find((f) => f.key === fabKey);
    if (!fab) return;
    setTempSelecao((prev) => {
      const next = new Set(prev);
      fab.locais.forEach((loc) => next.add(loc));
      return next;
    });
  };

  const desmarcarTodosDaFabrica = (fabKey) => {
    const fab = estrutura.fabricas.find((f) => f.key === fabKey);
    if (!fab) return;
    setTempSelecao((prev) => {
      const next = new Set(prev);
      fab.locais.forEach((loc) => next.delete(loc));
      return next;
    });
  };

  const toggleCheckboxFabrica = (fabKey) => {
    const fab = estrutura.fabricas.find((f) => f.key === fabKey);
    if (!fab) return;

    const marcados = fab.locais.filter((loc) => tempSelecao.has(loc));
    const todosMarcados = marcados.length === fab.locais.length;

    if (todosMarcados) {
      desmarcarTodosDaFabrica(fabKey);
    } else {
      marcarTodosDaFabrica(fabKey);
    }
  };

  const marcarTodosGlobais = () => {
    setTempSelecao(new Set(estrutura.todosLocaisDisponiveis));
  };

  const limparSelecao = () => {
    setTempSelecao(new Set());
  };

  // Efetivação do filtro
  const handleAplicar = () => {
    if (
      tempSelecao.size === 0 ||
      (totalDisponiveisGeral > 0 && tempSelecao.size === totalDisponiveisGeral)
    ) {
      onAplicar([]);
    } else {
      onAplicar(Array.from(tempSelecao));
    }
    onFechar();
  };

  // Identifica se estamos em modo busca, visão 2 (drill-down) ou visão 1 (fábricas)
  const isBuscando = Boolean(termoBusca.trim());
  const fabricaAtivaObj = estrutura.fabricas.find((f) => f.key === fabricaAtiva);

  return (
    <div
      className="flex flex-col max-h-[90vh] overflow-hidden"
      data-purpose="factory-selector-modal"
    >
          {/* ============================================================== */}
          {/* 1. CABEÇALHO DO MODAL                                          */}
          {/* ============================================================== */}
          <header className="pt-5 sm:pt-6 px-4 sm:px-8 pb-4 border-b border-[#E5E5E5] bg-white flex flex-col gap-3.5 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#8B5A2B]"></span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B5A2B]">
                    Líder Design • Centros Industriais
                  </span>
                </div>
                <h2
                  id={titleId}
                  className="text-lg sm:text-2xl font-semibold text-[#141414] tracking-tight flex items-center gap-2.5 flex-wrap"
                >
                  Fábricas e Locais de Produção
                </h2>
              </div>

              {/* Botão Fechar */}
              <button
                type="button"
                onClick={onFechar}
                aria-label="Fechar Modal"
                className="text-[#737373] hover:text-[#141414] p-1.5 rounded hover:bg-[#F5F5F5] transition-colors cursor-pointer"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>

            {/* Barra de Busca e Ações Globais */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-0.5">
              {/* Campo de Busca Rápida */}
              <div className="relative flex-1 max-w-md">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#737373]">
                  <Icon name="search" className="w-[17px] h-[17px]" />
                </span>
                <input
                  type="text"
                  value={termoBusca}
                  onChange={(e) => setTermoBusca(e.target.value)}
                  placeholder="Buscar diretamente locais de produção ou fábricas..."
                  aria-label="Buscar locais de produção ou fábricas"
                  className="w-full pl-9 pr-8 py-1.5 text-xs bg-[#F8F8F8] border border-[#E5E5E5] rounded focus:bg-white focus:border-[#8B5A2B] focus:outline-none transition-colors placeholder:text-[#737373]"
                  autoFocus
                />
                {termoBusca && (
                  <button
                    type="button"
                    onClick={() => setTermoBusca("")}
                    className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-[#737373] hover:text-[#1A1A1A] cursor-pointer"
                    title="Limpar busca"
                    aria-label="Limpar busca"
                  >
                    <Icon name="close" className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Ações Globais */}
              <div className="flex items-center gap-3 text-xs select-none flex-wrap">
                <button
                  type="button"
                  onClick={marcarTodosGlobais}
                  className="inline-flex items-center gap-1.5 text-[#404040] hover:text-[#8B5A2B] font-medium px-2 py-1 rounded hover:bg-[#F5F5F5] transition-colors cursor-pointer"
                >
                  <Icon name="select_all" className="w-4 h-4" />
                  <span>Marcar Todos Globais</span>
                </button>
                <span className="text-[#D4D4D4]">|</span>
                <button
                  type="button"
                  onClick={limparSelecao}
                  className="inline-flex items-center gap-1.5 text-[#737373] hover:text-[#C62828] font-medium px-2 py-1 rounded hover:bg-[#F5F5F5] transition-colors cursor-pointer"
                >
                  <Icon name="deselect" className="w-4 h-4" />
                  <span>Limpar Seleção</span>
                </button>
              </div>
            </div>
          </header>

          {/* ============================================================== */}
          {/* 2. SUBHEADER / MIGALHAS DE NAVEGAÇÃO                            */}
          {/* ============================================================== */}
          <div className="bg-[#F8F8F8] px-4 sm:px-8 py-2.5 border-b border-[#E5E5E5] flex items-center justify-between text-xs text-[#404040] shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              {isBuscando ? (
                <>
                  <button
                    type="button"
                    onClick={() => setTermoBusca("")}
                    className="flex items-center gap-1.5 font-medium text-[#141414] hover:text-[#8B5A2B] transition-colors cursor-pointer"
                  >
                    <Icon name="search" className="w-4 h-4" />
                    <span>Busca Global</span>
                  </button>
                  <span className="text-[#D4D4D4]">/</span>
                  <span className="font-semibold text-[#8B5A2B]">
                    Resultados para &quot;{termoBusca}&quot; ({locaisBuscaFiltrados.length} encontrados)
                  </span>
                </>
              ) : fabricaAtivaObj ? (
                <>
                  <button
                    type="button"
                    onClick={() => setFabricaAtiva(null)}
                    className="flex items-center gap-1.5 font-medium text-[#141414] hover:text-[#8B5A2B] transition-colors cursor-pointer"
                  >
                    <Icon name="factory" className="w-4 h-4" />
                    <span>Fábricas Líder</span>
                  </button>
                  <span className="text-[#D4D4D4]">/</span>
                  <span className="font-semibold text-[#8B5A2B]">
                    {fabricaAtivaObj.nome} ({fabricaAtivaObj.codigo}) • {fabricaAtivaObj.totalLocais} Locais
                  </span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5 font-medium text-[#141414]">
                    <Icon name="factory" className="w-4 h-4" />
                    <span>Fábricas Líder</span>
                  </span>
                  <span className="text-[#D4D4D4]">/</span>
                  <span className="font-semibold text-[#8B5A2B]">
                    Visão Geral ({estrutura.fabricas.length} Centros Ativos)
                  </span>
                </>
              )}
            </div>

            <div className="hidden sm:flex items-center gap-2 text-[11px] text-[#737373]">
              {isBuscando ? (
                <span>Clique nos cards para alternar a seleção</span>
              ) : fabricaAtivaObj ? (
                <span>Selecione os locais desta fábrica</span>
              ) : (
                <span>Clique em uma fábrica para detalhar seus locais</span>
              )}
            </div>
          </div>

          {/* ============================================================== */}
          {/* 3. CORPO PRINCIPAL COM SCROLL                                  */}
          {/* ============================================================== */}
          <div className="p-4 sm:p-8 overflow-y-auto flex-1 bg-[#FFFFFF]">
            {/* ============================================================ */}
            {/* VISÃO 3: RESULTADOS DA BUSCA DIRETA                          */}
            {/* ============================================================ */}
            {isBuscando ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-[#EEEEEE]">
                  <div>
                    <h3 className="text-sm font-semibold text-[#141414]">
                      Locais Encontrados ({locaisBuscaFiltrados.length})
                    </h3>
                    <p className="text-xs text-[#737373] mt-0.5">
                      Selecione diretamente os locais desejados na lista direta.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTermoBusca("")}
                    className="text-xs text-[#8B5A2B] hover:underline font-medium cursor-pointer"
                  >
                    Voltar à visão normal
                  </button>
                </div>

                {locaisBuscaFiltrados.length === 0 ? (
                  <div className="text-center py-12 text-[#737373]">
                    <Icon name="search_off" className="w-9 h-9 text-[#D4D4D4] mx-auto mb-2" />
                    <p className="text-sm font-medium">
                      Nenhum local de produção ou fábrica encontrado para &quot;{termoBusca}&quot;.
                    </p>
                    <p className="text-xs mt-1 text-[#9E9E9E]">
                      Verifique se o termo digitado está correto ou limpe a busca.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                    {locaisBuscaFiltrados.map((item) => {
                      const isSelected = tempSelecao.has(item.local);
                      return (
                        <button
                          key={item.local}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => toggleLocal(item.local)}
                          className={`group relative flex flex-col justify-between p-4 rounded border transition-all cursor-pointer select-none text-left w-full ${
                            isSelected
                              ? "bg-[#FCFAF7] border-[#8B5A2B] shadow-sm ring-1 ring-[#8B5A2B]"
                              : "bg-white border-[#D4D4D4] hover:border-[#8B5A2B] hover:shadow-sm"
                          }`}
                        >
                          <div className="flex items-start justify-between w-full mb-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-mono font-bold text-[#141414] px-2 py-0.5 bg-[#F8F8F8] border border-[#E5E5E5] rounded">
                                {item.local}
                              </span>
                              <span className="text-[10px] font-semibold text-[#8B5A2B] px-1.5 py-0.2 bg-[#F5ECE3] rounded border border-[#8B5A2B]/20">
                                {item.fabricaCodigo}
                              </span>
                            </div>
                            <span
                              aria-hidden="true"
                              className={`w-5 h-5 rounded-sm flex items-center justify-center transition-colors ${
                                isSelected ? "bg-[#8B5A2B] text-white" : "bg-[#F5F5F5] border border-[#D4D4D4]"
                              }`}
                            >
                              {isSelected && <Icon name="check" className="w-3.5 h-3.5" />}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 my-1 w-full">
                            <span
                              className={`w-9 h-9 rounded flex items-center justify-center border transition-colors shrink-0 ${
                                isSelected
                                  ? "bg-[#F5ECE3] border-[#8B5A2B]/30 text-[#8B5A2B]"
                                  : "bg-[#F8F8F8] border-[#E5E5E5] text-[#404040] group-hover:text-[#8B5A2B]"
                              }`}
                            >
                              <Icon name={item.icone} className="w-5 h-5" />
                            </span>
                            <span className="min-w-0 flex-1 block">
                              <span className="block text-xs font-semibold text-[#141414] truncate">
                                {item.local}
                              </span>
                              <span className="block text-[11px] text-[#737373] truncate">
                                Fábrica: {item.fabricaNome}
                              </span>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : fabricaAtivaObj ? (
              /* ============================================================ */
              /* VISÃO 2: DETALHE DE LOCAIS DA FÁBRICA ATIVA (DRILL-DOWN)     */
              /* ============================================================ */
              <div className="space-y-5">
                {/* Barra Superior do Detalhe com Voltar e Ações */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E5E5E5]">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setFabricaAtiva(null)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-[#141414] hover:bg-[#F8F8F8] border border-[#D4D4D4] rounded transition-all shadow-sm group cursor-pointer text-xs font-semibold tracking-wider uppercase"
                    >
                      <Icon
                        name="arrow_back"
                        className="w-4 h-4 text-[#8B5A2B] group-hover:-translate-x-0.5 transition-transform"
                      />
                      <span>Voltar para Fábricas</span>
                    </button>
                    <span className="w-1 h-1 rounded-full bg-[#D4D4D4] hidden sm:inline-block"></span>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold text-[#141414]">{fabricaAtivaObj.nome}</span>
                      <span className="px-1.5 py-0.5 bg-[#F8F8F8] text-[#404040] rounded text-[11px] font-mono font-medium border border-[#E5E5E5]">
                        {fabricaAtivaObj.codigo}
                      </span>
                      <span className="text-[#737373] ml-1">
                        • {fabricaAtivaObj.totalLocais} Locais de Produção
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => marcarTodosDaFabrica(fabricaAtivaObj.key)}
                      className="px-2.5 py-1 text-[#404040] hover:text-[#8B5A2B] bg-[#F8F8F8] hover:bg-white border border-[#D4D4D4] rounded transition-colors flex items-center gap-1 shadow-sm cursor-pointer font-medium"
                    >
                      <Icon name="select_all" className="w-[15px] h-[15px]" />
                      <span>Marcar Todos</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => desmarcarTodosDaFabrica(fabricaAtivaObj.key)}
                      className="px-2.5 py-1 text-[#737373] hover:text-[#C62828] bg-[#F8F8F8] hover:bg-white border border-[#D4D4D4] rounded transition-colors flex items-center gap-1 shadow-sm cursor-pointer font-medium"
                    >
                      <Icon name="deselect" className="w-[15px] h-[15px]" />
                      <span>Desmarcar Todos</span>
                    </button>
                  </div>
                </div>

                {/* Cards dos Locais Individuais da Fábrica */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                  {fabricaAtivaObj.locais.map((loc) => {
                    const isSelected = tempSelecao.has(loc);
                    return (
                      <button
                        key={loc}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleLocal(loc)}
                        className={`group relative flex flex-col justify-between p-4 rounded border transition-all cursor-pointer select-none text-left w-full ${
                          isSelected
                            ? "bg-[#FCFAF7] border-[#8B5A2B] shadow-sm ring-1 ring-[#8B5A2B]"
                            : "bg-white border-[#D4D4D4] hover:border-[#8B5A2B] hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-start justify-between w-full mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-[#141414] px-2 py-0.5 bg-[#F8F8F8] border border-[#E5E5E5] rounded">
                              {loc}
                            </span>
                            <span className="text-[11px] text-[#3B6E4C] flex items-center gap-1 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#3B6E4C] animate-pulse"></span>
                              Ativo
                            </span>
                          </div>
                          <span
                            aria-hidden="true"
                            className={`w-5 h-5 rounded-sm flex items-center justify-center transition-colors ${
                              isSelected ? "bg-[#8B5A2B] text-white" : "bg-[#F5F5F5] border border-[#D4D4D4]"
                            }`}
                          >
                            {isSelected && <Icon name="check" className="w-3.5 h-3.5" />}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 my-1 w-full">
                          <span
                            className={`w-10 h-10 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              isSelected
                                ? "bg-[#F5ECE3] border-[#8B5A2B]/30 text-[#8B5A2B]"
                                : "bg-[#F8F8F8] border-[#E5E5E5] text-[#404040] group-hover:text-[#8B5A2B]"
                            }`}
                          >
                            <Icon name={fabricaAtivaObj.icone} className="w-[22px] h-[22px]" />
                          </span>
                          <span className="min-w-0 flex-1 block">
                            <span className="block text-sm font-semibold text-[#141414] truncate">
                              {loc}
                            </span>
                            <span className="block text-[11px] text-[#737373] font-mono mt-0.5">
                              Setor: {fabricaAtivaObj.codigo}
                            </span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Faixa de Outras Fábricas no Rodapé do Drill-down */}
                <section className="bg-[#F8F8F8] rounded border border-[#E5E5E5] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs mt-6">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded bg-white border border-[#D4D4D4] text-[#8B5A2B] flex items-center justify-center shadow-sm shrink-0">
                      <Icon name="factory" className="w-4 h-4" />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[#404040]">
                      <span className="font-medium text-[#141414]">Outras fábricas ativas:</span>
                      <span className="text-[#737373]">
                        {estrutura.fabricas
                          .filter((f) => f.key !== fabricaAtivaObj.key)
                          .map((f) => {
                            const marcados = f.locais.filter((l) => tempSelecao.has(l)).length;
                            return `${f.nome} (${marcados})`;
                          })
                          .join(" • ")}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setFabricaAtiva(null)}
                    className="text-[#8B5A2B] hover:text-[#141414] font-medium flex items-center gap-1 transition-colors self-start sm:self-auto cursor-pointer"
                  >
                    <span>Mudar de fábrica</span>
                    <Icon name="chevron_right" className="w-4 h-4" />
                  </button>
                </section>
              </div>
            ) : (
              /* ============================================================ */
              /* VISÃO 1: GRADE DAS FÁBRICAS INDUSTRIAIS                      */
              /* ============================================================ */
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-[#141414] tracking-tight">
                      Centros de Produção Industriais
                    </h3>
                    <p className="text-xs text-[#737373] mt-0.5">
                      Selecione a fábrica completa no checkbox ou clique para inspecionar os locais.
                    </p>
                  </div>
                  <span className="text-xs font-mono text-[#404040] bg-[#F8F8F8] px-2.5 py-1 rounded border border-[#E5E5E5]">
                    {estrutura.fabricas.length} Unidades Fabris Ativas
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {estrutura.fabricas.map((fab, idx) => {
                    const marcadosCount = fab.locais.filter((loc) => tempSelecao.has(loc)).length;
                    const isAll = marcadosCount === fab.totalLocais && fab.totalLocais > 0;
                    const isPartial = marcadosCount > 0 && !isAll;

                    return (
                      <div
                        key={fab.key}
                        className={`group relative p-5 rounded border flex flex-col justify-between h-52 transition-all shadow-sm ${
                          isAll
                            ? "bg-[#FCFAF7] border-[#8B5A2B] ring-1 ring-[#8B5A2B]"
                            : isPartial
                            ? "bg-white border-[#8B5A2B]/60 hover:border-[#8B5A2B]"
                            : "bg-white border-[#D4D4D4] hover:border-[#8B5A2B]"
                        }`}
                      >
                        {/* Topo do Card com Número e Checkbox "Todos" */}
                        <div className="flex items-start justify-between">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              isAll
                                ? "bg-[#F5ECE3] text-[#8B5A2B]"
                                : "bg-[#F8F8F8] text-[#737373] border border-[#E5E5E5]"
                            }`}
                          >
                            <span className="text-xs font-mono font-bold">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                          </div>

                          {/* Checkbox Tristate "Todos" */}
                          <label className="relative z-10 flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isAll}
                              ref={(el) => {
                                if (el) el.indeterminate = isPartial;
                              }}
                              onChange={() => toggleCheckboxFabrica(fab.key)}
                              className="w-4 h-4 rounded text-[#8B5A2B] focus:ring-[#8B5A2B] border-[#D4D4D4] cursor-pointer"
                              title={`Marcar/Desmarcar todos de ${fab.nome}`}
                            />
                            <span
                              className={`text-[10px] uppercase font-mono tracking-wider font-semibold ${
                                isAll || isPartial ? "text-[#8B5A2B]" : "text-[#737373]"
                              }`}
                            >
                              Todos
                            </span>
                          </label>
                        </div>

                        {/* Botão principal de Drill-down cobrindo o card */}
                        <button
                          type="button"
                          onClick={() => setFabricaAtiva(fab.key)}
                          className="text-left flex-1 flex flex-col justify-between cursor-pointer after:absolute after:inset-0 focus:outline-none"
                        >
                          <span className="py-2 text-center flex flex-col items-center justify-center flex-1 w-full">
                            <Icon
                              name={fab.icone}
                              className={`w-12 h-12 transition-transform group-hover:scale-105 ${
                                isAll || isPartial
                                  ? "text-[#8B5A2B]"
                                  : "text-[#404040] group-hover:text-[#8B5A2B]"
                              }`}
                            />
                          </span>

                          {/* Rodapé do Card com Nome, Contagem e Código */}
                          <span className="border-t border-[#EEEEEE] pt-3 flex items-center justify-between w-full">
                            <span>
                              <span className="text-sm font-semibold text-[#141414] group-hover:text-[#8B5A2B] transition-colors flex items-center gap-1.5">
                                <span>{fab.nome}</span>
                                <Icon
                                  name="arrow_forward"
                                  className="w-4 h-4 text-[#737373] group-hover:translate-x-0.5 transition-transform"
                                />
                              </span>
                              <span className="block text-[11px] text-[#737373]">
                                {marcadosCount} de {fab.totalLocais} locais marcados
                              </span>
                            </span>
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                                isAll
                                  ? "bg-[#F5ECE3] text-[#8B5A2B]"
                                  : "bg-[#F8F8F8] text-[#737373] border border-[#E5E5E5]"
                              }`}
                            >
                              {fab.codigo}
                            </span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ============================================================== */}
          {/* 4. RODAPÉ FIXO DO MODAL                                        */}
          {/* ============================================================== */}
          <footer className="px-4 sm:px-8 py-4 bg-[#F8F8F8] border-t border-[#E5E5E5] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-[#404040] font-medium">Total selecionado:</span>
              <span className="font-mono font-bold text-xs text-[#141414] bg-white border border-[#D4D4D4] px-2.5 py-1 rounded shadow-sm">
                {totalSelecionados}{" "}
                {totalSelecionados === 1 ? "local ativo" : "locais ativos"}
              </span>
              <span className="text-[11px] text-[#737373] hidden sm:inline">
                ({totalFabricasComSelecao}{" "}
                {totalFabricasComSelecao === 1 ? "fábrica com seleções" : "fábricas com seleções"})
              </span>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={limparSelecao}
                className="px-4 py-2 text-xs font-medium text-[#404040] hover:text-[#141414] rounded hover:bg-[#EAEAEA] transition-colors cursor-pointer"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={handleAplicar}
                className="px-6 py-2.5 text-xs font-semibold text-white bg-[#141414] hover:bg-black rounded shadow-sm transition-all flex items-center gap-2 cursor-pointer"
              >
                <span>Aplicar Seleção</span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#8B5A2B]"></span>
                <span className="text-[#D4D4D4] font-mono text-[11px] font-bold">
                  {totalSelecionados === 0 || totalSelecionados === totalDisponiveisGeral
                    ? "TODOS OS LOCAIS"
                    : `${totalSelecionados} LOCAIS`}
                </span>
              </button>
            </div>
          </footer>
        </div>
  );
}
