import React from "react";
import { formatarQtd } from "../utils/formatters";

/**
 * Renderizador compartilhado da Camada Gerencial
 * Matérias-Primas (Tipo C) separadas de Componentes Produzidos (Tipo P) agrupados por Fábrica
 */
export default function SecaoGerencialInsumos({
  blocoGerencial,
  isAbaFaltando = true,
  exibirItensAfetados = false,
}) {
  const materiasPrimas = blocoGerencial?.materias_primas || [];
  const componentesPorFabrica = blocoGerencial?.componentes_por_fabrica || [];
  const resumo = blocoGerencial?.resumo || {};

  if (materiasPrimas.length === 0 && componentesPorFabrica.length === 0) {
    return isAbaFaltando ? (
      <div className="py-12 text-center text-xs text-[#2E7D32] flex flex-col items-center gap-2 bg-[#E8F5E9]/25 rounded-xs border border-[#C8E6C9]">
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
      <section className="bg-white border border-[#E5E5E5] rounded-xs shadow-[0_2px_10px_rgba(0,0,0,0.02)] overflow-hidden">
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
            <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 bg-white border border-[#E0E0E0] text-[#1A1A1A] rounded-xs">
              Com OC Aberta: <strong className="ml-1 font-semibold text-neutral-800">{resumo.mp_com_oc || 0} / {materiasPrimas.length}</strong>
            </span>
            {(resumo.mp_vinculadas_pedido || 0) > 0 && (
              <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 bg-[#EEF2FF] border border-[#C7D2FE] text-[#312E81] rounded-xs">
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
                      <div className="flex items-center gap-1.5">
                        {mp.eh_cst && (
                          <span
                            className="px-1.5 py-0.2 text-[9px] font-bold bg-[#E0F2FE] text-[#0369A1] border border-[#BAE6FD] rounded-xs"
                            title="Tecido da Família CST (disponibilidade controlada pela Intranet PCP)"
                          >
                            CST
                          </span>
                        )}
                        <span>{mp.item}</span>
                      </div>
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
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded-xs border ${
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
                      title={
                        mp.eh_cst
                          ? "Tecido da família CST: disponibilidade verificada exclusivamente na Intranet PCP (tecidos_customizados3.php), não no estoque físico."
                          : "Saldo total físico em estoque (Situação L)"
                      }
                    >
                      {mp.eh_cst ? (
                        <span className="text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-xs border border-sky-200">
                          CST (Intranet)
                        </span>
                      ) : (
                        formatarQtd(mp.estoque_total ?? mp.estoque_l)
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right font-normal text-neutral-600 font-mono">
                      {mp.eh_cst ? "-" : formatarQtd(mp.saldo_fila)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-normal text-neutral-600 font-mono">
                      {formatarQtd(mp.consumo)}
                    </td>
                    {isAbaFaltando && (
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-[#B84A39] bg-rose-50/40">
                        {formatarQtd(mp.falta)}
                      </td>
                    )}
                    <td className="py-3.5 px-5">
                      {mp.eh_cst ? (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-sky-800 text-[11px] bg-sky-50 px-1.5 py-0.5 rounded-xs border border-sky-200">
                              CST
                            </span>
                            <span
                              className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-xs border ${
                                mp.cst_chegou || mp.cst_situacao === "TECIDO CHEGOU"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-[#FFF3E0] text-[#E65100] border-[#FFE0B2]"
                              }`}
                            >
                              {mp.cst_situacao || "SEM REGISTRO"}
                            </span>
                            {mp.cst_pedido_interno && (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-xs">
                                Ped.Int #{mp.cst_pedido_interno}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-neutral-500 mt-0.5">
                            {mp.cst_fornecedor
                              ? mp.cst_fornecedor
                              : mp.oc_fornecedor
                              ? mp.oc_fornecedor
                              : ""}
                          </div>
                        </div>
                      ) : mp.oc_numero ? (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-[#1A1A1A]">
                              OC #{mp.oc_numero}
                            </span>
                            {mp.oc_sit === "A" ? (
                              <span
                                className="text-[9px] font-medium px-1.5 py-0.5 bg-[#FFF3E0] text-[#E65100] border border-[#FFE0B2] rounded-xs"
                                title="OC em aberto (sit_oc=S / situação A)"
                              >
                                Em Aberto (A)
                              </span>
                            ) : mp.oc_pedido_compra ? (
                              <span
                                className="text-[9px] font-medium px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xs"
                                title={`Pedido de Compra no fornecedor #${mp.oc_pedido_compra}`}
                              >
                                Ped.Compra #{mp.oc_pedido_compra}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[10px] text-neutral-400 mt-0.5">
                            Qtd OC: <strong className="text-neutral-600 font-mono">{formatarQtd(mp.oc_saldo)}</strong>
                            {mp.oc_fornecedor
                              ? ` • ${mp.oc_fornecedor}`
                              : mp.oc_comprador
                              ? ` • Compr.: ${mp.oc_comprador}`
                              : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium text-rose-800 bg-rose-50 border border-rose-200/60 rounded-xs">
                          Sem OC aberta
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {mp.eh_cst && mp.cst_prev_entrega ? (
                        <span className="inline-block px-2 py-0.5 text-[11px] font-mono text-sky-900 bg-sky-50/80 border border-sky-200/60 rounded-xs">
                          {mp.cst_prev_entrega}
                        </span>
                      ) : mp.oc_previsao ? (
                        <span className="inline-block px-2 py-0.5 text-[11px] font-mono text-amber-900 bg-amber-50/80 border border-amber-200/60 rounded-xs">
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
                          className={`inline-block px-2 py-0.5 font-mono text-[11px] font-medium rounded-xs border ${
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
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xs">
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
                            <span className="text-[11px] font-medium text-neutral-700 px-2.5 py-1 bg-white border border-[#E0E0E0] rounded-xs whitespace-nowrap shadow-none">
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
            <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 bg-white border border-[#E0E0E0] text-neutral-700 rounded-xs">
              Fábricas Envolvidas: <strong className="ml-1 text-[#1A1A1A]">{componentesPorFabrica.length}</strong>
            </span>
            <span className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 bg-white border border-[#E0E0E0] text-neutral-700 rounded-xs">
              Com OP Aberta: <strong className="ml-1 text-[#1A1A1A]">{resumo.comp_com_op || 0}/{resumo.total_componentes || 0}</strong>
            </span>
          </div>
        </div>

        {componentesPorFabrica.length === 0 ? (
          <div className="p-5 border border-[#E5E5E5] rounded-xs bg-white text-center text-xs text-neutral-500 font-light">
            {isAbaFaltando
              ? "✓ Nenhum componente produzido (Tipo P) em falta."
              : "Nenhum componente produzido neste filtro."}
          </div>
        ) : (
          <div className="space-y-4">
            {componentesPorFabrica.map((grupo) => (
              <div
                key={grupo.fabrica}
                className="bg-white border border-[#E5E5E5] rounded-xs shadow-[0_2px_10px_rgba(0,0,0,0.02)] overflow-hidden"
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
                    <span className="text-[10px] font-medium px-2 py-0.5 bg-[#E2E8F0] text-neutral-700 rounded-xs">
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
                      OPs abertas: <strong className="text-[#1A1A1A] font-semibold font-mono">{grupo.total_com_op}/{grupo.total_itens}</strong>
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
                              className={`px-2 py-0.5 text-[10px] font-semibold rounded-xs border ${
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
                          <td className="py-3.5 px-4 text-right font-normal text-neutral-600 font-mono">
                            {formatarQtd(comp.saldo_fila)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-normal text-neutral-600 font-mono">
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
                                    Saldo OP: <strong className="text-neutral-600 font-mono">{formatarQtd(comp.op_saldo)}</strong>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium text-rose-800 bg-rose-50 border border-rose-200/60 rounded-xs">
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
}
