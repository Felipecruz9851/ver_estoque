import React, { useState, useEffect, useMemo } from "react";

/**
 * Modal de Seleção de Famílias de Componentes (Itens iniciados em 3) — Líder Design
 *
 * Permite ao usuário filtrar e recalcular o consumo exclusivamente para os
 * componentes das famílias selecionadas (válido estritamente para itens iniciados em 3).
 */
export default function ModalFiltroFamiliaComponente({
  aberto = false,
  onFechar = () => {},
  familiasDisponiveis = [],
  familiasSelecionadas = [],
  onAplicar = () => {},
}) {
  // Estado rascunho de seleção durante o modal aberto
  const [tempSelecao, setTempSelecao] = useState(new Set());
  // Barra de pesquisa
  const [termoBusca, setTermoBusca] = useState("");

  // Sincroniza rascunho sempre que o modal abre
  useEffect(() => {
    if (aberto) {
      if (Array.isArray(familiasSelecionadas) && familiasSelecionadas.length > 0) {
        setTempSelecao(new Set(familiasSelecionadas.map((f) => String(f).trim().toUpperCase())));
      } else {
        setTempSelecao(new Set());
      }
      setTermoBusca("");
    }
  }, [aberto, familiasSelecionadas]);

  // Fecha no ESC
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && aberto) {
        onFechar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [aberto, onFechar]);

  // Normaliza lista de famílias disponíveis
  const listaFamilias = useMemo(() => {
    return (familiasDisponiveis || []).map((item) => {
      const famCode = String(item.familia || item.codigo || item).trim().toUpperCase();
      const grupoNome = String(item.grupo || "").trim();
      const totalItens = Number(item.total_itens || 0);
      return {
        familia: famCode,
        grupo: grupoNome,
        total_itens: totalItens,
      };
    });
  }, [familiasDisponiveis]);

  // Lista filtrada pelo termo de busca
  const familiasFiltradas = useMemo(() => {
    const q = termoBusca.trim().toUpperCase();
    if (!q) return listaFamilias;

    return listaFamilias.filter((item) => {
      return (
        item.familia.includes(q) ||
        (item.grupo && item.grupo.toUpperCase().includes(q))
      );
    });
  }, [listaFamilias, termoBusca]);

  // Totalizadores
  const totalDisponiveis = listaFamilias.length;
  const totalSelecionados = tempSelecao.size;
  const isTodasSelecionadas =
    totalDisponiveis > 0 && totalSelecionados === totalDisponiveis;

  // Ações de Seleção
  const toggleFamilia = (famCode) => {
    const norm = String(famCode).trim().toUpperCase();
    setTempSelecao((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(norm)) {
        proximo.delete(norm);
      } else {
        proximo.add(norm);
      }
      return proximo;
    });
  };

  const selecionarTodas = () => {
    const todas = new Set(listaFamilias.map((f) => f.familia));
    setTempSelecao(todas);
  };

  const limparSelecao = () => {
    setTempSelecao(new Set());
  };

  const handleAplicar = () => {
    // Se selecionou todas ou nenhuma, equivale a sem filtro (lista vazia)
    if (tempSelecao.size === 0 || tempSelecao.size === totalDisponiveis) {
      onAplicar([]);
    } else {
      onAplicar(Array.from(tempSelecao).sort());
    }
    onFechar();
  };

  if (!aberto) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-filtro-familia-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        className="relative w-full max-w-4xl bg-white rounded-lg shadow-2xl border border-[#E5E5E5] flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ============================================================== */}
        {/* 1. CABEÇALHO DO MODAL                                          */}
        {/* ============================================================== */}
        <header className="px-6 sm:px-8 py-5 border-b border-[#E5E5E5] bg-[#FFFFFF] flex flex-col gap-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-sm bg-[#FCFAF7] border border-[#8B5A2B]/20 flex items-center justify-center text-[#8B5A2B]">
                <span className="material-symbols-outlined text-[24px]">category</span>
              </div>
              <div>
                <h1
                  id="modal-filtro-familia-title"
                  className="text-base sm:text-lg font-bold text-[#141414] tracking-tight flex items-center gap-2"
                >
                  <span>Filtrar por Família do Componente</span>
                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 bg-[#F5ECE3] text-[#8B5A2B] rounded border border-[#8B5A2B]/20">
                    Itens 3
                  </span>
                </h1>
                <p className="text-xs text-[#737373] mt-0.5">
                  Recalcula e avalia o consumo exclusivamente para os componentes das famílias selecionadas (válido para insumos iniciados em 3).
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onFechar}
              className="text-[#737373] hover:text-[#141414] hover:bg-[#F5F5F5] p-2 rounded-full transition-colors cursor-pointer"
              title="Fechar (Esc)"
              aria-label="Fechar modal"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Barra de Pesquisa e Ações Rápidas */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-[#A3A3A3]">
                search
              </span>
              <input
                type="text"
                value={termoBusca}
                onChange={(e) => setTermoBusca(e.target.value)}
                placeholder="Buscar por código ou grupo (ex: CST, FEC, COURO, EMBALAGENS)..."
                className="w-full h-10 pl-9 pr-8 text-xs bg-[#F8F8F8] border border-[#D4D4D4] rounded focus:bg-white focus:border-[#8B5A2B] focus:ring-1 focus:ring-[#8B5A2B] focus:outline-none transition-all placeholder:text-[#A3A3A3]"
                autoFocus
              />
              {termoBusca && (
                <button
                  type="button"
                  onClick={() => setTermoBusca("")}
                  className="absolute right-2.5 top-2.5 text-[#737373] hover:text-[#141414] text-xs font-bold p-0.5 rounded-full"
                  title="Limpar busca"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={selecionarTodas}
                className="h-10 px-3 text-xs font-medium text-[#404040] hover:text-[#141414] bg-[#F8F8F8] hover:bg-[#EAEAEA] border border-[#D4D4D4] rounded transition-colors cursor-pointer flex items-center gap-1.5"
                title="Marcar todas as famílias"
              >
                <span className="material-symbols-outlined text-[16px]">select_all</span>
                <span>Selecionar Todas</span>
              </button>

              <button
                type="button"
                onClick={limparSelecao}
                className="h-10 px-3 text-xs font-medium text-[#B84A39] hover:bg-[#FFEBEE] border border-[#E0E0E0] rounded transition-colors cursor-pointer flex items-center gap-1.5"
                title="Desmarcar todas"
              >
                <span className="material-symbols-outlined text-[16px]">deselect</span>
                <span>Limpar</span>
              </button>
            </div>
          </div>
        </header>

        {/* ============================================================== */}
        {/* 2. BARRA DE CONTEXTO / TOTALIZADOR                             */}
        {/* ============================================================== */}
        <div className="px-6 sm:px-8 py-2.5 bg-[#FAFAFA] border-b border-[#E5E5E5] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#8B5A2B]">
              {familiasFiltradas.length} de {totalDisponiveis} famílias exibidas
            </span>
            {totalSelecionados > 0 && (
              <span className="text-[11px] font-medium text-[#1A1A1A] bg-white border border-[#D4D4D4] px-2 py-0.5 rounded-xs">
                {totalSelecionados} selecionada(s)
              </span>
            )}
          </div>

          <span className="text-[11px] text-[#737373] hidden sm:inline">
            Clique no card para marcar ou desmarcar
          </span>
        </div>

        {/* ============================================================== */}
        {/* 3. CORPO PRINCIPAL COM GRADE DE FAMÍLIAS                       */}
        {/* ============================================================== */}
        <main className="p-6 sm:p-8 overflow-y-auto max-h-[58vh] bg-[#FFFFFF]">
          {familiasFiltradas.length === 0 ? (
            <div className="text-center py-12 text-[#737373]">
              <span className="material-symbols-outlined text-4xl text-[#D4D4D4] mb-2 block">
                search_off
              </span>
              <p className="text-sm font-medium">
                Nenhuma família de componentes encontrada para "{termoBusca}".
              </p>
              <p className="text-xs mt-1 text-[#9E9E9E]">
                Verifique a ortografia ou limpe o campo de busca para exibir todas.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {familiasFiltradas.map((item) => {
                const isSelected = tempSelecao.has(item.familia);
                return (
                  <article
                    key={item.familia}
                    onClick={() => toggleFamilia(item.familia)}
                    className={`group relative flex flex-col justify-between p-3.5 rounded border transition-all cursor-pointer select-none ${
                      isSelected
                        ? "bg-[#FCFAF7] border-[#8B5A2B] shadow-xs ring-1 ring-[#8B5A2B]"
                        : "bg-white border-[#E0E0E0] hover:border-[#8B5A2B] hover:shadow-xs"
                    }`}
                  >
                    <div className="flex items-start justify-between w-full mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-[#141414] px-2 py-0.5 bg-[#F8F8F8] border border-[#E5E5E5] rounded">
                          {item.familia}
                        </span>
                        {item.familia === "CST" && (
                          <span className="text-[10px] font-semibold text-[#1E3A8A] px-1.5 py-0.2 bg-[#DBEAFE] rounded border border-[#93C5FD]">
                            TECIDOS CST
                          </span>
                        )}
                      </div>

                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // O click do article já gerencia o toggle
                          className="w-4 h-4 rounded border-[#D4D4D4] text-[#8B5A2B] focus:ring-[#8B5A2B] cursor-pointer"
                        />
                      </div>
                    </div>

                    <div className="mt-1">
                      <p className="text-xs font-medium text-[#1A1A1A] truncate" title={item.grupo || item.familia}>
                        {item.grupo || "SEM GRUPO DEFINIDO"}
                      </p>
                      <p className="text-[11px] text-[#737373] mt-0.5">
                        {item.total_itens.toLocaleString("pt-BR")}{" "}
                        {item.total_itens === 1 ? "item cadastrado" : "itens cadastrados"}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>

        {/* ============================================================== */}
        {/* 4. RODAPÉ FIXO DO MODAL                                        */}
        {/* ============================================================== */}
        <footer className="px-6 sm:px-8 py-4 bg-[#F8F8F8] border-t border-[#E5E5E5] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#404040] font-medium">Total selecionado:</span>
            <span className="font-mono font-bold text-xs text-[#141414] bg-white border border-[#D4D4D4] px-2.5 py-1 rounded shadow-xs">
              {totalSelecionados}{" "}
              {totalSelecionados === 1 ? "família ativa" : "famílias ativas"}
            </span>
            <span className="text-[11px] text-[#737373] hidden sm:inline">
              {totalSelecionados === 0 || isTodasSelecionadas
                ? "(Todos os componentes avaliados)"
                : "(Avaliação restrita aos componentes das famílias marcadas)"}
            </span>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onFechar}
              className="px-4 py-2 text-xs font-medium text-[#404040] hover:text-[#141414] rounded hover:bg-[#EAEAEA] transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleAplicar}
              className="px-6 py-2.5 text-xs font-semibold text-white bg-[#141414] hover:bg-black rounded shadow-sm transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>Aplicar Filtro</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#8B5A2B]"></span>
              <span className="text-[#D4D4D4] font-mono text-[11px] font-bold">
                {totalSelecionados === 0 || isTodasSelecionadas
                  ? "TODAS (SEM FILTRO)"
                  : `${totalSelecionados} FAMÍLIA${totalSelecionados > 1 ? "S" : ""}`}
              </span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
