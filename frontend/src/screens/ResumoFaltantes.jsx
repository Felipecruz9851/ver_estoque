import React, { useMemo, useState } from "react";
import { formatarQtd, truncar } from "../utils/formatters";

const LIMITE_INICIAL = 100;
const LIMITE_ITENS_LOCAL = 30;

const norm = (s) => String(s ?? "").toUpperCase();

/**
 * Tela "Itens Faltantes" (Líder Design)
 * Lista tudo o que falta (insumos com Falta > 0) para os itens finais (ou todas as OPs)
 * que atendem aos mesmos filtros da tela de Disponibilidade (filtros espelhados no orquestrador).
 *  - Visão "por_insumo": Produzidos (Tipo P) por local do componente; Comprados (Tipo C) pela fábrica consumidora.
 *  - Visão "por_item_pedido": Agrupado por Local de Produção -> cada Item/Pedido/OP -> insumos faltantes.
 */
export default function ResumoFaltantes({
  dados,
  carregando = false,
  erro = "",
  exportando = false,
  aba,
  setAba,
  visao = "por_insumo",
  setVisao = () => {},
  filtroTodasOps = false,
  setFiltroTodasOps = () => {},
  onRecarregar,
  onExportar,
  onAbrirDetalhes,
  onAbrirResumoPedido,
  onVoltar,
  // filtros espelhados
  filtroLocal = [],
  setFiltroLocal,
  filtroFamilias = [],
  setFiltroFamilias,
  filtroPedido = "",
  setFiltroPedido,
  filtroCodigo = "",
  setFiltroCodigo,
  filtroBaixa = "todos",
  setFiltroBaixa,
  filtroTipoData = "abertura_op",
  setFiltroTipoData,
  filtroDataInicio = "",
  setFiltroDataInicio,
  filtroDataFim = "",
  setFiltroDataFim,
  onAbrirModalFiltroLocal,
  onAbrirModalFiltroFamilia,
  limparFiltros,
  temFiltrosAtivos = false,
}) {
  const [busca, setBusca] = useState("");
  const [fechados, setFechados] = useState({});
  const [limites, setLimites] = useState({});

  const qtdLocais = Array.isArray(filtroLocal) ? filtroLocal.length : filtroLocal ? 1 : 0;
  const qtdFam = Array.isArray(filtroFamilias) ? filtroFamilias.length : filtroFamilias ? 1 : 0;
  const totais = dados?.totais || {};

  const filtrar = (grupos) => {
    const q = norm(busca).trim();
    if (!q) return grupos || [];
    return (grupos || [])
      .map((g) => {
        const itens = g.itens.filter(
          (it) => norm(it.item).includes(q) || norm(it.descricao).includes(q) || norm(g.local).includes(q)
        );
        return { ...g, itens, total_itens: itens.length };
      })
      .filter((g) => g.itens.length > 0);
  };

  const gruposP = useMemo(() => filtrar(dados?.grupos_produzidos), [dados, busca]); // eslint-disable-line react-hooks/exhaustive-deps
  const gruposC = useMemo(() => filtrar(dados?.grupos_comprados), [dados, busca]); // eslint-disable-line react-hooks/exhaustive-deps

  const gruposLocalItem = useMemo(() => {
    const lista = dados?.grupos_por_local_item || [];
    const q = norm(busca).trim();
    const saida = [];
    for (const g of lista) {
      const localMatch = q ? norm(g.local).includes(q) : true;
      const itensFilt = [];
      const pedsSet = new Set();
      let linhasTot = 0;
      let faltaTot = 0;

      for (const it of g.itens || []) {
        const faltBase = (it.faltantes || []).filter((f) => aba === "todos" || f.tipo === aba);
        if (faltBase.length === 0) continue;

        const headerMatch =
          localMatch ||
          norm(it.item_final).includes(q) ||
          norm(it.ordem_op).includes(q) ||
          norm(it.descricao).includes(q) ||
          norm(it.pedido).includes(q) ||
          norm(it.cliente).includes(q);

        const faltVis =
          !q || headerMatch
            ? faltBase
            : faltBase.filter(
                (f) =>
                  norm(f.item).includes(q) ||
                  norm(f.descricao).includes(q) ||
                  norm(f.local_comp).includes(q) ||
                  norm(f.ordem_prod).includes(q) ||
                  norm(f.oc_numero).includes(q)
              );

        if (faltVis.length === 0) continue;
        const qtdP = faltVis.filter((f) => f.tipo === "P").length;
        const qtdC = faltVis.length - qtdP;
        const sumFaltaIt = faltVis.reduce((acc, f) => acc + Number(f.falta || 0), 0);
        if (it.pedido) pedsSet.add(it.pedido);
        linhasTot += faltVis.length;
        faltaTot += sumFaltaIt;

        itensFilt.push({
          ...it,
          total_faltando: faltVis.length,
          total_faltando_p: qtdP,
          total_faltando_c: qtdC,
          falta_total: Math.round(sumFaltaIt * 100) / 100,
          faltantes: faltVis,
        });
      }

      if (itensFilt.length > 0) {
        saida.push({
          ...g,
          total_itens_pedido: itensFilt.length,
          total_pedidos: pedsSet.size,
          total_faltas_linhas: linhasTot,
          total_falta_qtd: Math.round(faltaTot * 100) / 100,
          itens: itensFilt,
        });
      }
    }
    return saida;
  }, [dados, aba, busca]);

  const chave = (tp, local) => `${tp}|${local}`;
  const alternar = (k) => setFechados((p) => ({ ...p, [k]: !p[k] }));
  const expandirTodos = (abrir) => {
    const novo = {};
    const chaves =
      visao === "por_item_pedido"
        ? gruposLocalItem.map((g) => chave("L", g.local))
        : [...gruposP.map((g) => chave("P", g.local)), ...gruposC.map((g) => chave("C", g.local))];
    chaves.forEach((k) => {
      novo[k] = !abrir;
    });
    setFechados(novo);
  };

  const Card = ({ rotulo, valor, sub, cor = "#1A1A1A" }) => (
    <div className="bg-white p-4 rounded-sm border border-[#EAEAEA] shadow-[0_2px_12px_rgba(0,0,0,0.02)]">
      <span className="text-[11px] uppercase tracking-widest font-medium" style={{ color: cor }}>
        {rotulo}
      </span>
      <div className="mt-2 text-2xl font-medium text-[#1A1A1A] tracking-tight">{valor}</div>
      <p className="text-[11px] text-[#757575] mt-0.5">{sub}</p>
    </div>
  );

  const renderTabela = (tp, g) => {
    const k = chave(tp, g.local);
    const limite = limites[k] || LIMITE_INICIAL;
    const itens = g.itens.slice(0, limite);
    const ehP = tp === "P";
    return (
      <section key={k} className="bg-white border border-[#E5E5E5] rounded-xs shadow-[0_2px_10px_rgba(0,0,0,0.02)] overflow-hidden">
        <button
          type="button"
          onClick={() => alternar(k)}
          className="w-full px-6 py-3.5 bg-[#FAFAFA] flex flex-wrap items-center justify-between gap-2 cursor-pointer text-left"
          aria-expanded={!fechados[k]}
        >
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[18px] text-[#8B5A2B]">
              {ehP ? "precision_manufacturing" : "factory"}
            </span>
            <h3 className="text-xs font-semibold tracking-wider text-[#1A1A1A] uppercase">{g.local}</h3>
            <span className="px-2 h-5 flex items-center rounded-full bg-[#8B5A2B]/10 text-[#8B5A2B] text-[10px] font-semibold">
              {g.total_itens} {g.total_itens === 1 ? "item" : "itens"}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[#555]">
            <span>
              Falta total: <strong className="text-[#B84A39]">{formatarQtd(g.total_falta)}</strong>
            </span>
            <span>
              {ehP ? "Com OP" : "Com OC"}: <strong>{g.total_com_enriquecimento}</strong>
            </span>
            <span className="material-symbols-outlined text-[18px] text-[#757575]">
              {fechados[k] ? "expand_more" : "expand_less"}
            </span>
          </div>
        </button>

        {!fechados[k] && (
          <div className="overflow-auto max-h-[min(520px,65vh)]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-white text-neutral-400 uppercase text-[10px] font-medium tracking-wider border-b border-[#E0E0E0]">
                <tr>
                  <th scope="col" className="py-3 px-5 bg-white whitespace-nowrap">Código</th>
                  <th scope="col" className="py-3 px-4 bg-white">Descrição</th>
                  <th scope="col" className="py-3 px-3 bg-white text-center">Baixa</th>
                  <th scope="col" className="py-3 px-4 bg-white text-right">Estoque</th>
                  <th scope="col" className="py-3 px-4 bg-white text-right">Consumo</th>
                  <th scope="col" className="py-3 px-4 bg-white text-right text-[#B84A39]">Falta</th>
                  <th scope="col" className="py-3 px-4 bg-white">{ehP ? "OP" : "OC"}</th>
                  <th scope="col" className="py-3 px-4 bg-white">{ehP ? "Abertura / Entrega OP" : "Previsão OC"}</th>
                  <th scope="col" className="py-3 px-4 bg-white text-right">Pedidos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F0]">
                {itens.map((it) => (
                  <tr key={it.item} className="hover:bg-[#FAFAFA]">
                    <td className="py-2.5 px-5 font-mono font-medium text-[#1A1A1A] whitespace-nowrap">{it.item}</td>
                    <td className="py-2.5 px-4 text-[#555]" title={it.descricao}>{truncar(it.descricao, 70)}</td>
                    <td className="py-2.5 px-3 text-center text-[#555]">{it.baixa || "-"}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{formatarQtd(it.estoque_total)}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{formatarQtd(it.consumo)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-[#B84A39]">{formatarQtd(it.falta)}</td>
                    <td className="py-2.5 px-4 font-mono text-[#555]">
                      {ehP ? it.ordem_prod || "-" : it.oc_numero || "-"}
                      {!ehP && it.oc_fornecedor ? (
                        <span className="block font-sans text-[10px] text-[#8C8C8C]">{truncar(it.oc_fornecedor, 28)}</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-4 text-[#555] whitespace-nowrap">
                      {ehP
                        ? it.op_data_abertura || it.op_data_entrega
                          ? `${it.op_data_abertura || "-"} → ${it.op_data_entrega || "-"}`
                          : "-"
                        : it.oc_previsao || "-"}
                    </td>
                    <td
                      className="py-2.5 px-4 text-right font-mono"
                      title={it.pedidos.join(", ") + (it.qtd_pedidos > it.pedidos.length ? " …" : "")}
                    >
                      {it.qtd_pedidos}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g.itens.length > limite && (
              <div className="p-3 text-center border-t border-[#F0F0F0]">
                <button
                  type="button"
                  onClick={() => setLimites((p) => ({ ...p, [k]: limite + 200 }))}
                  className="text-xs font-medium text-[#8B5A2B] hover:underline cursor-pointer"
                >
                  Mostrar mais ({g.itens.length - limite} restantes)
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  const renderGrupoLocalItem = (g) => {
    const k = chave("L", g.local);
    const aberto = !fechados[k];
    const limite = limites[k] || LIMITE_ITENS_LOCAL;
    const itensVis = g.itens.slice(0, limite);

    return (
      <section key={k} className="bg-white border border-[#E5E5E5] rounded-xs shadow-[0_2px_10px_rgba(0,0,0,0.02)] overflow-hidden">
        <h3 className="m-0">
          <button
            type="button"
            onClick={() => alternar(k)}
            className="w-full px-6 py-3.5 bg-[#FAFAFA] hover:bg-[#F3F3F3] flex flex-wrap items-center justify-between gap-2 cursor-pointer text-left border-b border-[#EFEFEF]"
            aria-expanded={aberto}
          >
            <div className="flex items-center gap-2">
              <span
                className={`material-symbols-outlined text-[18px] text-[#757575] transition-transform duration-150 ${
                  aberto ? "rotate-0" : "-rotate-90"
                }`}
                aria-hidden="true"
              >
                expand_more
              </span>
              <span className="material-symbols-outlined text-[18px] text-[#8B5A2B]" aria-hidden="true">
                factory
              </span>
              <span className="text-xs font-semibold tracking-wider text-[#1A1A1A] uppercase">{g.local}</span>
              <span className="px-2 h-5 flex items-center rounded-full bg-[#8B5A2B]/10 text-[#8B5A2B] text-[10px] font-semibold">
                {g.total_itens_pedido} {g.total_itens_pedido === 1 ? "item/OP" : "itens/OPs"}
              </span>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-[#555]">
              <span>
                Pedidos: <strong>{g.total_pedidos}</strong>
              </span>
              <span>
                Ocorrências de falta: <strong>{g.total_faltas_linhas}</strong>
              </span>
              <span>
                Falta total: <strong className="text-[#B84A39]">{formatarQtd(g.total_falta_qtd)}</strong>
              </span>
            </div>
          </button>
        </h3>

        {aberto && (
          <div className="divide-y divide-[#EAEAEA]">
            {itensVis.map((it, idxIt) => (
              <article key={`${it.ordem_op || it.item_final}_${it.pedido}_${idxIt}`} className="bg-white">
                <div className="px-6 py-3 bg-[#FCFAF7] border-b border-[#F0EAE2] flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[#1A1A1A]">{it.item_final}</span>
                      {it.ordem_op && (
                        <span className="px-1.5 py-0.5 rounded-xs text-[10px] font-mono bg-[#F3F4F6] text-[#374151] border border-[#E5E7EB]">
                          OP {it.ordem_op}
                        </span>
                      )}
                      {it.eh_raiz === false && (
                        <span
                          className="px-1.5 py-0.5 rounded-xs text-[10px] font-medium bg-[#EEF2FF] text-[#3730A3] border border-[#C7D2FE]"
                          title={it.item_final_pai ? `Subcomponente de ${it.item_final_pai}${it.fabrica_pai ? ` (${it.fabrica_pai})` : ""}` : "Subcomponente"}
                        >
                          Subcomp.{it.item_final_pai ? ` • Pai ${it.item_final_pai}` : ""}
                        </span>
                      )}
                      {it.pedido ? (
                        onAbrirResumoPedido ? (
                          <button
                            type="button"
                            onClick={() => onAbrirResumoPedido(it.pedido, "TODOS")}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs bg-white border border-[#DFD3C5] hover:border-[#8B5A2B] text-[#8B5A2B] font-mono text-[11px] font-semibold cursor-pointer"
                            title={`Abrir Resumo do Pedido #${it.pedido}`}
                          >
                            <span>Pedido #{it.pedido}</span>
                            <span className="material-symbols-outlined text-[12px]" aria-hidden="true">open_in_new</span>
                          </button>
                        ) : (
                          <span className="font-mono text-[11px] font-semibold text-[#8B5A2B]">Pedido #{it.pedido}</span>
                        )
                      ) : (
                        <span className="px-2 py-0.5 rounded-xs text-[10px] bg-[#F5F5F5] text-[#666] border border-[#E0E0E0]">
                          Lote / Sem Pedido
                        </span>
                      )}
                      <span className="text-xs text-[#444] truncate max-w-[420px]" title={it.descricao}>
                        {it.descricao || "-"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#757575] mt-1">
                      <span>Abertura: <strong className="font-mono text-[#333]">{it.data_abertura || "-"}</strong></span>
                      <span>Entrega: <strong className="font-mono text-[#333]">{it.entrega || "-"}</strong></span>
                      <span>Saldo OP: <strong className="font-mono text-[#333]">{formatarQtd(it.saldo)}</strong></span>
                      {it.cliente && it.cliente !== "." && (
                        <span className="truncate max-w-[260px]" title={it.cliente}>Cliente: {it.cliente}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2 py-1 rounded-xs bg-[#B84A39]/10 text-[#B84A39] text-[11px] font-semibold">
                      {it.total_faltando} {it.total_faltando === 1 ? "insumo faltando" : "insumos faltando"} ({it.total_faltando_p} P • {it.total_faltando_c} C)
                    </span>
                    {onAbrirDetalhes && (
                      <button
                        type="button"
                        onClick={() => onAbrirDetalhes(it)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xs border border-[#D5D5D5] bg-white hover:border-[#1A1A1A] text-xs text-[#1A1A1A] cursor-pointer"
                        title="Abrir tela de detalhamento completo de insumos desta ordem"
                      >
                        <span className="material-symbols-outlined text-[14px] text-[#757575]" aria-hidden="true">visibility</span>
                        <span>Ver Insumos</span>
                      </button>
                    )}
                  </div>
                </div>

                <div
                  tabIndex={0}
                  role="region"
                  aria-label={`Insumos faltantes de ${it.item_final}${it.pedido ? ` pedido ${it.pedido}` : ""}`}
                  className="overflow-auto max-h-[340px] focus:outline-none"
                >
                  <table className="w-full text-left text-xs border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10 bg-white text-neutral-400 uppercase text-[10px] font-medium tracking-wider border-b border-[#EAEAEA]">
                      <tr>
                        <th scope="col" className="py-2.5 px-4 bg-white text-center">Tipo</th>
                        <th scope="col" className="py-2.5 px-4 bg-white whitespace-nowrap">Código Insumo</th>
                        <th scope="col" className="py-2.5 px-4 bg-white">Descrição</th>
                        <th scope="col" className="py-2.5 px-4 bg-white">Local Comp.</th>
                        <th scope="col" className="py-2.5 px-3 bg-white text-center">Baixa</th>
                        <th scope="col" className="py-2.5 px-4 bg-white text-right">Estoque / Fila</th>
                        <th scope="col" className="py-2.5 px-4 bg-white text-right">Consumo</th>
                        <th scope="col" className="py-2.5 px-4 bg-white text-right text-[#B84A39]">Falta</th>
                        <th scope="col" className="py-2.5 px-4 bg-white">OP / OC</th>
                        <th scope="col" className="py-2.5 px-4 bg-white">Abertura / Previsão</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F4F4F4]">
                      {it.faltantes.map((f, idxF) => {
                        const ehP = f.tipo === "P";
                        return (
                          <tr key={`${f.item}_${idxF}`} className="hover:bg-[#FAFAFA]">
                            <td className="py-2 px-4 text-center">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded-xs text-[10px] font-semibold ${
                                  ehP ? "bg-[#E8F0F6] text-[#2B4C65]" : "bg-[#FAF0E6] text-[#8B5A2B]"
                                }`}
                              >
                                {f.tipo}
                              </span>
                            </td>
                            <th scope="row" className="py-2 px-4 font-mono font-medium text-[#1A1A1A] whitespace-nowrap">
                              {f.item}
                            </th>
                            <td className="py-2 px-4 text-[#555]" title={f.descricao}>{truncar(f.descricao, 60)}</td>
                            <td className="py-2 px-4 text-[#555] whitespace-nowrap">{f.local_comp || "-"}</td>
                            <td className="py-2 px-3 text-center text-[#555]">{f.baixa || "-"}</td>
                            <td className="py-2 px-4 text-right font-mono text-[#555]">
                              {formatarQtd(f.estoque_total)} / <span className="text-[#1A1A1A]">{formatarQtd(f.saldo_fila)}</span>
                            </td>
                            <td className="py-2 px-4 text-right font-mono">{formatarQtd(f.consumo)}</td>
                            <td className="py-2 px-4 text-right font-mono font-semibold text-[#B84A39]">{formatarQtd(f.falta)}</td>
                            <td className="py-2 px-4 font-mono text-[#555]">
                              {ehP ? (
                                f.ordem_prod || "-"
                              ) : (
                                <>
                                  {f.oc_numero || (f.eh_cst ? f.cst_situacao || "CST" : "-")}
                                  {f.oc_fornecedor ? (
                                    <span className="block font-sans text-[10px] text-[#8C8C8C]">{truncar(f.oc_fornecedor, 26)}</span>
                                  ) : null}
                                </>
                              )}
                            </td>
                            <td className="py-2 px-4 text-[#555] whitespace-nowrap">
                              {ehP
                                ? f.op_data_abertura || f.op_data_entrega
                                  ? `${f.op_data_abertura || "-"} → ${f.op_data_entrega || "-"}`
                                  : "-"
                                : f.oc_previsao || "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}

            {g.itens.length > limite && (
              <div className="p-3 text-center bg-[#FAFAFA]">
                <button
                  type="button"
                  onClick={() => setLimites((p) => ({ ...p, [k]: limite + 50 }))}
                  className="text-xs font-medium text-[#8B5A2B] hover:underline cursor-pointer"
                >
                  Mostrar mais itens/pedidos ({g.itens.length - limite} restantes)
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  const vazio =
    !carregando &&
    dados &&
    (visao === "por_item_pedido"
      ? gruposLocalItem.length === 0
      : gruposP.length === 0 && gruposC.length === 0);
  const campoCls =
    "h-8 px-2 text-xs bg-white border border-[#E0E0E0] rounded-sm focus:outline-none focus:border-[#1A1A1A]";

  return (
    <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-[#F8F8F8]">
      <header className="px-8 py-5 border-b border-[#EAEAEA] bg-white flex flex-wrap items-center justify-between gap-4 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xs bg-[#FAF7F2] border border-[#EBE4DC] flex items-center justify-center text-[#8B5A2B] shrink-0">
            <span className="material-symbols-outlined text-[18px]">playlist_remove</span>
          </div>
          <div>
            <h2 className="font-serif text-lg font-medium tracking-tight text-[#1A1A1A]">
              Itens Faltantes <span className="font-sans font-light text-neutral-400 mx-1">—</span>
              <span className="font-normal text-sm text-neutral-600">
                {visao === "por_item_pedido"
                  ? "por local de produção, item/pedido e o que falta"
                  : "tudo o que falta, por local de produção e tipo"}
              </span>
            </h2>
            <p className="text-xs text-[#757575] font-light mt-0.5">
              {visao === "por_item_pedido"
                ? "Separa pelos locais de produção e lista o que falta para cada item, pedido ou OP, espelhando os filtros ativos."
                : "Respeita os filtros da tela de Disponibilidade (locais, famílias, datas, pedido, código). Produzidos por local do componente; comprados pela fábrica consumidora."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onRecarregar} disabled={carregando}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#555] border border-[#E0E0E0] rounded-xs hover:bg-[#F2F2F2] cursor-pointer disabled:opacity-50">
            <span className="material-symbols-outlined text-[16px]">refresh</span>Atualizar
          </button>
          <button type="button" onClick={onExportar} disabled={exportando || carregando || !dados}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#1A1A1A] rounded-xs hover:bg-neutral-800 cursor-pointer disabled:opacity-50">
            <span className="material-symbols-outlined text-[16px]">download</span>
            {exportando ? "Exportando..." : "Exportar Excel"}
          </button>
          <button type="button" onClick={onVoltar}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#555] hover:text-[#1A1A1A] border border-[#E0E0E0] rounded-xs hover:bg-[#F2F2F2] cursor-pointer">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>Voltar
          </button>
        </div>
      </header>

      <div className="p-8 overflow-y-auto flex-1 space-y-5">
        {/* Filtros espelhados */}
        <section className="bg-white p-4 rounded-sm border border-[#EAEAEA] flex flex-wrap items-end gap-3">
          <button type="button" onClick={onAbrirModalFiltroLocal}
            className={`h-8 px-3 text-xs rounded-sm border flex items-center gap-2 cursor-pointer ${qtdLocais ? "border-[#8B5A2B] bg-[#FCFAF7] font-medium" : "border-[#E0E0E0] hover:border-[#1A1A1A]"}`}>
            <span className="material-symbols-outlined text-[16px] text-[#8B5A2B]">factory</span>
            {qtdLocais
              ? filtroTodasOps
                ? `${qtdLocais} local(is)`
                : `${qtdLocais} local(is) do item final`
              : "Todos os locais"}
          </button>
          <button type="button" onClick={onAbrirModalFiltroFamilia}
            className={`h-8 px-3 text-xs rounded-sm border flex items-center gap-2 cursor-pointer ${qtdFam ? "border-[#8B5A2B] bg-[#FCFAF7] font-medium" : "border-[#E0E0E0] hover:border-[#1A1A1A]"}`}>
            <span className="material-symbols-outlined text-[16px] text-[#8B5A2B]">category</span>
            {qtdFam ? `${qtdFam} família(s) (itens 3)` : "Todas as famílias"}
          </button>
          <input className={`${campoCls} w-28`} placeholder="Pedido" value={filtroPedido} onChange={(e) => setFiltroPedido(e.target.value)} />
          <input className={`${campoCls} w-40`} placeholder={filtroTodasOps ? "Item, OP ou desc." : "Item final"} value={filtroCodigo} onChange={(e) => setFiltroCodigo(e.target.value)} />
          <select className={campoCls} value={filtroTipoData} onChange={(e) => setFiltroTipoData(e.target.value)}>
            <option value="abertura_op">Abertura da OP</option>
            <option value="entrega_pedido">Entrega do pedido</option>
          </select>
          <input type="date" className={campoCls} value={filtroDataInicio} onChange={(e) => setFiltroDataInicio(e.target.value)} aria-label="Data inicial" />
          <input type="date" className={campoCls} value={filtroDataFim} onChange={(e) => setFiltroDataFim(e.target.value)} aria-label="Data final" />
          <select className={campoCls} value={filtroBaixa} onChange={(e) => setFiltroBaixa(e.target.value)}>
            <option value="todos">Baixa: todas</option>
            <option value="S">Baixa: S</option>
            <option value="N">Baixa: N</option>
          </select>
          <div role="group" aria-label="Escopo de ordens exibidas" className="inline-flex h-8 p-0.5 bg-[#F8F8F8] border border-[#E0E0E0] rounded-sm">
            <button
              type="button"
              aria-pressed={!filtroTodasOps}
              onClick={() => setFiltroTodasOps(false)}
              className={`px-2.5 text-xs rounded-xs cursor-pointer ${!filtroTodasOps ? "bg-white text-[#1A1A1A] font-semibold border-b-2 border-[#8B5A2B]" : "text-[#666] hover:text-[#1A1A1A]"}`}
            >
              Itens Finais
            </button>
            <button
              type="button"
              aria-pressed={Boolean(filtroTodasOps)}
              onClick={() => setFiltroTodasOps(true)}
              className={`px-2.5 text-xs rounded-xs cursor-pointer ${filtroTodasOps ? "bg-[#8B5A2B] text-white font-semibold border-b-2 border-[#1A1A1A]" : "text-[#666] hover:text-[#1A1A1A]"}`}
            >
              Todas as OPs
            </button>
          </div>
          {temFiltrosAtivos && (
            <button type="button" onClick={limparFiltros} className="h-8 px-3 text-xs text-[#B84A39] hover:bg-[#FFEBEE] rounded-sm cursor-pointer">
              Limpar filtros
            </button>
          )}
        </section>

        {/* Métricas */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card rotulo={filtroTodasOps ? "Ordens (OPs) com falta" : "Itens finais com falta"} valor={(totais.itens_finais_com_falta || 0).toLocaleString("pt-BR")} sub={`${(totais.pedidos_afetados || 0).toLocaleString("pt-BR")} pedidos afetados`} cor="#B84A39" />
          <Card rotulo="Produzidos faltantes (P)" valor={(totais.p_itens || 0).toLocaleString("pt-BR")} sub={`${totais.p_locais || 0} locais • ${totais.p_com_op || 0} com OP`} cor="#4A6B82" />
          <Card rotulo="Comprados faltantes (C)" valor={(totais.c_itens || 0).toLocaleString("pt-BR")} sub={`${totais.c_locais || 0} fábricas • ${totais.c_com_oc || 0} com OC`} cor="#8B5A2B" />
          <Card rotulo="Falta total (un.)" valor={formatarQtd((totais.p_falta_total || 0) + (totais.c_falta_total || 0))} sub={`P: ${formatarQtd(totais.p_falta_total || 0)} • C: ${formatarQtd(totais.c_falta_total || 0)}`} />
        </section>

        {/* Visão + Abas + busca */}
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-white border border-[#E0E0E0] rounded-sm p-1 flex-nowrap overflow-x-auto" role="tablist" aria-label="Modo de visualização">
              {[
                ["por_insumo", "Consolidado por Insumo"],
                ["por_item_pedido", "Por Local → Item / Pedido"],
              ].map(([v, r]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={visao === v}
                  onClick={() => setVisao(v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-xs cursor-pointer whitespace-nowrap border-b-2 transition-colors ${
                    visao === v
                      ? "bg-[#1A1A1A] text-white border-[#8B5A2B]"
                      : "text-[#555] hover:bg-[#F2F2F2] border-transparent"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-white border border-[#E0E0E0] rounded-sm p-1 flex-nowrap overflow-x-auto" role="tablist" aria-label="Filtrar por origem do insumo">
              {[
                ["todos", "Todos"],
                ["P", "Produzidos (P)"],
                ["C", "Comprados (C)"],
              ].map(([v, r]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={aba === v}
                  onClick={() => setAba(v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-xs cursor-pointer whitespace-nowrap border-b-2 transition-colors ${
                    aba === v
                      ? "bg-[#1A1A1A] text-white border-[#8B5A2B]"
                      : "text-[#555] hover:bg-[#F2F2F2] border-transparent"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              className={`${campoCls} w-72`}
              placeholder={
                visao === "por_item_pedido"
                  ? "Buscar local, item, pedido, OP ou insumo..."
                  : "Buscar código, descrição ou local..."
              }
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <button type="button" onClick={() => expandirTodos(true)} className="text-xs text-[#555] hover:text-[#1A1A1A] cursor-pointer">Expandir</button>
            <span className="text-[#CCC]">|</span>
            <button type="button" onClick={() => expandirTodos(false)} className="text-xs text-[#555] hover:text-[#1A1A1A] cursor-pointer">Recolher</button>
          </div>
        </section>

        {erro && (
          <div role="alert" className="p-3.5 rounded-xs bg-[#FFEBEE]/80 border border-[#EF9A9A] text-[#C62828] text-xs flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>{erro}</span>
          </div>
        )}

        {carregando ? (
          <div className="py-16 flex flex-col items-center gap-2 text-[#757575] bg-white border border-[#E8E8E8] rounded-xs">
            <span className="material-symbols-outlined text-3xl animate-spin text-[#8B5A2B]">progress_activity</span>
            <span className="text-xs">
              {visao === "por_item_pedido"
                ? "Agrupando faltas por local de produção e item/pedido..."
                : "Consolidando faltas por local de produção..."}
            </span>
          </div>
        ) : vazio ? (
          <div className="py-12 text-center text-xs text-[#2E7D32] bg-[#E8F5E9]/25 rounded-xs border border-[#C8E6C9]">
            Nenhum item faltante para os filtros atuais.
          </div>
        ) : visao === "por_item_pedido" ? (
          <div className="space-y-4">
            <h3 className="text-[11px] uppercase tracking-widest text-[#8B5A2B] font-semibold">
              Faltas por Local de Produção → Item / Pedido ({gruposLocalItem.length} {gruposLocalItem.length === 1 ? "local" : "locais"})
            </h3>
            {gruposLocalItem.map((g) => renderGrupoLocalItem(g))}
          </div>
        ) : (
          <>
            {(aba === "todos" || aba === "P") && gruposP.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-[11px] uppercase tracking-widest text-[#4A6B82] font-semibold">
                  Componentes produzidos (Tipo P) — por local de produção
                </h3>
                {gruposP.map((g) => renderTabela("P", g))}
              </div>
            )}
            {(aba === "todos" || aba === "C") && gruposC.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-[11px] uppercase tracking-widest text-[#8B5A2B] font-semibold">
                  Matérias-primas e insumos comprados (Tipo C) — por fábrica consumidora
                </h3>
                {gruposC.map((g) => renderTabela("C", g))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
