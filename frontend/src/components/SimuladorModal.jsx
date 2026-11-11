import React from "react";

/**
 * Modal nativo <dialog> do Simulador de Pedidos na Intranet (Líder Design)
 * Suporta preenchimento de número de pedidos, seleção de data de entrega via calendário nativo,
 * adição/remoção de linhas e consulta na Intranet.
 */
export default function SimuladorModal({
  dialogRef,
  dialogTitleId,
  titleId,
  userFieldId = "sim-user-field",
  passFieldId = "sim-pass-field",
  intranetUsuario = "",
  setIntranetUsuario,
  intranetSenha = "",
  setIntranetSenha,
  mostrarSenha = false,
  setMostrarSenha,
  linhasSimulador = [],
  simulando = false,
  erroSimulador = "",
  avisoSimulador = "",
  pedidosSimuladosAtivos = [],
  // Mapeamento compatível para convenção on* e handle*
  onConfirmarSimulacao,
  handleConfirmarSimulacao,
  onFecharModal,
  fecharModalSimulador,
  onAdicionarLinha,
  adicionarLinhaPedido,
  onRemoverLinha,
  removerLinhaPedido,
  onAtualizarLinha,
  atualizarLinhaPedido,
  onLimparSimulacao,
  handleLimparSimulacao,
  onRemoverPedidoSimulado,
  handleRemoverPedidoSimulado,
}) {
  const confirmar = onConfirmarSimulacao || handleConfirmarSimulacao;
  const fechar = onFecharModal || fecharModalSimulador;
  const adicionar = onAdicionarLinha || adicionarLinhaPedido;
  const remover = onRemoverLinha || removerLinhaPedido;
  const atualizar = onAtualizarLinha || atualizarLinhaPedido;
  const limpar = onLimparSimulacao || handleLimparSimulacao;
  const removerSimulado = onRemoverPedidoSimulado || handleRemoverPedidoSimulado;
  const idTitulo = dialogTitleId || titleId || "sim-dialog-title";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={idTitulo}
      className="w-full max-w-[690px] rounded-xs shadow-lider-modal border border-[#E0E0E0] p-0 bg-white text-[#1A1A1A] m-auto backdrop:bg-black/30 backdrop:backdrop-blur-[2px] animate-in fade-in zoom-in-95 duration-200"
    >
      <form onSubmit={confirmar} className="flex flex-col max-h-[90vh]">
        {/* Cabeçalho do Modal */}
        <header className="px-8 pt-7 pb-5 flex items-start justify-between border-b border-[#EDEDED] bg-white shrink-0">
          <div className="flex items-start gap-3.5">
            <div className="mt-0.5 w-8 h-8 rounded-xs bg-[#FAF7F2] border border-[#EBE4DC] flex items-center justify-center text-[#8B5A2B] shrink-0">
              <svg className="w-4 h-4 stroke-[1.4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h2 id={idTitulo} className="font-display font-medium text-[17px] tracking-tight text-[#1A1A1A]">
                Consultar e Simular Pedidos Específicos
              </h2>
              <p className="text-xs text-[#757575] font-normal leading-relaxed mt-1">
                Consulta estrutura e saldo na Intranet (<span className="font-mono text-[11px] text-[#1A1A1A]">192.168.0.6</span>), posiciona pela data de abertura e recalcula o estoque cumulativo.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fechar}
            className="text-[#9E9E9E] hover:text-[#1A1A1A] p-1.5 -mr-1 transition-colors rounded-xs focus:outline-none cursor-pointer"
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
                  onChange={(e) => setIntranetUsuario && setIntranetUsuario(e.target.value)}
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
                    onChange={(e) => setIntranetSenha && setIntranetSenha(e.target.value)}
                    placeholder="Sua senha"
                    className="w-full h-10 pl-3.5 pr-16 bg-white border border-[#E0E0E0] text-xs text-[#1A1A1A] placeholder-[#9E9E9E] rounded-xs focus:border-[#1A1A1A] focus:ring-0 transition-colors shadow-none"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenha && setMostrarSenha((prev) => !prev)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[11px] font-medium text-[#757575] hover:text-[#1A1A1A] tracking-wide focus:outline-none transition-colors cursor-pointer"
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
                      value={linha.pedido || ""}
                      onChange={(e) => {
                        if (typeof atualizar === "function") {
                          atualizar(linha.id, "pedido", e.target.value);
                        }
                      }}
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
                    <div className="relative">
                      <input
                        id={`dt_${linha.id}`}
                        name={`data_entrega_${index}`}
                        type="date"
                        value={linha.data_entrega || ""}
                        onChange={(e) => {
                          if (typeof atualizar === "function") {
                            atualizar(linha.id, "data_entrega", e.target.value);
                          }
                        }}
                        onClick={(e) => {
                          try {
                            if (typeof e.target.showPicker === "function") {
                              e.target.showPicker();
                            }
                          } catch {
                            // Suporte gracioso para navegadores que restringem showPicker
                          }
                        }}
                        className="w-full h-10 px-3.5 bg-white border border-[#E0E0E0] text-xs text-[#1A1A1A] rounded-xs focus:border-[#1A1A1A] focus:ring-0 transition-colors uppercase font-mono cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="sm:self-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof remover === "function") {
                          remover(linha.id);
                        }
                      }}
                      className="w-10 h-10 flex items-center justify-center border border-[#E0E0E0] text-[#9E9E9E] hover:text-red-700 hover:border-red-200 transition-colors rounded-xs bg-white focus:outline-none cursor-pointer"
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
                onClick={() => {
                  if (typeof adicionar === "function") {
                    adicionar();
                  }
                }}
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
                  onClick={() => {
                    if (typeof limpar === "function") {
                      limpar();
                    }
                  }}
                  className="text-[11px] font-medium text-red-700 hover:underline cursor-pointer"
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
                      onClick={() => {
                        if (typeof removerSimulado === "function") {
                          removerSimulado(ps.pedido);
                        }
                      }}
                      className="hover:text-red-700 font-bold ml-1 text-sm leading-none cursor-pointer"
                      title={`Remover pedido ${ps.pedido} da simulação`}
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
        <footer className="px-8 py-5 bg-[#FAF7F2]/40 border-t border-[#EDEDED] flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={fechar}
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
  );
}
