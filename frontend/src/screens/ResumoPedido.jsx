import React from "react";
import SecaoGerencialInsumos from "../components/SecaoGerencialInsumos";

/**
 * Tela de Resumo Gerencial do Pedido (Líder Design)
 * Ocupa a área principal da tela, com navegação integrada à Sidebar.
 * Apresenta a visão consolidada de resolução por Pedido ou Item,
 * separada em Matérias-Primas (Tipo C) e Componentes por Fábrica (Tipo P).
 */
export default function ResumoPedido({
  resumoDados,
  carregandoResumo = false,
  erroResumo = null,
  resumoPedidoInput = "",
  setResumoPedidoInput,
  resumoItemEscopo = "TODOS",
  resumoBaixa = "todos",
  setResumoBaixa,
  resumoTipo = "todos",
  setResumoTipo,
  abaResumo = "faltando",
  setAbaResumo,
  carregarResumoPedido,
  onVoltar,
}) {
  return (
    <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-[#F8F8F8]">
      {/* Cabeçalho do Resumo Gerencial com Busca de Pedido */}
      <header className="px-8 py-5 border-b border-[#EAEAEA] bg-white flex flex-wrap items-center justify-between gap-4 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xs bg-[#FAF7F2] border border-[#EBE4DC] flex items-center justify-center text-[#8B5A2B] shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h2 className="font-serif text-lg font-medium tracking-tight text-[#1A1A1A]">
              Resumo Gerencial do Pedido <span className="font-sans font-light text-neutral-400 mx-1">—</span>{" "}
              <span className="font-normal text-sm text-neutral-600">
                O que falta para resolver o pedido ou o item
              </span>
            </h2>
            <p className="text-xs text-[#757575] font-light tracking-wide mt-0.5">
              Visão consolidada separada por Matéria-Prima (previsão de OC) e Componentes agrupados por fábrica (abertura e entrega de OP).
            </p>
          </div>
        </div>

        {/* Busca rápida de Pedido dentro da tela de resumo + Ação Voltar */}
        <div className="flex items-center gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              carregarResumoPedido(resumoPedidoInput, "TODOS", resumoBaixa, resumoTipo);
            }}
            className="flex items-center bg-[#F8F8F8] border border-[#E0E0E0] rounded-xs p-1 pl-3 text-xs shadow-none"
          >
            <label htmlFor="order-search" className="text-neutral-500 font-medium mr-2">
              Pedido:
            </label>
            <input
              id="order-search"
              type="text"
              value={resumoPedidoInput}
              onChange={(e) => setResumoPedidoInput(e.target.value)}
              placeholder="Ex: 176091"
              className="bg-transparent border-none text-xs font-semibold text-[#1A1A1A] focus:ring-0 p-0 w-24 font-mono focus:outline-none"
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
                      <path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" strokeLinecap="round" strokeLinejoin="round" />
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
                      <path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.07a4.5 4.5 0 004.486-6.32l-3.27 3.27-2.335-.778-.778-2.335 3.27-3.27a4.5 4.5 0 00-6.32 4.486c.118.58.094 1.193-.07 1.743" strokeLinecap="round" strokeLinejoin="round" />
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
            <SecaoGerencialInsumos
              blocoGerencial={
                abaResumo === "faltando"
                  ? resumoDados.gerencial_faltando
                  : resumoDados.gerencial_disponiveis
              }
              isAbaFaltando={abaResumo === "faltando"}
              exibirItensAfetados={
                resumoItemEscopo === "TODOS" && resumoDados.total_itens_pedido > 1
              }
            />
          </>
        )}
      </div>

      {/* Rodapé da Tela de Resumo */}
      <footer className="px-8 py-4 border-t border-[#EAEAEA] bg-white flex items-center justify-between shrink-0">
        <span className="text-[11px] text-[#757575]">
          {resumoDados
            ? `Pedido #${resumoDados.pedido || "-"} • ${resumoDados.total_insumos} insumo(s) avaliado(s) no escopo`
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
