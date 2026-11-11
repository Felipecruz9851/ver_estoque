import React from "react";
import { formatarQtd } from "../utils/formatters";
import { exportarTabelaMatrizComoImagem } from "../utils/exportarImagemMatriz";

/**
 * Tela de Matriz Pivot de Componentes Produzidos Faltantes (Líder Design)
 * Ocupa a área principal da tela, com navegação integrada à Sidebar.
 * Apresenta agrupamentos por fábrica de produção, filtros em 3 colunas,
 * geração de imagem PNG retina e exportação para Excel.
 */
export default function MatrizFaltasProduzidos({
  matrizDados,
  carregandoMatriz = false,
  erroMatriz = null,
  opcoesMatriz = { locais_item_final: [], locais_componente: [] },
  matrizMenuAberto = false,
  setMatrizMenuAberto,
  matrizLocaisPaiSel = [],
  setMatrizLocaisPaiSel,
  toggleLocalPaiMatriz,
  matrizLocaisCompSel = [],
  setMatrizLocaisCompSel,
  toggleLocalCompMatriz,
  matrizBuscaLocalPai = "",
  setMatrizBuscaLocalPai,
  matrizBuscaLocalComp = "",
  setMatrizBuscaLocalComp,
  matrizEscopoAbatimento = "global",
  setMatrizEscopoAbatimento,
  matrizBaixa = "todos",
  setMatrizBaixa,
  matrizDataInicio = "",
  setMatrizDataInicio,
  matrizDataFim = "",
  setMatrizDataFim,
  matrizBuscaItem = "",
  setMatrizBuscaItem,
  gruposExpandidos = {},
  setGruposExpandidos,
  exportandoMatriz = false,
  carregarMatrizFaltantes,
  handleExportarMatrizExcel,
  onVoltar,
}) {
  const prazosCols = [
    { prazo: 10, key: "10", label: "R. Multimarcas e Nordeste" },
    { prazo: 8, key: "8", label: "Fora de MG" },
    { prazo: 3, key: "3", label: "MG e franquia" },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-[#F8F8F8]">
      {/* Cabeçalho da Matriz Pivot Líder Design */}
      <header className="bg-white border-b border-[#E8E8E8] px-8 py-5 shrink-0 z-20">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#8B5A2B]"></span>
              <h2 className="text-lg lg:text-xl font-medium tracking-tight text-[#1A1A1A] font-serif">
                Matriz Pivot — Componentes Produzidos Faltantes
              </h2>
            </div>
            <p className="text-xs text-[#757575] max-w-4xl leading-relaxed font-normal">
              Agrupamento por fábrica do componente produzido (Tipo P) e fábrica do item final,
              exibindo os saldos faltantes em colunas por prazo de expedição (base Representante).
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setMatrizMenuAberto((prev) => !prev)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#1A1A1A] bg-transparent border border-[#D4D4D4] rounded-xs hover:bg-[#F8F8F8] transition cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-[#666666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
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
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
              </svg>
              <span>{exportandoMatriz ? "Exportando..." : "Exportar Matriz Excel"}</span>
            </button>

            {onVoltar && (
              <button
                type="button"
                onClick={onVoltar}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#555] hover:text-[#1A1A1A] border border-[#E0E0E0] rounded-xs hover:bg-[#F2F2F2] transition-colors cursor-pointer"
                title="Voltar para Disponibilidade de Estoque"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                <span>Voltar</span>
              </button>
            )}
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
                  <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
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
                      placeholder="Filtrar local pai..."
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
                            className="rounded-xs border-[#D4D4D4] text-[#1A1A1A] focus:ring-0 w-3.5 h-3.5 cursor-pointer"
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
                            className="rounded-xs border-[#8B5A2B] text-[#8B5A2B] focus:ring-0 w-3.5 h-3.5 cursor-pointer"
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
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
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
                      (acc.falta_por_prazo["10"] + Number(row.falta_por_prazo?.["10"] || 0)) * 100
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

                  {/* BARRA DE BUSCA RÁPIDA */}
                  <div className="bg-white border border-[#E8E8E8] rounded-xs p-4 space-y-3 shadow-lider">
                    <div className="relative">
                      <svg className="w-4 h-4 text-[#8C8C8C] absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
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
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8B5A2B] hover:underline cursor-pointer"
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
                                    <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
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
      <footer className="px-8 py-4 border-t border-[#E8E8E8] bg-white flex items-center justify-between shrink-0">
        <span className="text-[11px] text-[#757575]">
          {matrizDados
            ? `${(matrizDados.totais_gerais?.total_componentes_distintos || 0).toLocaleString("pt-BR")} componente(s) único(s) • Agrupado por Local de Produção do Componente`
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
